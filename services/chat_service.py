"""
Chat service
Handles LLM interactions and conversation management
"""
import logging
from typing import Generator

logger = logging.getLogger(__name__)


class ChatService:
    """Service for managing chat/LLM interactions"""

    def __init__(self, llm):
        """
        Initialize chat service

        Args:
            llm: Language model instance
        """
        self.llm = llm

    def generate_response(self, prompt: str, stream: bool = True) -> Generator[str, None, None]:
        """
        Generate response from LLM

        Args:
            prompt: User prompt/message
            stream: Whether to stream the response

        Yields:
            Response text chunks if streaming, full response otherwise
        """
        try:
            logger.info(f"Generating response for: {prompt[:50]}...")

            # Generate response using LLM
            for chunk in self.llm.generate(prompt, stream=stream):
                yield chunk

        except Exception as e:
            logger.error(f"Error generating response: {e}")
            yield f"Error: {str(e)}"

    def clear_conversation(self):
        """Clear conversation history"""
        try:
            self.llm.conversation.messages.clear()
            logger.info("Conversation cleared")
        except Exception as e:
            logger.error(f"Error clearing conversation: {e}")
            raise

    def update_temperature(self, temperature: float):
        """
        Update LLM temperature setting

        Args:
            temperature: Temperature value (0.0 - 1.0)
        """
        try:
            self.llm.temperature = temperature
            logger.info(f"Temperature updated to: {temperature}")
        except Exception as e:
            logger.error(f"Error updating temperature: {e}")
            raise

    def update_max_tokens(self, max_tokens: int):
        """
        Update max tokens setting

        Args:
            max_tokens: Maximum tokens for response
        """
        try:
            self.llm.max_tokens = max_tokens
            logger.info(f"Max tokens updated to: {max_tokens}")
        except Exception as e:
            logger.error(f"Error updating max tokens: {e}")
            raise

    def update_system_prompt(self, system_prompt: str):
        """
        Update system prompt

        Args:
            system_prompt: New system prompt
        """
        try:
            self.llm.system_prompt = system_prompt
            logger.info(f"System prompt updated")
        except Exception as e:
            logger.error(f"Error updating system prompt: {e}")
            raise
