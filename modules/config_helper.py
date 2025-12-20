"""
Configuration helper functions for server settings
"""
import os
import logging
import yaml
from pathlib import Path
from typing import Dict, Any

logger = logging.getLogger(__name__)


def get_server_config(config: dict) -> Dict[str, Any]:
    """
    Get server configuration with environment variable override support.
    
    Priority order:
    1. Environment variables
    2. Config file settings
    3. Default values
    
    Args:
        config: The main configuration dictionary
        
    Returns:
        Dictionary with server configuration
    """
    server_config = config.get('server', {})
    
    # Get base settings with environment variable overrides
    server_type = os.environ.get('LLM_SERVER_TYPE', server_config.get('type', 'ollama'))
    host = os.environ.get('OLLAMA_HOST', os.environ.get('LM_STUDIO_HOST', 
                         server_config.get('host', 'localhost')))
    
    # Handle port based on server type
    default_port = 11434 if server_type == 'ollama' else 1234
    port = int(os.environ.get('OLLAMA_PORT', os.environ.get('LM_STUDIO_PORT', 
                              server_config.get('port', default_port))))
    
    # Timeout and retry settings
    timeout = int(os.environ.get('LLM_TIMEOUT', server_config.get('timeout', 30)))
    retry_attempts = int(os.environ.get('LLM_RETRY_ATTEMPTS', 
                                       server_config.get('retry_attempts', 3)))
    
    # Build the configuration
    result = {
        'type': server_type,
        'host': host,
        'port': port,
        'timeout': timeout,
        'retry_attempts': retry_attempts,
        'base_url': f"http://{host}:{port}"
    }
    
    # Add LM Studio specific settings if applicable
    if server_type == 'lm-studio':
        lm_config = server_config.get('lm_studio', {})
        result['api_key'] = os.environ.get('LM_STUDIO_API_KEY', 
                                          lm_config.get('api_key', 'not-needed'))
        result['api_base_path'] = lm_config.get('base_url', '/v1')
        result['base_url'] = f"http://{host}:{port}{result['api_base_path']}"
    
    logger.info(f"Server configuration: {server_type} at {host}:{port}")
    return result


def validate_server_config(server_config: Dict[str, Any]) -> tuple[bool, str]:
    """
    Validate server configuration.
    
    Args:
        server_config: Server configuration dictionary
        
    Returns:
        Tuple of (is_valid, error_message)
    """
    # Check required fields
    required_fields = ['type', 'host', 'port']
    for field in required_fields:
        if field not in server_config:
            return False, f"Missing required field: {field}"
    
    # Validate server type
    valid_types = ['ollama', 'lm-studio', 'custom']
    if server_config['type'] not in valid_types:
        return False, f"Invalid server type: {server_config['type']}. Must be one of {valid_types}"
    
    # Validate port
    port = server_config.get('port')
    if not isinstance(port, int) or port < 1 or port > 65535:
        return False, f"Invalid port: {port}. Must be between 1 and 65535"
    
    # Validate timeout
    timeout = server_config.get('timeout', 30)
    if not isinstance(timeout, (int, float)) or timeout <= 0:
        return False, f"Invalid timeout: {timeout}. Must be positive number"
    
    return True, ""


def get_server_url(config: dict) -> str:
    """
    Get the complete server URL for the configured server.
    
    Args:
        config: The main configuration dictionary
        
    Returns:
        Complete server URL
    """
    server_config = get_server_config(config)
    return server_config['base_url']


def is_lm_studio(config: dict) -> bool:
    """
    Check if the configured server is LM Studio.
    
    Args:
        config: The main configuration dictionary
        
    Returns:
        True if server type is LM Studio
    """
    server_config = get_server_config(config)
    return server_config['type'] == 'lm-studio'


def is_ollama(config: dict) -> bool:
    """
    Check if the configured server is Ollama.
    
    Args:
        config: The main configuration dictionary
        
    Returns:
        True if server type is Ollama
    """
    server_config = get_server_config(config)
    return server_config['type'] == 'ollama'


def save_config_to_file(config: dict, file_path: str = 'config.yaml'):
    """
    Save configuration dictionary to YAML file.
    
    Args:
        config: Configuration dictionary to save
        file_path: Path to the YAML file
    """
    try:
        # Create a copy to avoid internal state leaking to file
        config_to_save = config.copy()
        
        # Remove volatile or large fields if they exist as a precaution
        fields_to_remove = ['sio', 'stt', 'tts', 'chat_service', 'audio_service', 'model_service', 'llm']
        for field in fields_to_remove:
            if field in config_to_save:
                del config_to_save[field]
                
        with open(file_path, 'w') as f:
            yaml.dump(config_to_save, f, default_flow_style=False, sort_keys=False)
        logger.info(f"Configuration saved to {file_path}")
    except Exception as e:
