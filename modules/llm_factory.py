"""
Factory for creating appropriate LLM instances based on server type
"""
import logging
from typing import Optional
from .config_helper import get_server_config
from .llm import OllamaLLM, OptimizedOllamaLLM
from .llm_lmstudio import LMStudioLLM
from .llm_base import BaseLLM, NullLLM

logger = logging.getLogger(__name__)


def create_llm(config: dict, optimized: bool = True) -> BaseLLM:
    """
    Create appropriate LLM instance based on server configuration
    
    Args:
        config: Configuration dictionary
        optimized: Whether to use optimized version (with caching) for Ollama
        
    Returns:
        BaseLLM instance (OllamaLLM, LMStudioLLM, etc.)
    """
    server_config = get_server_config(config)
    server_type = server_config.get('type', 'ollama')
    
    logger.info(f"Creating LLM instance for server type: {server_type}")
    
    try:
        if server_type == 'ollama':
            # Use Ollama implementation
            if optimized and config.get('performance', {}).get('cache_responses', True):
                logger.info("Using optimized Ollama with caching")
                return OptimizedOllamaLLM(config)
            else:
                logger.info("Using standard Ollama")
                return OllamaLLM(config)
        
        elif server_type == 'lm-studio':
            # Use LM Studio implementation
            logger.info("Using LM Studio OpenAI-compatible API")
            return LMStudioLLM(config)
        
        elif server_type == 'custom':
            # For custom servers, try to detect the type
            detected_type = detect_server_type(server_config['base_url'])
            logger.info(f"Detected server type: {detected_type}")
            
            if detected_type == 'ollama':
                return OllamaLLM(config) if not optimized else OptimizedOllamaLLM(config)
            elif detected_type == 'lm-studio':
                return LMStudioLLM(config)
            else:
                # Default to Ollama for unknown types
                logger.warning("Unknown server type, defaulting to Ollama")
                return OllamaLLM(config)
        
        else:
            # Default to Ollama for unknown types
            logger.warning(f"Unknown server type '{server_type}', defaulting to Ollama")
            return OllamaLLM(config)
    
    except Exception as e:
        logger.error(f"Failed to create LLM instance: {e}")
        logger.info("Falling back to default Ollama configuration (no-op host)")
        
        try:
            # Fallback to default Ollama but don't crash if it fails too
            fallback_config = config.copy()
            fallback_config['server'] = {
                'type': 'ollama',
                'host': 'localhost',
                'port': 11434
            }
            return OllamaLLM(fallback_config)
        except Exception as final_e:
            logger.error(f"Ultimate failure to initialize LLM: {final_e}")
            # Instead of crashing, return a NullLLM that reports the error gracefully
            return NullLLM(config, error_message=str(e))


def detect_server_type(base_url: str) -> str:
    """
    Detect the type of LLM server by checking its endpoints
    
    Args:
        base_url: Base URL of the server
        
    Returns:
        'ollama', 'lm-studio', or 'unknown'
    """
    import requests
    
    # Remove trailing slash
    base_url = base_url.rstrip('/')
    
    # Check for Ollama
    try:
        response = requests.get(f"{base_url}/api/tags", timeout=2)
        if response.status_code == 200:
            logger.info("Detected Ollama server")
            return 'ollama'
    except Exception:
        pass
    
    # Check for LM Studio (OpenAI-compatible)
    try:
        response = requests.get(f"{base_url}/v1/models", timeout=2)
        if response.status_code == 200:
            logger.info("Detected LM Studio server")
            return 'lm-studio'
    except Exception:
        pass
    
    # Check if base URL already includes /v1 (common for OpenAI-compatible)
    if '/v1' in base_url:
        try:
            response = requests.get(f"{base_url}/models", timeout=2)
            if response.status_code == 200:
                logger.info("Detected OpenAI-compatible server (likely LM Studio)")
                return 'lm-studio'
        except Exception:
            pass
    
    logger.warning("Could not detect server type")
    return 'unknown'


def test_llm_connection(config: dict) -> tuple[bool, str, str]:
    """
    Test connection to LLM server with current configuration
    
    Args:
        config: Configuration dictionary
        
    Returns:
        Tuple of (success, message, server_type)
    """
    try:
        # Try to create LLM instance
        llm = create_llm(config, optimized=False)
        
        # Test the connection
        success, message = llm.test_connection()
        
        # Get server type
        server_type = get_server_config(config).get('type', 'unknown')
        
        return success, message, server_type
    
    except Exception as e:
        return False, f"Failed to test connection: {str(e)}", 'unknown'


def switch_llm_server(current_llm: Optional[BaseLLM], new_config: dict) -> BaseLLM:
    """
    Switch to a different LLM server, preserving conversation if possible
    
    Args:
        current_llm: Current LLM instance (if any)
        new_config: New configuration to use
        
    Returns:
        New BaseLLM instance
    """
    # Save conversation history if exists
    conversation_history = None
    if current_llm:
        conversation_history = current_llm.conversation.messages.copy()
        logger.info(f"Preserving {len(conversation_history)} messages from previous conversation")
    
    # Create new LLM instance
    new_llm = create_llm(new_config)
    
    # Restore conversation history if available
    if conversation_history:
        new_llm.conversation.messages = conversation_history
        logger.info("Conversation history restored")
    
    return new_llm