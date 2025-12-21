import logging
import threading
import re
import sys
import os
import base64
from typing import Dict, Any, Optional

from .config import CONFIG, SHARED_PROMPTS, load_user_preferences, save_user_preferences
from .utils import detect_mode, parse_mode, classify_operation, extract_actions_from_response
from .signal_client import run_signal_receive, send_signal_reply, send_reaction, send_typing_indicator
from .commands import execute_action

logger = logging.getLogger(__name__)

class SignalBot:
    """
    Signal Bot Service using AssistedVoice backend
    """
    def __init__(self, config: dict, llm_factory_func, audio_service):
        """
        Initialize the bot
        
        Args:
            config: Application configuration
            llm_factory_func: Function to create new LLM instances (create_llm)
            audio_service: Service for audio processing (STT)
        """
        self.config = config
        self.create_llm = llm_factory_func
        self.audio_service = audio_service
        
        # State
        self.running = False
        self.sessions: Dict[str, Any] = {}  # sender -> LLM instance
        self.pending_commands = {}
        self.user_preferences = load_user_preferences()
        
        # Load Signal config from env if not in main config (fallback)
        self.signal_number = os.environ.get("SIGNAL_NUMBER", CONFIG.get("SIGNAL_NUMBER"))
        self.allowed_users = CONFIG.get("ALLOWED_USERS", [])

    def start(self):
        """Start the bot in a background thread"""
        if self.running:
            return
            
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()
        logger.info("Signal Bot Service started")

    def stop(self):
        """Stop the bot"""
        self.running = False
        logger.info("Signal Bot Service stopping...")

    def _run_loop(self):
        """Main event loop"""
        try:
            for envelope in run_signal_receive():
                if not self.running:
                    break
                try:
                    self.process_envelope(envelope)
                except Exception as e:
                    logger.error(f"Error processing envelope: {e}")
        except Exception as e:
            logger.error(f"Signal bot loop crashed: {e}")

    def get_session_llm(self, sender: str):
        """Get or create LLM session for user"""
        if sender not in self.sessions:
            # Create a new LLM instance for this user
            # We can respect user preferences here if we want to switch models
            # For now, we use the system default config
            logger.info(f"Creating new LLM session for {sender}")
            self.sessions[sender] = self.create_llm(self.config)
            
        return self.sessions[sender]

    def process_envelope(self, envelope: Dict[str, Any]):
        """Process incoming Signal message"""
        if "envelope" not in envelope:
            return

        env = envelope["envelope"]
        sender = None
        raw_text = None
        message_timestamp = None

        # Extract message details
        if "dataMessage" in env and "source" in env:
            sender = env["source"]
            message_timestamp = env.get("timestamp")
            if "message" in env["dataMessage"]:
                raw_text = env["dataMessage"]["message"]
        elif "syncMessage" in env and "sentMessage" in env["syncMessage"]:
            sender = self.signal_number
            message_timestamp = env["syncMessage"]["sentMessage"].get("timestamp")
            if "message" in env["syncMessage"]["sentMessage"]:
                raw_text = env["syncMessage"]["sentMessage"]["message"]

        if not sender or not raw_text or not message_timestamp:
            return

        if sender not in self.allowed_users:
            logger.warning(f"Unauthorized access attempt from {sender}")
            return

        # Handle Commands
        if raw_text.strip().lower() == "ping":
            send_reaction(sender, message_timestamp, "👀", self.signal_number)
            send_signal_reply(sender, "Pong! 🏓")
            return
            
        if raw_text.strip().lower() == "/reset":
            if sender in self.sessions:
                self.sessions[sender].clear_conversation()
                del self.sessions[sender]
            send_reaction(sender, message_timestamp, "✅", self.signal_number)
            send_signal_reply(sender, "Conversation history cleared.")
            return

        # 0. Check for pending confirmation
        if sender in self.pending_commands and raw_text.strip().lower() in ["yes", "confirm", "y"]:
            self._handle_confirmation(sender, message_timestamp)
            return

        # 1. Detect Mode
        mode, user_text = parse_mode(raw_text)
        
        # 2. React
        send_reaction(sender, message_timestamp, "👀", self.signal_number)

        # 3. Handle Attachments (Voice & Vision)
        attachments_text = ""
        images = []
        
        if "dataMessage" in env and "attachments" in env["dataMessage"]:
            attachments_text, images = self._handle_attachments(env["dataMessage"]["attachments"])
            
        # Combine text
        final_user_text = user_text
        if attachments_text:
            if final_user_text:
                final_user_text = f"{final_user_text}\n[Context]: {attachments_text}"
            else:
                final_user_text = attachments_text
                
        # If we have only images and no text, provide a default prompt
        if images and not final_user_text:
            final_user_text = "Describe this image."

        # 4. Generate Response
        llm = self.get_session_llm(sender)
        llm.config['system_prompt'] = system_prompt

        send_typing_indicator(sender, self.signal_number, True)
        try:
            # Generate complete response (passing images if supported)
            if hasattr(llm, 'generate_complete_multimodal'):
                 # Future proofing if we add explicit multimodal method
                 response = llm.generate_complete_multimodal(final_user_text, images=images)
            else:
                 # Standard generate, now supporting images arg in our modified LLMs
                 # We need to access the underlying generate method which supports streaming, 
                 # but baseLLM.generate_complete wraps it.
                 # We'll update BaseLLM.generate_complete to accept kwargs too.
                 response = llm.generate_complete(final_user_text, images=images)
                 
        except Exception as e:
            logger.error(f"Generation failed: {e}")
            response = f"Error generating response: {e}"
        finally:
            send_typing_indicator(sender, self.signal_number, False)

        # 5. React Done
        send_reaction(sender, message_timestamp, "✅", self.signal_number)

        # 6. Handle Actions
        response = f"[{mode.upper()}]\n{response}"
        final_reply = self._process_actions(sender, mode, response, message_timestamp)
        
        # 7. Send Reply
        send_signal_reply(sender, final_reply)

    def _handle_attachments(self, attachments: list) -> tuple[str, list]:
        """Process attachments: Transcribe audio, return image paths."""
        text_parts = []
        image_paths = []
        
        data_path = self.config.get("SIGNAL_DATA_PATH", "")
        if not data_path:
            logger.warning("SIGNAL_DATA_PATH not set, cannot process attachments")
            return "", []

        for att in attachments:
            content_type = att.get("contentType", "")
            att_id = att.get("id", "")
            if not att_id:
                continue
                
            # Construct path (Assumes flat structure or need verification)
            # Signal-cli typically uses the ID as the filename or inside a folder
            # We will try to locate it.
            file_path = os.path.join(data_path, att_id)
            if not os.path.exists(file_path):
                # Try finding it recursively if flat path fails
                found = False
                for root, _, files in os.walk(data_path):
                    if att_id in files:
                        file_path = os.path.join(root, att_id)
                        found = True
                        break
                if not found:
                    logger.warning(f"Attachment {att_id} not found at {data_path}")
                    continue

            if content_type.startswith("audio/"):
                try:
                    logger.info(f"Processing audio attachment: {file_path}")
                    # Read file and separate into base64 for transcription
                    with open(file_path, "rb") as audio_file:
                        audio_data = base64.b64encode(audio_file.read()).decode('utf-8')
                        
                    transcription = self.audio_service.transcribe_audio(audio_data)
                    text_parts.append(f"[Voice Message]: {transcription}")
                except Exception as e:
                    logger.error(f"Failed to transcribe audio {att_id}: {e}")
                    text_parts.append("[Voice Message]: (Transcription Failed)")

            elif content_type.startswith("image/"):
                logger.info(f"Processing image attachment: {file_path}")
                # Convert to base64 for LLM usage
                try:
                    with open(file_path, "rb") as image_file:
                        encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
                        image_paths.append(encoded_string)
                except Exception as e:
                    logger.error(f"Failed to process image attachment {att_id}: {e}")

        return "\n".join(text_parts), image_paths

    def _handle_confirmation(self, sender, timestamp):
        """Handle pending command confirmation"""
        send_reaction(sender, timestamp, "👀", self.signal_number)
        
        action_data = self.pending_commands.pop(sender)
        mode = action_data.get("mode", "agent")
        
        send_typing_indicator(sender, self.signal_number, True)
        result = execute_action(action_data)
        send_typing_indicator(sender, self.signal_number, False)
        
        send_reaction(sender, timestamp, "✅", self.signal_number)
        send_signal_reply(sender, f"[{mode.upper()} - Executed]\n\n{result}")

    def _process_actions(self, sender, mode, response, timestamp) -> str:
        """Extract and process actions from response"""
        suggested_actions = extract_actions_from_response(response)
        
        if not suggested_actions:
            return response

        if mode == "ask":
            # Read-only checks logic...
            action_data = suggested_actions[0]
            action = action_data.get("action")
            # (Simplified check)
            self.pending_commands[sender] = action_data
            return f"{response}\n\n(Reply 'yes' to proceed with suggested action)"

        elif mode == "agent":
             action_data = suggested_actions[0]
             self.pending_commands[sender] = action_data
             return f"{response}\n\n(Reply 'yes' to execute)"
        
        return response
    
    def shutdown(self):
        self.stop()
