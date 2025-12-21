"""
Chat service
Handles LLM interactions and conversation management
"""
import re
import logging
from typing import Generator, Optional, Tuple

logger = logging.getLogger(__name__)

# Search intent patterns
SEARCH_PATTERNS = [
    r'\b(search|look up|find|google|search for|look for)\b.*\b(about|for|on|regarding)?\b',
    r'\bwhat is the latest\b',
    r'\bwhat\'?s new (with|in|about)\b',
    r'\bcurrent (news|events|status)\b',
    r'\brecent (news|developments|updates)\b',
    r'\btoday\'?s?\b.*(news|weather|price|score)',
    r'\b(who won|what happened|when is|where is)\b',
]


class ChatService:
    """Service for managing chat/LLM interactions"""

    def __init__(self, llm, search_service=None):
        """
        Initialize chat service

        Args:
            llm: Language model instance
            search_service: Optional SearchService for web search
        """
        self.llm = llm
        self.search_service = search_service
        self._search_enabled = True  # Can be toggled

    def _detect_search_intent(self, prompt: str) -> Tuple[bool, Optional[str]]:
        """
        Detect if user wants to search the web

        Returns:
            Tuple of (should_search, search_query)
        """
        prompt_lower = prompt.lower().strip()
        
        # Check for explicit search commands
        if prompt_lower.startswith(('search ', 'search: ', 'look up ', 'google ')):
            # Extract query after command
            for prefix in ['search: ', 'search ', 'look up ', 'google ']:
                if prompt_lower.startswith(prefix):
                    query = prompt[len(prefix):].strip()
                    return True, query
        
        # Check for search intent patterns
        for pattern in SEARCH_PATTERNS:
            if re.search(pattern, prompt_lower):
                # Use the full prompt as search query (cleaner results)
                return True, prompt
        
        return False, None

    def _augment_with_search(self, prompt: str, search_query: str) -> str:
        """
        Augment prompt with web search results
        
        Args:
            prompt: Original user prompt
            search_query: Query to search for
            
        Returns:
            Augmented prompt with search context
        """
        if not self.search_service or not self.search_service.is_available():
            logger.warning("Search service not available")
            return prompt
        
        logger.info(f"Searching web for: {search_query}")
        results = self.search_service.search(search_query, count=5)
        
        if not results:
            return prompt
        
        # Format search results for context
        search_context = "\n".join([
            f"• {r['title']}: {r['description']}" 
            for r in results
        ])
        
        augmented_prompt = f"""The user asked: {prompt}

Here are relevant web search results to help answer their question:

{search_context}

Based on these search results and your knowledge, please provide a helpful answer to the user's question. Cite sources when relevant."""
        
        logger.info(f"Augmented prompt with {len(results)} search results")
        return augmented_prompt

    def generate_response(self, prompt: str, images: list = None, stream: bool = True) -> Generator[str, None, None]:
        """
        Generate response from LLM

        Args:
            prompt: User prompt/message
            images: Optional list of base64-encoded images
            stream: Whether to stream the response

        Yields:
            Response text chunks if streaming, full response otherwise
        """
        try:
            logger.info(f"Generating response for: {prompt[:50]}...")
            
            # Check for search intent (only for text-only prompts)
            if self._search_enabled and not images and self.search_service:
                should_search, search_query = self._detect_search_intent(prompt)
                if should_search and search_query:
                    prompt = self._augment_with_search(prompt, search_query)

            # Generate response using LLM (with images if provided)
            for chunk in self.llm.generate(prompt, images=images, stream=stream):
                yield chunk

        except Exception as e:
            logger.error(f"Error generating response: {e}")
            yield f"Error: {str(e)}"

    def set_search_enabled(self, enabled: bool):
        """Enable or disable automatic web search"""
        self._search_enabled = enabled
        logger.info(f"Web search {'enabled' if enabled else 'disabled'}")

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
            logger.info("System prompt updated")
        except Exception as e:
            logger.error(f"Error updating system prompt: {e}")
            raise
