import logging
from signal_bot.chatops_bot import SignalBot
from modules.llm_factory import create_llm

logger = logging.getLogger(__name__)

class SignalBotService:
    """
    Service to manage the lifecycle of the Signal Bot
    """
    def __init__(self, config: dict):
        self.config = config
        self.bot = None

    def start(self, audio_service):
        """Initialize and start the bot"""
        try:
            logger.info("Initializing Signal Bot...")
            # Instantiate SignalBot with config, LLM factory, and audio service
            self.bot = SignalBot(self.config, create_llm, audio_service)
            self.bot.start()
            return True
        except Exception as e:
            logger.error(f"Failed to start Signal Bot: {e}")
            return False

    def stop(self):
        """Stop the bot"""
        if self.bot:
            self.bot.shutdown()
