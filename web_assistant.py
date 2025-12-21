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
from services.reading_service import ReadingService
from services.database_service import DatabaseService

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
    'reading_service': None,
    'database_service': None,
    'sio': None,
    'initialized': {
        'stt': False,
        'llm': False,
        'tts': False,
        'services': False
    }
}


async def initialize_components():
    """Initialize AI components asynchronously"""
    try:
        # Load configuration if not already loaded
        if not app_state['config']:
            with open('config.yaml', 'r') as f:
                app_state['config'] = yaml.safe_load(f)

        logger.info("Initializing components in background...")

        # Initialize TTS first (usually fast)
        try:
            app_state['tts'] = create_tts_engine(app_state['config'])
            app_state['initialized']['tts'] = True
            logger.info("✓ Text-to-Speech initialized")
        except Exception as e:
            logger.error(f"Error initializing TTS: {e}")

        # Initialize STT (can be slow)
        try:
            logger.info("Loading Speech-to-Text model...")
            app_state['stt'] = WhisperSTT(app_state['config'])
            app_state['initialized']['stt'] = True
            logger.info("✓ Speech-to-Text initialized")
        except Exception as e:
            logger.error(f"Error initializing STT: {e}")

        # Initialize LLM using factory (can be slow if it tests connection)
        try:
            logger.info("Connecting to Language Model...")
            app_state['llm'] = create_llm(app_state['config'], optimized=True)
            if app_state['llm']:
                app_state['initialized']['llm'] = True
                logger.info(f"✓ Language Model initialized ({app_state['llm'].__class__.__name__})")
            else:
                logger.warning("⚠️ Language Model failed to initialize.")
        except Exception as e:
            logger.error(f"Error during LLM initialization: {e}")
            app_state['llm'] = None

        # Initialize services
        from services.reading_service import ReadingService
        app_state['model_service'] = ModelService(app_state['llm'], app_state['config'])
        app_state['chat_service'] = ChatService(app_state['llm'])
        app_state['audio_service'] = AudioService(app_state['stt'], app_state['tts'])
        app_state['reading_service'] = ReadingService(app_state['config'])
        app_state['initialized']['services'] = True
        logger.info("✓ Services initialized")

        # Re-register WebSocket handlers if SIO is available
        if app_state['sio']:
            from routers.websocket import register_websocket_handlers
            register_websocket_handlers(
                app_state['sio'],
                app_state['config'],
                app_state['stt'],
                app_state['tts'],
                app_state['chat_service'],
                app_state['audio_service'],
                app_state['model_service'],
                app_state['reading_service'],
                app_state['database_service']
            )
            logger.info("✓ WebSocket handlers updated with initialized components")

        print_startup_message()
        return True
    except Exception as e:
        logger.error(f"Critical error during background initialization: {e}")
        return False


def print_startup_message():
    """Print startup message"""
    print("\n" + "=" * 60)
    print("   AssistedVoice - Push to Talk (FastAPI)")
    print("=" * 60)
    print()
    
    if app_state['initialized']['llm'] and app_state['llm']:
        print(f"✓ Model: {app_state['llm'].model}")
    else:
        print("⏳ Model: INITIALIZING or NOT CONNECTED")
        
    if app_state['initialized']['stt']:
        print(f"✓ Whisper: {app_state['config']['whisper']['model']}")
    else:
        print("⏳ Whisper: LOADING...")
        
    if app_state['initialized']['tts']:
        print(f"✓ TTS: {app_state['config']['tts']['engine']}")
    else:
        print("⏳ TTS: INITIALIZING...")
        
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

    # Load config immediately for routing and middleware
    try:
        with open('config.yaml', 'r') as f:
            app_state['config'] = yaml.safe_load(f)
    except Exception as e:
        logger.error(f"Failed to load config.yaml: {e}")
        # Use default empty config to avoid crashes
        app_state['config'] = {'ui': {}, 'audio': {}, 'whisper': {}, 'tts': {}, 'server': {}, 'ollama': {}, 'performance': {}, 'vad': {}, 'reading_mode': {}}

    # Initialize database service early (synchronous, fast)
    try:
        app_state['database_service'] = DatabaseService()
        logger.info("✓ Database service initialized")
    except Exception as e:
        logger.error(f"Failed to initialize database service: {e}")

    # Start initialization in background
    import asyncio
    asyncio.create_task(initialize_components())

    # Register initial WebSocket handlers (with None components)
    from routers.websocket import register_websocket_handlers
    register_websocket_handlers(
        sio,
        app_state['config'],
        None,
        None,
        None,
        None,
        None,
        None,
        app_state['database_service']
    )

    logger.info("✓ AssistedVoice server starting (components loading in background)")

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

# Create Socket.IO server with longer timeouts for live mode
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=cors_origins if cors_origins != ["*"] else '*',
    logger=False,
    engineio_logger=False,
    ping_timeout=60,      # Wait 60 seconds before disconnecting
    ping_interval=25      # Send ping every 25 seconds
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
