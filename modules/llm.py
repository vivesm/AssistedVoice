"""
Language Model interface using Ollama
"""
import time
import logging
from typing import Optional, Generator, List, Dict, Any
import ollama
from ollama import Client
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class Message:
    """Conversation message"""
    role: str  # 'user' or 'assistant'
    content: str
    timestamp: datetime = None
    
    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.now()


class ConversationManager:
    """Manage conversation history and context"""
    
    def __init__(self, max_history: int = 10, max_tokens: int = 4096):
        self.messages: List[Message] = []
        self.max_history = max_history
        self.max_tokens = max_tokens
        
    def add_message(self, role: str, content: str):
        """Add a message to the conversation"""
        message = Message(role=role, content=content)
        self.messages.append(message)
        
        # Trim history if needed
        if len(self.messages) > self.max_history * 2:  # Keep pairs
            self.messages = self.messages[-self.max_history * 2:]
        
        return message
    
    def get_context(self, system_prompt: Optional[str] = None) -> List[Dict[str, str]]:
        """Get conversation context for LLM"""
        context = []
        
        # Add system prompt if provided
        if system_prompt:
            context.append({"role": "system", "content": system_prompt})
        
        # Add conversation history
        for msg in self.messages:
            context.append({"role": msg.role, "content": msg.content})
        
        return context
    
    def clear(self):
        """Clear conversation history"""
        self.messages = []
        logger.info("Conversation history cleared")
    
    def get_summary(self) -> str:
        """Get a summary of the conversation"""
        if not self.messages:
            return "No conversation yet"
        
        summary = f"Conversation ({len(self.messages)} messages):\n"
        for msg in self.messages[-6:]:  # Last 3 exchanges
            role = "You" if msg.role == "user" else "Assistant"
            summary += f"{role}: {msg.content[:100]}...\n"
        
        return summary


class OllamaLLM:
    """Ollama Language Model interface"""
    
    def __init__(self, config: dict):
        self.config = config
        self.client = None
        self.model = config['ollama']['model']
        self.fallback_model = config['ollama'].get('fallback_model')
        self.conversation = ConversationManager(
            max_tokens=config['ollama'].get('context_window', 4096)
        )
        self.setup()
    
    def setup(self):
        """Initialize Ollama client"""
        try:
            self.client = Client()
            # Test connection
            models = self.client.list()
            # Handle different response formats
            available_models = []
            if hasattr(models, 'models'):
                # New ollama API format
                for m in models.models:
                    if hasattr(m, 'name'):
                        available_models.append(m.name)
                    elif hasattr(m, 'model'):
                        available_models.append(m.model)
            elif isinstance(models, dict) and 'models' in models:
                available_models = [m.get('name', m.get('model', str(m))) for m in models['models']]
            elif isinstance(models, list):
                available_models = [m.get('name', m.get('model', str(m))) for m in models]
            
            logger.info(f"Connected to Ollama. Available models: {available_models}")
            
            # Check if desired model is available
            if self.model not in available_models:
                logger.warning(f"Model '{self.model}' not found. Available: {available_models}")
                if self.fallback_model and self.fallback_model in available_models:
                    logger.info(f"Using fallback model: {self.fallback_model}")
                    self.model = self.fallback_model
                else:
                    raise ValueError(f"Model '{self.model}' not available. Please pull it first.")
        
        except Exception as e:
            logger.error(f"Failed to connect to Ollama: {e}")
            logger.info("Please make sure Ollama is running: 'ollama serve'")
            raise
    
    def generate(self, prompt: str, stream: bool = True) -> Generator[str, None, None]:
        """Generate response from LLM"""
        # Add user message to conversation
        self.conversation.add_message("user", prompt)
        
        # Get conversation context
        messages = self.conversation.get_context(
            system_prompt=self.config['ollama'].get('system_prompt')
        )
        
        # Generation parameters
        options = {
            'temperature': self.config['ollama'].get('temperature', 0.7),
            'num_predict': self.config['ollama'].get('max_tokens', 500),
        }
        
        try:
            start_time = time.time()
            first_token_time = None
            full_response = ""
            
            # Stream response
            response = self.client.chat(
                model=self.model,
                messages=messages,
                stream=stream,
                options=options
            )
            
            if stream:
                for chunk in response:
                    if first_token_time is None:
                        first_token_time = time.time()
                        latency = (first_token_time - start_time) * 1000
                        logger.info(f"First token latency: {latency:.0f}ms")
                    
                    content = chunk['message']['content']
                    full_response += content
                    yield content
            else:
                full_response = response['message']['content']
                yield full_response
            
            # Add assistant response to conversation
            self.conversation.add_message("assistant", full_response)
            
            # Log performance metrics
            total_time = time.time() - start_time
            tokens = len(full_response.split())
            tokens_per_sec = tokens / total_time if total_time > 0 else 0
            logger.info(f"Generated {tokens} tokens in {total_time:.2f}s ({tokens_per_sec:.1f} t/s)")
            
        except Exception as e:
            logger.error(f"Generation error: {e}")
            yield f"Error: {str(e)}"
    
    def generate_complete(self, prompt: str) -> str:
        """Generate complete response (non-streaming)"""
        response = ""
        for chunk in self.generate(prompt, stream=False):
            response += chunk
        return response
    
    def clear_conversation(self):
        """Clear conversation history"""
        self.conversation.clear()
    
    def get_conversation_summary(self) -> str:
        """Get conversation summary"""
        return self.conversation.get_summary()


class ResponseCache:
    """Cache common responses for faster replies"""
    
    def __init__(self, max_size: int = 100):
        self.cache: Dict[str, str] = {}
        self.max_size = max_size
        self.hits = 0
        self.misses = 0
    
    def get(self, prompt: str) -> Optional[str]:
        """Get cached response"""
        # Simple exact match for now
        response = self.cache.get(prompt.lower().strip())
        if response:
            self.hits += 1
            logger.debug(f"Cache hit for: {prompt[:50]}...")
            return response
        
        self.misses += 1
        return None
    
    def set(self, prompt: str, response: str):
        """Cache a response"""
        if len(self.cache) >= self.max_size:
            # Remove oldest entry (simple FIFO)
            oldest = next(iter(self.cache))
            del self.cache[oldest]
        
        self.cache[prompt.lower().strip()] = response
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        total = self.hits + self.misses
        hit_rate = (self.hits / total * 100) if total > 0 else 0
        
        return {
            'size': len(self.cache),
            'hits': self.hits,
            'misses': self.misses,
            'hit_rate': f"{hit_rate:.1f}%"
        }


class OptimizedOllamaLLM(OllamaLLM):
    """Optimized Ollama with caching and performance features"""
    
    def __init__(self, config: dict):
        super().__init__(config)
        self.cache = ResponseCache(
            max_size=config['performance'].get('max_cache_size', 100)
        ) if config['performance'].get('cache_responses', True) else None
    
    def generate(self, prompt: str, stream: bool = True) -> Generator[str, None, None]:
        """Generate with caching support"""
        # Check cache first
        if self.cache and not stream:
            cached = self.cache.get(prompt)
            if cached:
                yield cached
                return
        
        # Generate response
        full_response = ""
        for chunk in super().generate(prompt, stream):
            full_response += chunk
            yield chunk
        
        # Cache the response
        if self.cache and not stream:
            self.cache.set(prompt, full_response)