#!/usr/bin/env python3
import json
import logging
import subprocess
import signal
import sys
import time
import re
import os
import requests
import websocket
import threading
from contextlib import contextmanager
from typing import Optional, Dict, Any, Tuple
from config import CONFIG, SHARED_PROMPTS, load_user_preferences, save_user_preferences
from utils import detect_mode, parse_mode, run_command_on_host, classify_operation, extract_actions_from_response
from ai import call_ai_with_fallback
from signal_client import run_signal_receive, send_signal_reply, send_reaction, send_typing_indicator
from commands import execute_action



# =================================================================================
# LOGGING SETUP
# =================================================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(CONFIG["LOG_FILE"]),
        logging.StreamHandler(sys.stdout)
    ]
)

# =================================================================================
# STATE TRACKING
# =================================================================================
# Track pending confirmations for agent mode
pending_commands = {}  # {sender: {"cmd": "...", "reason": "..."}}

# Track user AI model preferences (per-user)
user_model_preference = {}  # {phone_number: "claude" | "gemini" | "openai" | "auto"}

# Track conversation history per user (last 10 messages)
conversation_history = {}  # {sender: [{"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
MAX_HISTORY_MESSAGES = 10  # Keep last 10 messages total




# =================================================================================
# MODE DETECTION
# =================================================================================





# =================================================================================
# HOST INTERACTION
# =================================================================================














# =================================================================================
# TYPING INDICATOR HELPER
# =================================================================================
@contextmanager
def typing_indicator(recipient: str, phone_number: str):
    """Context manager to handle periodic typing indicators."""
    stop_event = threading.Event()
    
    def resend_typing():
        while not stop_event.is_set():
            send_typing_indicator(recipient, phone_number, start=True)
            # Signal clients display it for ~15s. Resend every 10s.
            if stop_event.wait(timeout=10):
                break
    
    thread = threading.Thread(target=resend_typing)
    thread.daemon = True
    thread.start()
    
    try:
        yield
    finally:
        stop_event.set()
        send_typing_indicator(recipient, phone_number, start=False)

