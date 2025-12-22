import logging
import threading
import re
import sys
import os
import base64
from typing import Dict, Any, Optional

from .config import CONFIG, SHARED_PROMPTS, load_user_preferences, save_user_preferences
from .utils import detect_mode, parse_mode, classify_operation, extract_actions_from_response, format_markdown_for_signal
from .signal_client import run_signal_receive, send_signal_reply, send_reaction, send_typing_indicator
from .commands import execute_action
from services.sharing_service import SharingService

logger = logging.getLogger(__name__)

class SignalBot:
    """
    Signal Bot Service using AssistedVoice backend
    """
    def __init__(self, config: dict, llm_factory_func, audio_service, chat_service=None):
        """
        Initialize the bot
        
        Args:
            config: Application configuration
            llm_factory_func: Function to create new LLM instances (create_llm)
            audio_service: Service for audio processing (STT)
            chat_service: ChatService for orchestration (optional)
        """
        self.config = config
        self.create_llm = llm_factory_func
        self.audio_service = audio_service
        self.chat_service = chat_service
        
        # State
        self.running = False
        self.sessions: Dict[str, Any] = {}  # sender -> LLM instance
        self.pending_commands = {}
        self.user_preferences = load_user_preferences()
        
        # Load Signal config from env if not in main config (fallback)
        self.signal_number = os.environ.get("SIGNAL_NUMBER", CONFIG.get("SIGNAL_NUMBER"))
        self.allowed_users = CONFIG.get("ALLOWED_USERS", [])
        self.backend_url = self.config.get("BACKEND_URL", "http://localhost:5001")
        
        # Initialize Sharing Service
        self.sharing_service = SharingService(self.config)
        self.max_msg_len = self.config.get("MAX_MSG_LEN", 4000)
        self.share_threshold = self.config.get("SHARE_THRESHOLD", 1000)

        # Validate required configuration
        if not self.signal_number:
            logger.error("SIGNAL_NUMBER not configured! Bot will not function properly.")
            raise ValueError("SIGNAL_NUMBER must be set in .env or config")

        logger.info(f"Bot initialized with number: {self.signal_number}")
        logger.info(f"Allowed users: {self.allowed_users}")
        logger.info(f"Backend URL: {self.backend_url}")

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
            
        if raw_text.strip().lower() in ["/help", "help"]:
            send_reaction(sender, message_timestamp, "👀", self.signal_number)
            help_text = """🤖 AssistedVoice Bot Help

MODES:
• ASK (default) - Read-only with confirmation
  Usage: Just send a message
  
• AGENT - Full control with confirmation
  Usage: [agent] your message
  
• PLAN - Planning only, no execution
  Usage: [plan] your message

COMMANDS:
• /help or help - Show this help
• /reset - Clear conversation history
• /model <name> - Switch model (e.g. /model ministral-3:8b)
• /gemini - Switch to Gemini model (gemini-1.5-flash)
• ping - Test bot connectivity
• yes/confirm/y - Confirm suggested action

AVAILABLE ACTIONS:
• transcribe_video - Transcribe YouTube/video URLs
  Example: [agent] transcribe https://youtube.com/...
  
• homeassistant_action - Control smart home devices
  Example: [agent] turn on living room lights
  
• shell_exec - Execute shell commands (agent mode)
  Example: [agent] list files in /tmp

MODELS:
Currently using Ollama with:
• llama3.2:latest - Default text model
• ministral-3:8b - Vision model (auto-switches for images)
• qwen3-vl:8b - Alternative vision model

FEATURES:
• 📷 Image analysis - Send images with questions
• 🎤 Voice transcription - Send voice messages
• 🏠 Smart home control via Home Assistant
• 🔍 Web search via MCP (Brave Search)
• 🌐 Browser automation via MCP (Playwright)
• 💾 Memory and context via MCP tools

Reply yes to confirm suggested actions."""
            send_signal_reply(sender, help_text)
            return  # Stop processing after showing help

        if raw_text.strip().lower().startswith("/model "):
            model_name = raw_text.strip()[7:].strip()
            send_reaction(sender, message_timestamp, "👀", self.signal_number)
            
            # Call AssistedVoice API to switch model
            import requests
            try:
                resp = requests.post(
                    f"{self.backend_url}/api/models/switch",
                    json={"model": model_name},
                    timeout=10
                )
                if resp.status_code == 200:
                    send_reaction(sender, message_timestamp, "✅", self.signal_number)
                    send_signal_reply(sender, f"🧠 Switched to model: {model_name}")
                else:
                    send_reaction(sender, message_timestamp, "❌", self.signal_number)
                    send_signal_reply(sender, f"❌ Model not found: {model_name}")
            except Exception as e:
                send_reaction(sender, message_timestamp, "❌", self.signal_number)
                send_signal_reply(sender, f"❌ Error: {str(e)}")
            return
            
        if raw_text.strip().lower() == "/gemini":
            send_reaction(sender, message_timestamp, "👀", self.signal_number)
            
            # Call AssistedVoice API to switch to Gemini model
            import requests
            try:
                resp = requests.post(
                    f"{self.backend_url}/api/models/switch",
                    json={"model": "gemini-1.5-flash"},
                    timeout=10
                )
                if resp.status_code == 200:
                    send_reaction(sender, message_timestamp, "✅", self.signal_number)
                    send_signal_reply(sender, "🧠 Switched to model: gemini-1.5-flash")
                else:
                    send_reaction(sender, message_timestamp, "❌", self.signal_number)
                    send_signal_reply(sender, "❌ Failed to switch to Gemini")
            except Exception as e:
                send_reaction(sender, message_timestamp, "❌", self.signal_number)
                send_signal_reply(sender, f"❌ Error: {str(e)}")
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
        elif "syncMessage" in env and "sentMessage" in env["syncMessage"] and "attachments" in env["syncMessage"]["sentMessage"]:
            attachments_text, images = self._handle_attachments(env["syncMessage"]["sentMessage"]["attachments"])
            
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
        system_prompt = SHARED_PROMPTS.get(mode, SHARED_PROMPTS["ask"])
        llm.config['system_prompt'] = system_prompt

        try:
            send_typing_indicator(sender, self.signal_number, True)
        except Exception as e:
            logger.warning(f"Failed to send typing indicator: {e}")

        try:
            # Generate response using ChatService OR LLM directly
            if self.chat_service:
                logger.info(f"Using ChatService for response generation: mode={mode}")
                response_gen = self.chat_service.generate_response(final_user_text, images=images, stream=True)
                response = ""
                for chunk in response_gen:
                    response += chunk
                logger.info(f"ChatService response length: {len(response)}")
            else:
                logger.info(f"Using direct LLM call for response generation: mode={mode}")
                response = llm.generate_complete(final_user_text, images=images)
                logger.info(f"Direct LLM response length: {len(response)}")

        except Exception as e:
            logger.error(f"Generation failed: {e}")
            response = f"Error generating response: {e}"
        finally:
            try:
                send_typing_indicator(sender, self.signal_number, False)
            except Exception as e:
                logger.warning(f"Failed to stop typing indicator: {e}")

        # 5. React Done
        send_reaction(sender, message_timestamp, "✅", self.signal_number)

        # 6. Handle Actions
        response = f"[{mode.upper()}]\n{response}"
        final_reply = self._process_actions(sender, mode, response, message_timestamp)
        
        # 7. Send Reply
        final_reply = format_markdown_for_signal(final_reply)
        
        # Auto-share if too long
        if len(final_reply) > self.share_threshold:
            logger.info(f"Reply too long ({len(final_reply)} chars), sharing via link...")
            share_url = self.sharing_service.share_text_sync(final_reply)
            if share_url:
                final_reply = f"📝 Response is too long for Signal. View full content here:\n\n{share_url}"
            else:
                # Fallback: Truncate if sharing fails
                if len(final_reply) > self.max_msg_len:
                    final_reply = final_reply[:self.max_msg_len - 50] + "... (truncated)"
        
        send_signal_reply(sender, final_reply)

    def _handle_attachments(self, attachments: list) -> tuple[str, list]:
        """Process attachments: Transcribe audio, return image paths."""
        text_parts = []
        image_paths = []

        # Validate base path before joining
        base_path = self.config.get("SIGNAL_DATA_PATH", "/Users/Shared/Server/AssistedVoice/signal_data")
        if not base_path:
            logger.warning("SIGNAL_DATA_PATH not set, cannot process attachments")
            return "", []

        data_path = os.path.join(base_path, "attachments")
        if not os.path.exists(data_path):
            logger.warning(f"Attachments directory not found: {data_path}")
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

        try:
            send_typing_indicator(sender, self.signal_number, True)
        except Exception as e:
            logger.warning(f"Failed to send typing indicator: {e}")

        result = execute_action(action_data)

        try:
            send_typing_indicator(sender, self.signal_number, False)
        except Exception as e:
            logger.warning(f"Failed to stop typing indicator: {e}")
        
        send_reaction(sender, timestamp, "✅", self.signal_number)
        
        reply_text = f"[{mode.upper()} - Executed]\n\n{result}"
        reply_text = format_markdown_for_signal(reply_text)
        
        # Auto-share if result is too long
        if len(reply_text) > self.share_threshold:
            logger.info(f"Execution result too long ({len(reply_text)} chars), sharing via link...")
            share_url = self.sharing_service.share_text_sync(reply_text)
            if share_url:
                reply_text = f"📝 Execution result is too long for Signal. View full output here:\n\n{share_url}"
            else:
                # Fallback: Truncate if sharing fails
                if len(reply_text) > self.max_msg_len:
                    reply_text = reply_text[:self.max_msg_len - 50] + "... (truncated)"

        send_signal_reply(sender, reply_text)

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
