"""
LM Studio LLM implementation using OpenAI-compatible API
"""
import time
import logging
from typing import Generator, List, Dict, Any
from openai import OpenAI
import requests
from .llm_base import BaseLLM, ConversationManagerBase
from .config_helper import get_server_config

logger = logging.getLogger(__name__)


class LMStudioLLM(BaseLLM):
    """LM Studio Language Model implementation using OpenAI client"""
    
    def __init__(self, config: dict):
        """Initialize LM Studio LLM with configuration"""
        super().__init__(config)
        self.server_config = get_server_config(config)
        
        # LM Studio specific configuration
        # Note: base_url from config_helper already includes /v1 path for LM Studio
        self.api_base = self.server_config.get('base_url', 'http://localhost:1234/v1')
        self.api_key = self.server_config.get('api_key', 'not-needed')
        
        # Model configuration
        self.model = config.get('lm_studio', {}).get('model', config.get('ollama', {}).get('model', 'local-model'))
        self.fallback_model = config.get('lm_studio', {}).get('fallback_model', 
                                        config.get('ollama', {}).get('fallback_model'))
        
        # Generation parameters
        self.temperature = config.get('lm_studio', {}).get('temperature', 
                                     config.get('ollama', {}).get('temperature', 0.7))
        self.max_tokens = config.get('lm_studio', {}).get('max_tokens', 
                                    config.get('ollama', {}).get('max_tokens', 500))
        self.system_prompt = config.get('system_prompt') or config.get('lm_studio', {}).get('system_prompt',
                                       config.get('ollama', {}).get('system_prompt'))
        
        # Initialize conversation manager
        context_window = config.get('lm_studio', {}).get('context_window',
                                   config.get('ollama', {}).get('context_window', 4096))
        self.conversation = ConversationManagerBase(max_tokens=context_window)
        
        self.setup()
    
    def setup(self):
        """Initialize OpenAI client for LM Studio"""
        try:
            logger.info(f"Connecting to LM Studio at {self.api_base}")
            
            # Initialize OpenAI client with LM Studio endpoint
            self.client = OpenAI(
                api_key=self.api_key,  # LM Studio doesn't require a real API key
                base_url=self.api_base
            )
            
            # Test connection and get available models
            available_models = self.list_models()
            
            if available_models:
                logger.info(f"Connected to LM Studio. Available models: {available_models}")
                
                # Check if desired model is available
                model_found = False
                for available in available_models:
                    # Check exact match or partial match
                    if self.model == available or self.model in available or available in self.model:
                        self.model = available  # Use the exact available model name
                        model_found = True
                        logger.info(f"Using model: {self.model}")
                        break
                
                if not model_found:
                    logger.warning(f"Model '{self.model}' not found. Available: {available_models}")
                    
                    # Try fallback model
                    if self.fallback_model:
                        for available in available_models:
                            if self.fallback_model == available or self.fallback_model in available:
                                logger.info(f"Using fallback model: {available}")
                                self.model = available
                                model_found = True
                                break
                    
                    # Use first available model as last resort
                    if not model_found and available_models:
                        self.model = available_models[0]
                        logger.warning(f"Using first available model: {self.model}")
            else:
                logger.warning("No models found in LM Studio. Using default model name.")
                # LM Studio might still work even if we can't list models
        
        except Exception as e:
            logger.error(f"Failed to connect to LM Studio: {e}")
            logger.info("Please make sure LM Studio is running and a model is loaded")
            raise
    
    def list_models(self) -> List[str]:
        """List available LLM models from LM Studio (excludes embedding models)"""
        try:
            # Try to get models list from LM Studio
            models_response = self.client.models.list()
            available_models = []
            filtered_count = 0

            # Parse the response (OpenAI client returns a special object)
            if models_response and hasattr(models_response, 'data'):
                # Check that data is not None before iterating
                if models_response.data:
                    for model in models_response.data:
                        if hasattr(model, 'id'):
                            model_id = model.id

                            # Filter out embedding models based on common patterns
                            is_embedding = any([
                                'embedding' in model_id.lower(),
                                'embed' in model_id.lower(),
                                model_id.lower().startswith('text-embedding-'),
                                'nomic-embed' in model_id.lower(),
                                'bge-' in model_id.lower(),
                                'e5-' in model_id.lower(),
                                'gte-' in model_id.lower(),
                                'instructor-' in model_id.lower()
                            ])

                            if is_embedding:
                                filtered_count += 1
                                logger.debug(f"Filtered out embedding model: {model_id}")
                            else:
                                available_models.append(model_id)

            if filtered_count > 0:
                logger.info(f"Filtered {filtered_count} embedding model(s), {len(available_models)} LLM(s) available")

            return available_models

        except Exception as e:
            logger.warning(f"Could not list models from LM Studio: {e}")
            # Return empty list but don't fail - LM Studio might still work
            return []
    
    def test_connection(self) -> tuple[bool, str]:
        """Test connection to LM Studio server"""
        try:
            # Try to list models as a connection test
            response = requests.get(
                f"{self.api_base}/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=5
            )
            
            if response.status_code == 200:
                models = response.json().get('data', [])
                model_names = [m.get('id', 'unknown') for m in models]
                return True, f"Connected to LM Studio. Models: {', '.join(model_names) if model_names else 'No models loaded'}"
            else:
                return False, f"LM Studio returned status {response.status_code}"
        
        except requests.exceptions.ConnectionError:
            return False, f"Cannot connect to LM Studio at {self.api_base}. Is LM Studio running?"
        except requests.exceptions.Timeout:
            return False, "Connection to LM Studio timed out"
        except Exception as e:
            return False, f"Error testing LM Studio connection: {str(e)}"
    
    def generate(self, prompt: str, stream: bool = True) -> Generator[str, None, None]:
        """Generate response from LM Studio"""
        # Add user message to conversation
        self.conversation.add_message("user", prompt)
        
        # Get conversation context
        messages = self.conversation.get_context(system_prompt=self.system_prompt)
        
        try:
            start_time = time.time()
            first_token_time = None
            full_response = ""
            
            # Create chat completion with OpenAI client
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                stream=stream
            )
            
            if stream:
                # Stream response chunks
                for chunk in response:
                    if first_token_time is None:
                        first_token_time = time.time()
                        latency = (first_token_time - start_time) * 1000
                        logger.info(f"First token latency: {latency:.0f}ms")
                    
                    # Extract content from chunk
                    if chunk.choices and chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        full_response += content
                        yield content
            else:
                # Non-streaming response
                if response.choices and response.choices[0].message.content:
                    full_response = response.choices[0].message.content
                    yield full_response
            
            # Add assistant response to conversation
            self.conversation.add_message("assistant", full_response)
            
            # Log performance metrics
            total_time = time.time() - start_time
            tokens = len(full_response.split())
            tokens_per_sec = tokens / total_time if total_time > 0 else 0
            logger.info(f"Generated {tokens} tokens in {total_time:.2f}s ({tokens_per_sec:.1f} t/s)")
        
        except Exception as e:
            error_msg = f"LM Studio generation error: {str(e)}"
            logger.error(error_msg)
            
            # Check if it's a connection error
            if "Connection" in str(e) or "refused" in str(e):
                yield "Error: Cannot connect to LM Studio. Please ensure LM Studio is running with a model loaded."
            else:
                yield f"Error: {str(e)}"
    
    def get_model_info(self) -> Dict[str, Any]:
        """Get information about the current model and server"""
        info = super().get_model_info()
        info.update({
            "server_type": "lm-studio",
            "api_base": self.api_base,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens
        })
        return info