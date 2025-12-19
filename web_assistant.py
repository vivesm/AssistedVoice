#!/usr/bin/env python3
"""
AssistedVoice FastAPI Backend
Modern async architecture with modular routers and services
"""
import os
import sys
import yaml
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from dotenv import load_dotenv
import socketio

# FastAPI imports
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from modules.stt import WhisperSTT
from modules.tts import create_tts_engine
from modules.llm_factory import create_llm

# Import routers and services
from routers.pages import register_page_routes
from routers.api import register_api_routes
from services.model_service import ModelService
from services.chat_service import ChatService
from services.audio_service import AudioService

# Load environment variables
load_dotenv()

# Add modules to path
sys.path.insert(0, str(Path(__file__).parent))

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global components (will be initialized on startup)
app_state = {
    'stt': None,
    'llm': None,
    'tts': None,
    'config': None,
    'model_service': None,
    'chat_service': None,
    'audio_service': None,
    'sio': None
}


async def initialize_components():
    """Initialize AI components asynchronously"""

    # Load configuration
    with open('config.yaml', 'r') as f:
        app_state['config'] = yaml.safe_load(f)

    logger.info("Initializing components...")

    # Initialize STT (runs in thread pool for blocking ops)
    app_state['stt'] = WhisperSTT(app_state['config'])
    logger.info("✓ Speech-to-Text initialized")

    # Initialize LLM using factory
    app_state['llm'] = create_llm(app_state['config'], optimized=True)
    logger.info(f"✓ Language Model initialized ({app_state['llm'].__class__.__name__})")

    # Initialize TTS
    app_state['tts'] = create_tts_engine(app_state['config'])
    logger.info("✓ Text-to-Speech initialized")

    # Initialize services
    app_state['model_service'] = ModelService(app_state['llm'], app_state['config'])
    app_state['chat_service'] = ChatService(app_state['llm'])
    app_state['audio_service'] = AudioService(app_state['stt'], app_state['tts'])
    logger.info("✓ Services initialized")

    return True


def print_startup_message():
    """Print startup message"""
    print("\n" + "=" * 60)
    print("   AssistedVoice - Push to Talk (FastAPI)")
    print("=" * 60)
    print()
    print("✓ All components initialized")
    print(f"✓ Model: {app_state['llm'].model}")
    print(f"✓ Whisper: {app_state['config']['whisper']['model']}")
    print(f"✓ TTS: {app_state['config']['tts']['engine']}")
    print()
    print("=" * 60)
    print()
    print("🌐 Open your browser to: http://localhost:5001")
    print("📚 API Documentation: http://localhost:5001/docs")
    print()
    print("Press Ctrl+C to stop the server")
    print("=" * 60)
    print()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events
    """
    # Startup
    logger.info("Starting AssistedVoice...")

    # Initialize components
    await initialize_components()

    # Register WebSocket handlers after components are initialized
    from routers.websocket import register_websocket_handlers
    register_websocket_handlers(
        sio,
        app_state['config'],
        app_state['stt'],
        app_state['tts'],
        app_state['chat_service'],
        app_state['audio_service'],
        app_state['model_service']
    )

    # Print startup message
    print_startup_message()

    logger.info("✓ AssistedVoice ready")

    yield

    # Shutdown
    logger.info("Shutting down AssistedVoice...")


# Create FastAPI app
app = FastAPI(
    title="AssistedVoice API",
    description="Voice assistant with Speech-to-Text, LLM, and Text-to-Speech",
    version="2.0.0",
    lifespan=lifespan
)

# CORS Configuration
cors_origins = os.environ.get('CORS_ALLOWED_ORIGINS', '*')
if cors_origins == '*':
    logger.warning("⚠️  CORS allows all origins (*). Set CORS_ALLOWED_ORIGINS in .env for production.")
    cors_origins = ["*"]
else:
    cors_origins = cors_origins.split(',')

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create Socket.IO server
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=cors_origins if cors_origins != ["*"] else '*',
    logger=False,
    engineio_logger=False
)
app_state['sio'] = sio

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")


def register_routes():
    """Register all routes and handlers"""
    # Register page routes
    register_page_routes(app)

    # Register API routes (pass app_state so routes can access current values)
    register_api_routes(app, app_state)

    logger.info("✓ Routes registered")


# Register routes
register_routes()

# Create ASGI application combining FastAPI and Socket.IO
# Note: WebSocket handlers are registered in lifespan after components init
socket_app = socketio.ASGIApp(
    sio,
    other_asgi_app=app,
    socketio_path='/socket.io'
)


if __name__ == '__main__':
    import uvicorn

    # Get configuration from environment
    port = int(os.environ.get('PORT', 5001))
    host = os.environ.get('HOST', '0.0.0.0')
    debug_mode = os.environ.get('FLASK_DEBUG', 'True').lower() == 'true'

    # Run with uvicorn
    uvicorn.run(
        "web_assistant:socket_app",
        host=host,
        port=port,
        reload=debug_mode,
        log_level="info"
    )
