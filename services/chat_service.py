"""
Chat service
Handles LLM interactions with MCP tool integration
"""
import re
import logging
from typing import Generator, Optional, Tuple, Dict, Any

logger = logging.getLogger(__name__)

# Intent patterns for different MCP tools
INTENT_PATTERNS = {
    'search': [
        r'\b(search|look up|find|google|search for|look for)\b.*\b(about|for|on|regarding)?\b',
        r'\bwhat is the latest\b',
        r'\bwhat\'?s new (with|in|about)\b',
        r'\bcurrent (news|events|status)\b',
        r'\brecent (news|developments|updates)\b',
        r'\btoday\'?s?\b.*(news|weather|price|score)',
        r'\b(who won|what happened|when is|where is)\b',
    ],
    'docs': [
        r'\b(docs|documentation|how to use|api for|library|package)\b.*(for|of|about)?\b',
        r'\bshow me.*(docs|documentation|api|examples)\b',
        r'\bhow (do i|to) (use|implement|setup|install)\b',
    ],
    'browse': [
        r'\b(open|go to|navigate to|visit|browse)\b.*\b(website|url|page|site)\b',
        r'\bwhat\'?s on\b.*\.(com|org|net|io)',
        r'\bcheck\b.*\b(website|page|url)\b',
    ],
}


