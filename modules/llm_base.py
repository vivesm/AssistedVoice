"""
Base LLM interface for multiple server types
"""
from abc import ABC, abstractmethod
from typing import Generator, Dict, Any, Optional, List
from dataclasses import dataclass
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@dataclass
class Message:
    """Unified message format for all LLM implementations"""
    role: str  # 'user', 'assistant', or 'system'
    content: str
    images: Optional[List[str]] = None  # List of base64-encoded images
    timestamp: datetime = None
    
    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.now()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary format"""
        result = {"role": self.role, "content": self.content}
        if self.images:
            result["images"] = self.images
        return result


class ConversationManagerBase:
    """Base conversation management for all LLM types"""
    
    def __init__(self, max_history: int = 10, max_tokens: int = 4096):
        self.messages: List[Message] = []
        self.max_history = max_history
        self.max_tokens = max_tokens
    
    def add_message(self, role: str, content: str, images: Optional[List[str]] = None) -> Message:
        """Add a message to the conversation"""
        message = Message(role=role, content=content, images=images)
        self.messages.append(message)
        
        # Trim history if needed (keep pairs)
        if len(self.messages) > self.max_history * 2:
            self.messages = self.messages[-self.max_history * 2:]
        
        return message
    
    def get_context(self, system_prompt: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get conversation context for LLM"""
        context = []
        
        # Add system prompt if provided
        if system_prompt:
            context.append({"role": "system", "content": system_prompt})
        
        # Add conversation history
        for msg in self.messages:
            context.append(msg.to_dict())
        
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


class BaseLLM(ABC):
    """Abstract base class for all LLM implementations"""
    
    def __init__(self, config: dict):
        """
        Initialize the LLM with configuration
        
        Args:
            config: Configuration dictionary containing server and model settings
        """
        self.config = config
        self.conversation = ConversationManagerBase(
            max_tokens=config.get('context_window', 4096)
        )
        self.model = None
        self.client = None
    
    @abstractmethod
    def setup(self):
        """Initialize the LLM client and verify connection"""
        pass
    
    @abstractmethod
    def generate(self, prompt: str, stream: bool = True) -> Generator[str, None, None]:
        """
        Generate response from the LLM
        
        Args:
            prompt: The user's input prompt
            stream: Whether to stream the response
            
        Yields:
            Response chunks as strings
        """
        pass
    
    @abstractmethod
    def list_models(self) -> List[str]:
        """
        List available models on the server
        
        Returns:
            List of model names
        """
        pass
    
    @abstractmethod
    def test_connection(self) -> tuple[bool, str]:
        """
        Test connection to the LLM server
        
        Returns:
            Tuple of (success, message)
        """
        pass
    
    def generate_complete(self, prompt: str) -> str:
        """
        Generate complete response (non-streaming)
        
        Args:
            prompt: The user's input prompt
            
        Returns:
            Complete response as a string
        """
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
    
    def get_model_info(self) -> Dict[str, Any]:
        """
        Get information about the current model
        
        Returns:
            Dictionary with model information
        """
        return {
            "model": self.model,
            "type": self.__class__.__name__,
            "server": getattr(self, 'server_url', 'unknown'),
            "conversation_length": len(self.conversation.messages)
        }


class NullLLM(BaseLLM):
    """Fallback LLM for when connections fail"""
    
    def __init__(self, config: dict, error_message: str = "LLM not connected"):
        super().__init__(config)
        self.model = "Disconnected"
        self.error_message = error_message
        
    def setup(self):
        pass
        
    def list_models(self) -> List[str]:
        return []
        
    def test_connection(self) -> tuple[bool, str]:
        return False, self.error_message
        
    def generate(self, prompt: str, stream: bool = True) -> Generator[str, None, None]:
        yield f"Error: {self.error_message}. Please check your configuration and ensure the LLM server is accessible."