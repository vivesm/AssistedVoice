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
            
            # Create LLM for the bot to use via factory
            llm = create_llm(self.config)
            
            # Initialize ChatService with MCP tools for the bot
            # We need to import MCP getters here to avoid circular imports
            from services.mcp_service import (
                get_brave_search, get_context7, get_playwright,
                get_docker, get_desktop_commander, get_memory, get_sequential_thinking,
                get_video_vives
            )
            from services.chat_service import ChatService
            
            mcp_services = {
                'search': get_brave_search(),
                'context7': get_context7(),
                'playwright': get_playwright(),
                'docker': get_docker(),
                'desktop': get_desktop_commander(),
                'memory': get_memory(),
                'thinking': get_sequential_thinking(),
                'video': get_video_vives(),
            }
            
            chat_service = ChatService(llm, mcp_services=mcp_services)
            
            # Instantiate SignalBot with config, LLM factory, audio service, and chat service
            self.bot = SignalBot(self.config, create_llm, audio_service, chat_service=chat_service)
            self.bot.start()
            return True
        except Exception as e:
            logger.error(f"Failed to start Signal Bot: {e}")
            return False

    def stop(self):
        """Stop the bot"""
        if self.bot:
            self.bot.shutdown()