class ChatService:
    """Service for managing chat/LLM interactions with MCP tools"""

    def __init__(self, llm, mcp_services: Optional[Dict[str, Any]] = None):
        """
        Initialize chat service
        
        Args:
            llm: Language model instance
            mcp_services: Dict of MCP service instances
        """
        self.llm = llm
        self.mcp_services = mcp_services or {}
        self._tools_enabled = True
        
        # For backwards compatibility
        self.search_service = self.mcp_services.get('search')
        self._search_enabled = True

    def _detect_intent(self, prompt: str) -> Tuple[Optional[str], Optional[str]]:
        """
        Detect user intent for MCP tool usage
        
        Returns:
            Tuple of (tool_type, extracted_query) or (None, None)
        """
        prompt_lower = prompt.lower().strip()
        
        # Check explicit commands first
        if prompt_lower.startswith(('search ', 'search: ', 'google ')):
            for prefix in ['search: ', 'search ', 'google ']:
                if prompt_lower.startswith(prefix):
                    return 'search', prompt[len(prefix):].strip()
        
        if prompt_lower.startswith(('docs ', 'docs: ', 'documentation ')):
            for prefix in ['docs: ', 'docs ', 'documentation ']:
                if prompt_lower.startswith(prefix):
                    return 'docs', prompt[len(prefix):].strip()
        
        if prompt_lower.startswith(('browse ', 'open ', 'visit ')):
            for prefix in ['browse ', 'open ', 'visit ']:
                if prompt_lower.startswith(prefix):
                    return 'browse', prompt[len(prefix):].strip()
        
        # Check pattern-based intents
        for tool_type, patterns in INTENT_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, prompt_lower):
                    return tool_type, prompt
        
        return None, None

    def _augment_with_search(self, prompt: str, query: str) -> str:
        """Augment prompt with web search results"""
        search = self.mcp_services.get('search')
        if not search or not search.is_available():
            logger.warning("Search service not available")
            return prompt
        
        logger.info(f"🔍 Searching web for: {query}")
        results = search.search(query, count=5)
        
        if not results:
            return prompt
        
        context = "\n".join([
            f"• {r['title']}: {r['description']}" 
            for r in results
        ])
        
        return f"""The user asked: {prompt}

Here are relevant web search results:

{context}

Based on these search results and your knowledge, provide a helpful answer. Cite sources when relevant."""

    def _augment_with_docs(self, prompt: str, query: str) -> str:
        """Augment prompt with library documentation"""
        context7 = self.mcp_services.get('context7')
        if not context7 or not context7.is_available():
            logger.warning("Context7 service not available")
            return prompt
        
        # Extract library name from query
        words = query.lower().split()
        library_name = words[0] if words else query
        topic = ' '.join(words[1:]) if len(words) > 1 else None
        
        logger.info(f"📚 Looking up docs for: {library_name}" + (f" (topic: {topic})" if topic else ""))
        docs = context7.lookup_docs(library_name, topic=topic)
        
        if not docs or docs.startswith("Could not find") or docs.startswith("No documentation"):
            return prompt
        
        # Truncate if too long
        max_doc_chars = 4000
        if len(docs) > max_doc_chars:
            docs = docs[:max_doc_chars] + "\n... [documentation truncated]"
        
        return f"""The user asked: {prompt}

Here is relevant documentation for {library_name}:

{docs}

Based on this documentation, provide a helpful and accurate answer."""

    def _augment_with_browse(self, prompt: str, url: str) -> str:
        """Augment prompt with page content from URL"""
        playwright = self.mcp_services.get('playwright')
        if not playwright or not playwright.is_available():
            logger.warning("Playwright service not available")
            return prompt
        
        # Extract URL from prompt if not already a URL
        url_match = re.search(r'https?://[^\s]+', url)
        if url_match:
            url = url_match.group(0)
        elif not url.startswith('http'):
            url = f"https://{url}"
        
        logger.info(f"🌐 Browsing: {url}")
        content = playwright.get_page_content(url)
        
        if not content or "Failed" in content:
            return prompt
        
        # Truncate if too long
        max_content_chars = 3000
        if len(content) > max_content_chars:
            content = content[:max_content_chars] + "\n... [content truncated]"
        
        return f"""The user asked: {prompt}

Here is the content from {url}:

{content}

Based on this page content, provide a helpful answer."""

    def generate_response(self, prompt: str, images: list = None, stream: bool = True) -> Generator[str, None, None]:
        """
        Generate response from LLM with MCP tool augmentation
        
        Args:
            prompt: User prompt/message
            images: Optional list of base64-encoded images
            stream: Whether to stream the response
            
        Yields:
            Response text chunks
        """
        try:
            logger.info(f"Generating response for: {prompt[:50]}...")
            
            # Detect and apply tool augmentation (only for text-only prompts)
            if self._tools_enabled and not images:
                tool_type, query = self._detect_intent(prompt)
                
                if tool_type and query:
                    if tool_type == 'search':
                        prompt = self._augment_with_search(prompt, query)
                    elif tool_type == 'docs':
                        prompt = self._augment_with_docs(prompt, query)
                    elif tool_type == 'browse':
                        prompt = self._augment_with_browse(prompt, query)
            
            # Generate response using LLM
            for chunk in self.llm.generate(prompt, images=images, stream=stream):
                yield chunk
                
        except Exception as e:
            logger.error(f"Error generating response: {e}")
            yield f"Error: {str(e)}"

    def set_tools_enabled(self, enabled: bool):
        """Enable or disable MCP tool usage"""
        self._tools_enabled = enabled
        logger.info(f"MCP tools {'enabled' if enabled else 'disabled'}")
    
    # Backwards compatibility
    def set_search_enabled(self, enabled: bool):
        """Enable or disable automatic web search (deprecated, use set_tools_enabled)"""
        self._search_enabled = enabled
        self._tools_enabled = enabled

    def clear_conversation(self):
        """Clear conversation history"""
        try:
            self.llm.conversation.messages.clear()
            logger.info("Conversation cleared")
        except Exception as e:
            logger.error(f"Error clearing conversation: {e}")
            raise

    def update_temperature(self, temperature: float):
        """Update LLM temperature setting"""
        try:
            self.llm.temperature = temperature
            logger.info(f"Temperature updated to: {temperature}")
        except Exception as e:
            logger.error(f"Error updating temperature: {e}")
            raise

    def update_max_tokens(self, max_tokens: int):
        """Update max tokens setting"""
        try:
            self.llm.max_tokens = max_tokens
            logger.info(f"Max tokens updated to: {max_tokens}")
        except Exception as e:
            logger.error(f"Error updating max tokens: {e}")
            raise

    def update_system_prompt(self, system_prompt: str):
        """Update system prompt"""
        try:
            self.llm.system_prompt = system_prompt
            logger.info("System prompt updated")
        except Exception as e:
            logger.error(f"Error updating system prompt: {e}")
            raise