def process_envelope(envelope: Dict[str, Any]):
    """Processes a single Signal envelope."""
    # Structure from signal-cli-rest-api might differ slightly from raw signal-cli
    # Handles both direct messages (dataMessage) and Note to Self (syncMessage)

    if "envelope" not in envelope:
        return

    env = envelope["envelope"]
    sender = None
    raw_text = None
    message_timestamp = None  # Track timestamp for reactions

    # Handle direct messages (dataMessage)
    if "dataMessage" in env and "source" in env:
        sender = env["source"]
        message_timestamp = env.get("timestamp")  # Extract timestamp
        if "message" in env["dataMessage"]:
            raw_text = env["dataMessage"]["message"]

    # Handle Note to Self (syncMessage.sentMessage)
    elif "syncMessage" in env and "sentMessage" in env["syncMessage"]:
        # For Note to Self, sender is our own number
        sender = CONFIG["SIGNAL_NUMBER"]
        message_timestamp = env["syncMessage"]["sentMessage"].get("timestamp")  # Extract timestamp
        if "message" in env["syncMessage"]["sentMessage"]:
            raw_text = env["syncMessage"]["sentMessage"]["message"]

    # Skip if no valid message or sender
    if not sender or not raw_text or not message_timestamp:
        return

    # Check if sender is allowed
    if sender not in CONFIG["ALLOWED_USERS"]:
        return

    # === Ping Command ===
    if raw_text.strip().lower() == "ping":
        logging.info(f"Ping received from {sender}")
        send_reaction(sender, message_timestamp, "👀", CONFIG["SIGNAL_NUMBER"])
        send_signal_reply(sender, "Pong! 🏓")
        send_reaction(sender, message_timestamp, "✅", CONFIG["SIGNAL_NUMBER"])
        return


    # === Model Selection Commands ===
    command_lower = raw_text.strip().lower()

    if command_lower in ["/claude", "/gemini", "/openai", "/auto"]:
        new_preference = command_lower[1:]  # Remove leading slash

        # Update in-memory state
        user_model_preference[sender] = new_preference

        # Persist to disk
        save_user_preferences(user_model_preference)

        # Send confirmation reaction
        send_reaction(sender, message_timestamp, "✅", CONFIG["SIGNAL_NUMBER"])

        # Send confirmation message
        model_emojis = {"claude": "🤖", "gemini": "✨", "openai": "🔮", "auto": "🔄"}
        emoji = model_emojis.get(new_preference, "✅")

        confirmation_msg = f"{emoji} Model preference set to: {new_preference.upper()}\n\n"
        if new_preference == "auto":
            confirmation_msg += "Mode: Automatic fallback (Claude → OpenAI → Gemini on errors)"
        elif new_preference == "claude":
            confirmation_msg += "Mode: Claude only (no fallback)"
        elif new_preference == "openai":
            confirmation_msg += "Mode: OpenAI only (no fallback)"
        else:
            confirmation_msg += "Mode: Gemini only (no fallback)"

        send_signal_reply(sender, confirmation_msg)
        return
    # === End Model Selection ===

    # 0. Check for pending confirmation
    if sender in pending_commands and raw_text.strip().lower() in ["yes", "confirm", "y"]:
        logging.info(f"User confirmed pending command")

        # React to show execution starting
        send_reaction(sender, message_timestamp, "👀", CONFIG["SIGNAL_NUMBER"])

        action_data = pending_commands.pop(sender)
        mode = action_data.get("mode", "agent")
        action = action_data.get("action")
        params = action_data.get("params", {})

        # Safety check for shell commands
        if action == "shell_exec":
            cmd = params.get("cmd", "")
            op_type = classify_operation(cmd)

            if mode == "ask" and op_type != "read":
                send_signal_reply(sender, f"⛔ Error: ASK mode can only execute read operations.\n\nCommand blocked: {cmd}")
                send_reaction(sender, message_timestamp, "❌", CONFIG["SIGNAL_NUMBER"])
                return
        
        if mode == "plan":
            send_signal_reply(sender, f"⛔ Error: PLAN mode does not execute commands.\n\nUse [ask] or [agent] mode instead.")
            send_reaction(sender, message_timestamp, "❌", CONFIG["SIGNAL_NUMBER"])
            return

        # Execute
        with typing_indicator(sender, CONFIG["SIGNAL_NUMBER"]):
            result = execute_action(action_data)

        # React to show execution complete
        send_reaction(sender, message_timestamp, "✅", CONFIG["SIGNAL_NUMBER"])

        # Format result with mode tag
        send_signal_reply(sender, f"[{mode.upper()} - Executed]\n\n{result}")
        return

    # 1. Detect Mode
    mode, user_text = parse_mode(raw_text)

    logging.info(f"User: {sender} | Mode: {mode} | Text: {user_text}")

    # 2. React with 👀 (eyes) to show processing started
    send_reaction(sender, message_timestamp, "👀", CONFIG["SIGNAL_NUMBER"])

    # 3. Call AI based on user's model preference
    with typing_indicator(sender, CONFIG["SIGNAL_NUMBER"]):
        # Get user's model preference (default to "auto")
        model_preference = user_model_preference.get(sender, "auto")

        # Get conversation history for this user (last 5 messages for context)
        user_history = conversation_history.get(sender, [])

        # Call AI based on preference with conversation history
        response, actual_model = call_ai_with_fallback(user_text, mode, model_preference, user_history)

    # Store user message in history
    if sender not in conversation_history:
        conversation_history[sender] = []

    conversation_history[sender].append({
        "role": "user",
        "content": user_text
    })

    # Format response with new [model/mode] tag
    response = re.sub(r'^\[Mode: [^\]]+\]\s*', '', response, flags=re.MULTILINE)
    response = f"[{actual_model}/{mode}]\n{response}"

    # 4. React with ✅ (checkmark) to show processing complete
    send_reaction(sender, message_timestamp, "✅", CONFIG["SIGNAL_NUMBER"])

    # 5. Mode-Aware Response Handling

    # Extract any suggested actions from AI response
    suggested_actions = extract_actions_from_response(response)
    final_reply = response

    if mode == "ask":
        # ASK MODE: Only allow read-only operations with confirmation
        if suggested_actions:
            # For simplicity, take the first action
            action_data = suggested_actions[0]
            action = action_data.get("action")
            params = action_data.get("params", {})
            
            if action == "shell_exec":
                cmd = params.get("cmd", "")
                op_type = classify_operation(cmd)

                if op_type == "dangerous":
                    final_reply = f"{response}\n\n⛔ ERROR: ASK mode cannot suggest dangerous operations. Use [agent] mode instead."
                elif op_type == "write":
                    final_reply = f"{response}\n\n⛔ ERROR: ASK mode is read-only. Use [agent] mode for write operations."
                else:  # read-only
                    action_data["mode"] = "ask"
                    action_data["reason"] = "ASK mode read operation"
                    pending_commands[sender] = action_data
                    
                    if not ("yes" in response.lower() and "reply" in response.lower()):
                         final_reply = f"{response}\n\n(Reply 'yes' to proceed with this read operation)"
            elif action == "homeassistant_action":
                # For HA, assume read-only if it's a GET-like request (dummy logic for now)
                # In real scenario, we might want to restrict this more.
                # Currently we'll treat HA actions in ASK mode as needing confirmation.
                action_data["mode"] = "ask"
                pending_commands[sender] = action_data
                if not ("yes" in response.lower() and "reply" in response.lower()):
                     final_reply = f"{response}\n\n(Reply 'yes' to proceed with this Home Assistant action)"
            elif action == "transcribe_video":
                action_data["mode"] = "ask"
                pending_commands[sender] = action_data
                if not ("yes" in response.lower() and "reply" in response.lower()):
                     final_reply = f"{response}\n\n(Reply 'yes' to proceed with this transcription)"
        else:
            final_reply = response

    elif mode == "plan":
        if suggested_actions:
            final_reply = f"{response}\n\n⚠️ Note: PLAN mode does not execute commands. Use [ask] for read-only ops or [agent] for execution."
        else:
            final_reply = response

    elif mode == "agent":
        if suggested_actions:
            # Take the first action
            action_data = suggested_actions[0]
            action = action_data.get("action")
            params = action_data.get("params", {})
            
            op_type = "operation"
            if action == "shell_exec":
                op_type = classify_operation(params.get("cmd", ""))
                if op_type == "dangerous" and "⚠️" not in response and "warning" not in response.lower():
                    final_reply = f"⚠️ WARNING: Dangerous operation detected\n\n{response}"
            elif action == "homeassistant_action":
                op_type = "Home Assistant action"

            action_data["mode"] = "agent"
            pending_commands[sender] = action_data

            if not ("yes" in response.lower() and ("reply" in response.lower() or "confirm" in response.lower())):
                warning = "⚠️ DANGER: " if op_type == "dangerous" else ""
                final_reply = f"{warning}{response}\n\n(Reply 'yes' to execute)"
        else:
            final_reply = response
    else:
        # Unknown mode - default safe behavior
        final_reply = response


    # Log the response content for debugging
    logging.info(f"AI Response ({len(final_reply)} chars): {final_reply[:100]}...")

    # Store assistant response in history
    conversation_history[sender].append({
        "role": "assistant",
        "content": final_reply
    })

    # Trim history to last MAX_HISTORY_MESSAGES
    if len(conversation_history[sender]) > MAX_HISTORY_MESSAGES:
        conversation_history[sender] = conversation_history[sender][-MAX_HISTORY_MESSAGES:]

    # 6. Send Reply
    send_signal_reply(sender, final_reply)

# =================================================================================
# MAIN
# =================================================================================
def main():
    logging.info("Three-Mode ChatOps Bot Starting (HTTP Mode)...")
    logging.info(f"Mode: ASK/PLAN/AGENT enabled.")

    # Load user preferences from disk
    global user_model_preference
    user_model_preference = load_user_preferences()
    logging.info(f"Loaded preferences for {len(user_model_preference)} users")

    try:
        for envelope in run_signal_receive():
            try:
                process_envelope(envelope)
            except Exception as e:
                logging.error(f"Error processing envelope: {e}")
    except KeyboardInterrupt:
        logging.info("Bot stopped.")

if __name__ == "__main__":
    main()
