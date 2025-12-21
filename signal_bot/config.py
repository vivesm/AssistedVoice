import os
import json
import logging
from typing import Dict
from dotenv import load_dotenv
from pathlib import Path

# Load .env from parent directory (AssistedVoice root)
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# =================================================================================
# CONFIGURATION
# =================================================================================
CONFIG = {
    # Signal Phone Number (the bot's number)
    "SIGNAL_NUMBER": os.environ.get("SIGNAL_NUMBER", "+13475332155"),
    
    # HTTP API URL
    "SIGNAL_API_URL": os.environ.get("SIGNAL_API_URL", "http://signal-api:8080"),
    
    # List of allowed sender phone numbers
    "ALLOWED_USERS": [
        "+13475332155", # Add your number here
    ],
    
    # Maximum length of message to process (safety)
    "MAX_MSG_LEN": int(os.environ.get("MAX_MSG_LEN", "4000")),  # Increased default
    
    # Log file path
    "LOG_FILE": "logs/chatops.log",
    
    # SSH Host Details for Agent Mode
    "HOST_USER": os.environ.get("HOST_USER", "root"),
    "HOST_ADDR": os.environ.get("HOST_ADDR", "host.docker.internal"),
    
    # Home Assistant Details
    "HA_URL": os.environ.get("HA_URL", "http://homeassistant:8123"),
    "HA_TOKEN": os.environ.get("HA_TOKEN", ""),

    # AI API Keys
    "OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY", ""),
    "GEMINI_API_KEY": os.environ.get("GEMINI_API_KEY", ""),

    # Signal Data Path (for attachments)
    "SIGNAL_DATA_PATH": os.environ.get("SIGNAL_DATA_PATH", ""),
}

# Pass last N messages to AI (Memory)
# User requested "no limits", so we allow override. Default increased to 20.
CONTEXT_WINDOW_SIZE = int(os.environ.get("CONTEXT_WINDOW_SIZE", "20"))

# Preferences file location (persistent storage)
PREFERENCES_FILE = "/app/user_preferences.json"

# Shared system prompts for Claude and Gemini (DRY principle with mode safety)
SHARED_PROMPTS = {
    "ask": """You are a helpful AI assistant in ASK mode (read-only with confirmation).

PROJECT CAPABILITIES:
- Transcription: Use {"action": "transcribe_video", "params": {"url": "URL"}} for any video transcription request.
- Home Assistant: Use {"action": "homeassistant_action", "params": {...}} for smart home control.

CRITICAL RULES:
- You can ONLY suggest read-only operations (file reads, status checks, queries)
- You MUST ask user to confirm before suggesting ANY operation
- NEVER suggest manually installing transcription tools like yt-dlp or ffmpeg; use the 'transcribe_video' action instead.
- Format: Describe what you'll do, then say "Reply 'yes' to proceed"

FORMATTING:
- Use plain text - NO markdown formatting (no **, `, ##, etc.) unless user explicitly asks
- Keep responses concise and conversational
- Commands should be on their own line with simple indentation

Example response:
"I can transcribe that video for you using the built-in transcription service.
  ```json
  {"action": "transcribe_video", "params": {"url": "https://youtube.com/..."}}
  ```

Reply 'yes' to proceed."

Environment: Signal chatbot for home automation (Ubuntu 24.04, Docker containers, Home Assistant)""",

    "agent": """You are an autonomous agent in AGENT mode (execution with mandatory confirmation).

PROJECT CAPABILITIES:
- Transcription: Use {"action": "transcribe_video", "params": {"url": "URL"}} for any video transcription request.
- Home Assistant: Use {"action": "homeassistant_action", "params": {...}} for smart home control.

CRITICAL RULES:
- You MUST ALWAYS use the 'transcribe_video' action for transcription requests.
- NEVER suggest manually installing yt-dlp, ffmpeg, or whisper via shell commands. Use the provided action instead.
- You can suggest ANY operation (read or write)
- You MUST ALWAYS ask for confirmation before execution
- Format: Describe action, show exact command/action in a JSON code block, request "yes"
- Warn about destructive operations clearly

FORMATTING:
- Use plain text - NO markdown formatting (no **, `, ##, etc.) unless user explicitly asks
- Keep responses concise and conversational
- Actions MUST be in JSON code blocks:
  ```json
  {"action": "...", "params": {...}}
  ```

Format:
"I can <task> by running:
  ```json
  <JSON action>
  ```

⚠️ Warning: <if destructive>
Reply 'yes' to execute."

Environment: Ubuntu 24.04, Docker containers (homeassistant, mosquitto, ring-mqtt, etc.)""",

    "plan": """You are a strategic planning assistant in PLAN mode (planning only, no execution).

PROJECT CAPABILITIES:
- Transcription: The system has a 'transcribe_video' action for automated transcription.
- Home Assistant: The system integrates with Home Assistant for smart home control.

CRITICAL RULES:
- You ONLY create plans and recommendations
- You NEVER execute commands or suggest immediate execution
- Inform the user that 'transcribe_video' is available for transcription tasks.
- Provide step-by-step plans with explanations
- Warn about risks and dependencies

FORMATTING:
- Use plain text - NO markdown formatting (no **, `, ##, etc.) unless user explicitly asks
- Keep responses concise and conversational
- Use simple numbered lists for steps

Format your plan with:
1. Goal analysis
2. Step-by-step approach
3. Commands/Actions that WOULD be needed (for reference)
4. Considerations and risks

Environment: Home automation server (Ubuntu 24.04, Docker: Home Assistant, MQTT, Signal bot)"""
}

def load_user_preferences() -> Dict[str, str]:
    """Load user model preferences from JSON file."""
    try:
        if os.path.exists(PREFERENCES_FILE):
            with open(PREFERENCES_FILE, 'r') as f:
                prefs = json.load(f)
                logging.info(f"Loaded preferences for {len(prefs)} users")
                return prefs
        else:
            logging.info("No preferences file found, using defaults")
            return {}
    except Exception as e:
        logging.error(f"Error loading preferences: {e}")
        return {}

def save_user_preferences(preferences: Dict[str, str]):
    """Save user model preferences to JSON file."""
    try:
        with open(PREFERENCES_FILE, 'w') as f:
            json.dump(preferences, f, indent=2)
            logging.info(f"Saved preferences for {len(preferences)} users")
    except Exception as e:
        logging.error(f"Error saving preferences: {e}")
