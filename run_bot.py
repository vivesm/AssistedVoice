import logging
import signal
import sys
import time
import yaml
from modules.stt import WhisperSTT
from modules.llm_factory import create_llm
from modules.tts import EdgeTTS
from services.audio_service import AudioService
from services.signal_bot_service import SignalBotService
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def signal_handler(sig, frame):
    """Handle shutdown signals"""
    logger.info("Shutdown signal received")
    sys.exit(0)

def main():
    """Main entry point for standalone Signal Bot"""
    try:
        # Load environment
        load_dotenv()
        
        logger.info("Starting Standalone Signal Bot...")
        
        # Load configuration
        with open('config.yaml', 'r') as f:
            config = yaml.safe_load(f)
        
        # Initializing components
        # 1. Speech-to-Text (Remote Mode)
        logger.info("Initializing STT...")
        stt = WhisperSTT(config)
        stt.setup()
        
        # 2. Language Model (Remote Mode)
        # Note: SignalBotService creates its own LLM instance using the factory
        
        # 3. Text-to-Speech
        logger.info("Initializing TTS...")
        tts = EdgeTTS(config)
        
        # 4. Audio Service (Orchestrator)
        logger.info("Initializing Audio Service...")
        audio_service = AudioService(stt, tts)
        
        # 5. Signal Bot Service
        logger.info("Initializing Signal Bot Service...")
        bot_service = SignalBotService(config)
        
        # Start the bot (SignalBotService.start now handles ChatService internally)
        bot_service.start(audio_service)
        
        logger.info("Signal Bot is running. Press Ctrl+C to stop.")
        
        # Register signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
        
        # Keep main thread alive
        while True:
            time.sleep(1)
            
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
