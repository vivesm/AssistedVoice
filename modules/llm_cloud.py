"""
Cloud LLM Providers (OpenAI, Gemini) implemented as BaseLLM classes.
"""
import logging
import os
import time
from typing import Generator, List, Tuple, Optional

# Third-party imports
try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

try:
    import google.generativeai as genai
except ImportError:
    genai = None

from .llm_base import BaseLLM

logger = logging.getLogger(__name__)


class OpenAILLM(BaseLLM):
    """OpenAI API implementation"""

    def setup(self):
        """Initialize OpenAI client"""
        if not OpenAI:
            logger.error("openai package not installed")
            return

        api_key = self.config.get('openai', {}).get('api_key') or os.environ.get('OPENAI_API_KEY')
        if not api_key:
            logger.error("OpenAI API key not found")
            return

        self.client = OpenAI(api_key=api_key)
        self.model = self.config.get('openai', {}).get('model', 'gpt-4o')
        logger.info(f"OpenAI Client initialized for model: {self.model}")

    def generate(self, prompt: str, stream: bool = True, images: Optional[List[str]] = None) -> Generator[str, None, None]:
        """Generate response from OpenAI"""
        if not self.client:
            yield "Error: OpenAI client not initialized."
            return

        # Add user message to history
        self.conversation.add_message("user", prompt, images=images)

        # Prepare messages using ConversationManager
        # Note: get_context returns basic dictionaries {role, content}
        raw_messages = self.conversation.get_context(self.config.get('system_prompt'))
        
        # Convert to OpenAI multimodal format for the current turn if needed, 
        # or just ensure it's compatible.
        messages = []
        for msg in raw_messages:
            # If the message has images, we need the multimodal list format
            if msg.get('images'):
                import base64
                content = [{"type": "text", "text": msg['content']}]
                for img_data in msg['images']:
                    # Simple check if it's already base64 or a path
                    if img_data.startswith('data:') or len(img_data) > 200:
                         url = img_data if img_data.startswith('data:') else f"data:image/jpeg;base64,{img_data}"
                    else:
                        try:
                            with open(img_data, "rb") as f:
                                b64 = base64.b64encode(f.read()).decode('utf-8')
                                url = f"data:image/jpeg;base64,{b64}"
                        except:
                            continue
                    content.append({"type": "image_url", "image_url": {"url": url}})
                messages.append({"role": msg['role'], "content": content})
            else:
                messages.append(msg)

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=stream
            )

            full_response = ""
            if stream:
                for chunk in response:
                    if chunk.choices and chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        full_response += content
                        yield content
            else:
                full_response = response.choices[0].message.content
                yield full_response
            
            # Add assistant response to history
            self.conversation.add_message("assistant", full_response)

        except Exception as e:
            logger.error(f"OpenAI Generation Error: {e}")
            yield f"Error: {str(e)}"

    def list_models(self) -> List[str]:
        return ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"]

    def test_connection(self) -> Tuple[bool, str]:
        try:
            if not self.client:
                self.setup()
            if not self.client:
                return False, "Failed to initialize client"
            
            self.client.models.list()
            return True, "OpenAI connection successful"
        except Exception as e:
            return False, str(e)


class GeminiLLM(BaseLLM):
    """Google Gemini API implementation"""

    def setup(self):
        """Initialize Gemini client"""
        if not genai:
            logger.error("google-generativeai package not installed")
            return

        api_key = self.config.get('gemini', {}).get('api_key') or os.environ.get('GEMINI_API_KEY')
        if not api_key:
            logger.error("Gemini API key not found")
            return

        genai.configure(api_key=api_key)
        self.model_name = self.config.get('gemini', {}).get('model', 'gemini-1.5-flash')
        self.client = genai.GenerativeModel(self.model_name)
        logger.info(f"Gemini Client initialized for model: {self.model_name}")

    def generate(self, prompt: str, stream: bool = True, images: Optional[List[str]] = None) -> Generator[str, None, None]:
        """Generate response from Gemini"""
        if not self.client:
            yield "Error: Gemini client not initialized."
            return

        # Add user message to history
        self.conversation.add_message("user", prompt, images=images)

        # Convert ConversationManager history to Gemini format
        chat_history = []
        # We process all messages except the last one (which is the current prompt)
        messages_to_process = self.conversation.messages[:-1]
        for msg in messages_to_process:
            role = 'user' if msg.role == 'user' else 'model'
            chat_history.append({'role': role, 'parts': [msg.content]})

        try:
            chat = self.client.start_chat(history=chat_history)
            
            system_prompt = self.config.get('system_prompt')
            final_prompt_parts = []
            
            if system_prompt and not chat_history: 
                final_prompt_parts.append(f"{system_prompt}\n\n")

            final_prompt_parts.append(f"User: {prompt}")

            # Load images for the current prompt
            if images:
                import PIL.Image
                import base64
                import io
                for img_data in images:
                    try:
                        if len(img_data) > 200 or img_data.startswith('data:'):
                            # Base64 data
                            if ',' in img_data: img_data = img_data.split(',')[1]
                            img_bytes = base64.b64decode(img_data)
                            img = PIL.Image.open(io.BytesIO(img_bytes))
                        else:
                            # Path
                            img = PIL.Image.open(img_data)
                        final_prompt_parts.append(img)
                    except Exception as e:
                        logger.error(f"Failed to load image for Gemini: {e}")

            # Send Message (Text + Images)
            response = chat.send_message(final_prompt_parts, stream=stream)

            full_response = ""
            if stream:
                for chunk in response:
                    content = chunk.text
                    full_response += content
                    yield content
            else:
                full_response = response.text
                yield full_response
                
            self.conversation.add_message("assistant", full_response)

        except Exception as e:
            logger.error(f"Gemini Generation Error: {e}")
            yield f"Error: {str(e)}"

    def list_models(self) -> List[str]:
        return ["gemini-1.5-flash", "gemini-1.5-pro"]

    def test_connection(self) -> Tuple[bool, str]:
        try:
            if not self.client:
                self.setup()
            if not self.client:
                return False, "Failed to initialize client"
            
            # Simple generation test
            self.client.generate_content("Hello")
            return True, "Gemini connection successful"
        except Exception as e:
            return False, str(e)
