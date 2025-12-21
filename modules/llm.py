"""
Language Model interface using Ollama
"""
import time
import logging
import io
from typing import Optional, Generator, List, Dict, Any
from PIL import Image
from ollama import Client
from .llm_base import BaseLLM
from .config_helper import get_server_config

logger = logging.getLogger(__name__)


class OllamaLLM(BaseLLM):
    """Ollama Language Model interface"""
    
    def __init__(self, config: dict):
        super().__init__(config)
        self.server_config = get_server_config(config)
        self.client = None
        self.model = config['ollama']['model']
        self.fallback_model = config['ollama'].get('fallback_model')
        # Conversation manager is initialized in BaseLLM
        self.setup()
    
    def setup(self):
        """Initialize Ollama client with custom host configuration"""
        try:
            # Use custom host from configuration
            host = self.server_config.get('base_url', 'http://localhost:11434')
            logger.info(f"Connecting to Ollama at {host}")
            
            # Try configured host first
            try:
                self.client = Client(host=host)
                # Test connection
                models = self.client.list()
                logger.info(f"Successfully connected to {host}")
            except Exception as e:
                logger.warning(f"Failed to connect to {host}: {e}")
                
                # Fallback to localhost:11434 if custom host fails
                if host != "http://localhost:11434":
                    logger.info("Falling back to localhost:11434")
                    self.client = Client(host="http://localhost:11434")
                    models = self.client.list()
                    logger.info("Connected to fallback server at localhost:11434")
                else:
                    raise  # Re-raise if already using default
            
            # Handle different response formats
            available_models = self._parse_models(models)
            
            logger.info(f"Connected to Ollama. Available models: {available_models}")
            
            # Check if desired model is available (with flexible matching)
            model_found = False
            for available in available_models:
                # Check exact match or partial match (for version tags)
                if self.model == available or self.model.split(':')[0] == available.split(':')[0]:
                    self.model = available  # Use the exact available model name
                    model_found = True
                    break
            
            if not model_found:
                logger.warning(f"Model '{self.model}' not found. Available: {available_models}")
                if self.fallback_model:
                    # Try fallback with flexible matching too
                    for available in available_models:
                        if self.fallback_model == available or self.fallback_model.split(':')[0] == available.split(':')[0]:
                            logger.info(f"Using fallback model: {available}")
                            self.model = available
                            model_found = True
                            break
                
                if not model_found:
                    # Use first available model as last resort
                    if available_models:
                        self.model = available_models[0]
                        logger.warning(f"Using first available model: {self.model}")
                    else:
                        raise ValueError("No models available. Please pull a model first.")
        
        except Exception as e:
            logger.error(f"Failed to connect to Ollama: {e}")
            logger.info("Please make sure Ollama is running: 'ollama serve'")
            raise

    def _parse_models(self, models) -> List[str]:
        """Helper to parse models from different Ollama API response formats"""
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
        return available_models
    
    def list_models(self) -> List[str]:
        """List available models from Ollama"""
        try:
            models = self.client.list()
            return self._parse_models(models)
        except Exception as e:
            logger.error(f"Error listing models: {e}")
            return []

    def test_connection(self) -> tuple[bool, str]:
        """Test connection to Ollama server"""
        try:
            self.client.list()
            return True, "Connected to Ollama"
        except Exception as e:
            return False, f"Failed to connect to Ollama: {str(e)}"

    def _resize_image(self, image_bytes: bytes, max_size: int = 1024) -> bytes:
        """Resize image to a maximum dimension while maintaining aspect ratio"""
        try:
            img = Image.open(io.BytesIO(image_bytes))
            
            # Check if resize is needed
            if max(img.size) <= max_size:
                return image_bytes
                
            # Calculate new size
            ratio = max_size / max(img.size)
            new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
            
            # Resize
            img = img.resize(new_size, Image.Resampling.LANCZOS)
            
            # Save back to bytes
            output = io.BytesIO()
            # Preserve original format if possible, otherwise JPEG
            fmt = img.format if img.format else "JPEG"
            img.save(output, format=fmt, quality=85)
            return output.getvalue()
        except Exception as e:
            logger.warning(f"Failed to resize image: {e}")
            return image_bytes

    def generate(self, prompt: str, stream: bool = True, images: Optional[List[str]] = None) -> Generator[str, None, None]:
        """Generate response from LLM"""
        # Add user message to conversation using updated signature

        self.conversation.add_message("user", prompt, images=images)
        
        # Log if images are being sent
        if images:
            logger.info(f"Sending {len(images)} image(s) to model {self.model}")

        
        # Get conversation context (now includes images in dict)
        messages = self.conversation.get_context(
            system_prompt=self.config['ollama'].get('system_prompt')
        )

        # Process images: Ollama library expects bytes or stripped base64 strings
        # We'll convert them to bytes for robustness and resize them if too large
        for msg in messages:
            if 'images' in msg:
                processed_images = []
                for img_data in msg['images']:
                    if isinstance(img_data, str) and img_data.startswith('data:image/'):
                        # Strip prefix like "data:image/jpeg;base64,"
                        try:
                            # Split by comma and take the base64 part
                            base64_str = img_data.split(',')[1]
                            import base64
                            img_bytes = base64.b64decode(base64_str)
                            
                            # Optimized resize
                            img_bytes = self._resize_image(img_bytes)
                            
                            processed_images.append(img_bytes)
                        except Exception as e:
                            logger.error(f"Error decoding image: {e}")
                            processed_images.append(img_data) # Fallback
                    else:
                        processed_images.append(img_data)
                msg['images'] = processed_images
        
        # Generation parameters
        options = {
            'temperature': self.config['ollama'].get('temperature', 0.7),
            'num_predict': self.config['ollama'].get('max_tokens', 500),
        }
        
        try:
            start_time = time.time()
            first_token_time = None
            full_response = ""
            
            # Determine which model to use
            current_model = self.model
            
            # Switch to vision model if images are present
            if images and self.config['ollama'].get('vision_model'):
                vision_model = self.config['ollama']['vision_model']
                logger.info(f"Images detected, switching to vision model: {vision_model}")
                current_model = vision_model

            # Stream response
            response = self.client.chat(
                model=current_model,
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
            error_msg = str(e)
            logger.error(f"Generation error: {error_msg}")
            
            # Check if it's a vision-related error
            if images and ("vision" in error_msg.lower() or "image" in error_msg.lower() or "multimodal" in error_msg.lower()):
                yield f"Error: This model ({self.model}) does not support image inputs. Please select a vision-capable model like llava, bakllava, moondream, or llama3.2-vision."
            else:
                yield f"Error: {error_msg}"
    
    # clear_conversation and get_conversation_summary are inherited from BaseLLM


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
    
    def generate(self, prompt: str, stream: bool = True, images: Optional[List[str]] = None) -> Generator[str, None, None]:
        """Generate with caching support"""
        # Check cache first (only for text-only requests)

        if self.cache and not stream and not images:
            cached = self.cache.get(prompt)
            if cached:
                yield cached
                return
        
        # Generate response
        full_response = ""
        for chunk in super().generate(prompt, stream, images):

            full_response += chunk
            yield chunk
        
        # Cache the response - only for text-only requests
        if self.cache and not stream and not images:
            self.cache.set(prompt, full_response)