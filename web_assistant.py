#!/usr/bin/env python3
"""
AssistedVoice Simple Push-to-Talk Backend
Modular architecture with routers and services
"""
import os
import sys
import yaml
from pathlib import Path
from flask import Flask
from flask_socketio import SocketIO
from flask_cors import CORS
import logging
from dotenv import load_dotenv
import secrets

# Load environment variables from .env file
load_dotenv()

# Add modules to path
sys.path.insert(0, str(Path(__file__).parent))

from modules.stt import WhisperSTT
from modules.tts import create_tts_engine
from modules.llm_factory import create_llm

# Import routers and services
from routers.pages import register_page_routes
from routers.api import register_api_routes
from routers.websocket import register_websocket_handlers
from services.model_service import ModelService
from services.chat_service import ChatService
from services.audio_service import AudioService

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)

# Security Configuration
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY') or secrets.token_hex(32)

# Warn if using default random secret key
if not os.environ.get('SECRET_KEY'):
    logger.warning("⚠️  Using random SECRET_KEY. Set SECRET_KEY in .env for persistent sessions.")

# Template auto-reload
app.config['TEMPLATES_AUTO_RELOAD'] = True

# CORS Configuration
cors_origins = os.environ.get('CORS_ALLOWED_ORIGINS', '*')
if cors_origins == '*':
    logger.warning("⚠️  CORS allows all origins (*). Set CORS_ALLOWED_ORIGINS in .env for production.")

CORS(app)
socketio = SocketIO(app, cors_allowed_origins=cors_origins)

# Global components
stt = None
llm = None
tts = None
config = None

# Services
model_service = None
chat_service = None
audio_service = None


def initialize_components():
    """Initialize AI components"""
    global stt, llm, tts, config, model_service, chat_service, audio_service

    # Load configuration
    with open('config.yaml', 'r') as f:
        config = yaml.safe_load(f)

    logger.info("Initializing components...")

    # Initialize STT
    stt = WhisperSTT(config)
    logger.info("✓ Speech-to-Text initialized")

    # Initialize LLM using factory
    llm = create_llm(config, optimized=True)
    logger.info(f"✓ Language Model initialized ({llm.__class__.__name__})")

    # Initialize TTS
    tts = create_tts_engine(config)
    logger.info("✓ Text-to-Speech initialized")

    # Initialize services
    model_service = ModelService(llm, config)
    chat_service = ChatService(llm)
    audio_service = AudioService(stt, tts)
    logger.info("✓ Services initialized")

    return True


def register_routes():
    """Register all routes and handlers"""
    global config, stt, llm, tts, model_service, chat_service, audio_service

    # Register page routes
    register_page_routes(app)

    # Register API routes
    register_api_routes(app, config, llm, stt, model_service)

    # Register WebSocket handlers
    register_websocket_handlers(socketio, config, stt, tts, chat_service, audio_service, model_service)

    logger.info("✓ Routes and handlers registered")


def print_startup_message():
    """Print startup message"""
    print("\n" + "=" * 60)
    print("   AssistedVoice - Push to Talk")
    print("=" * 60)
    print()
    print("✓ All components initialized")
    print(f"✓ Model: {llm.model}")
    print(f"✓ Whisper: {config['whisper']['model']}")
    print(f"✓ TTS: {config['tts']['engine']}")
    print()
    print("=" * 60)
    print()
    print("🌐 Open your browser to: http://localhost:5001")
    print()
    print("Press Ctrl+C to stop the server")
    print("=" * 60)
    print()


if __name__ == '__main__':
    # Initialize components
    if initialize_components():
        # Register routes
        register_routes()

        # Print startup message
        print_startup_message()

        # Get port from environment or use default
        port = int(os.environ.get('PORT', 5001))
        host = os.environ.get('HOST', '0.0.0.0')

        # Start server
        debug_mode = os.environ.get('FLASK_DEBUG', 'True').lower() == 'true'
        socketio.run(app, host=host, port=port, debug=debug_mode, allow_unsafe_werkzeug=True)
