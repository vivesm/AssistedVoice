"""
Cloud LLM Providers (OpenAI, Gemini) implemented as BaseLLM classes.
"""
import logging
import os
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

        # Prepare messages using ConversationManager
        messages = self.conversation.get_context(self.config.get('system_prompt'))
        
        # Construct User Message
        user_content = [{"type": "text", "text": prompt}]
        
        if images:
            import base64
            for img_path in images:
                try:
                    with open(img_path, "rb") as image_file:
                        encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
                        # Determine mime type (simple guess or default to jpeg)
                        ext = os.path.splitext(img_path)[1].lower()
                        mime = "image/png" if ext == ".png" else "image/jpeg"
                        
                        user_content.append({
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime};base64,{encoded_string}"
                            }
                        })
                except Exception as e:
                    logger.error(f"Failed to load image {img_path}: {e}")

        messages.append({"role": "user", "content": user_content})

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=stream
            )

            if stream:
                full_response = ""
                for chunk in response:
                    if chunk.choices[0].delta.content:
                        content = chunk.choices[0].delta.content
                        full_response += content
                        yield content
                
                # Add assistant response to history
                self.conversation.add_message("assistant", full_response)
            else:
                content = response.choices[0].message.content
                self.conversation.add_message("assistant", content)
                yield content

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

        # Convert ConversationManager history to Gemini format
        chat_history = []
        for msg in self.conversation.messages:
            role = 'user' if msg.role == 'user' else 'model'
            # Note: Gemini history usually text only in standard chat. 
            # Multimodal history handling is complex. For now, we put text.
            # If msg has images, we might leave them out of history or implementation dependent.
            # Simplified: Text only history.
            chat_history.append({'role': role, 'parts': [msg.content]})

        try:
            chat = self.client.start_chat(history=chat_history)
            
            system_prompt = self.config.get('system_prompt')
            final_prompt_parts = []
            
            if system_prompt and not chat_history: 
                final_prompt_parts.append(f"{system_prompt}\n\n")

            final_prompt_parts.append(f"User: {prompt}")

            # Load images
            if images:
                import PIL.Image
                for img_path in images:
                    try:
                        img = PIL.Image.open(img_path)
                        final_prompt_parts.append(img)
                    except Exception as e:
                        logger.error(f"Failed to load image for Gemini {img_path}: {e}")

            # Send Message (Text + Images)
            response = chat.send_message(final_prompt_parts, stream=stream)

            if stream:
                full_response = ""
                for chunk in response:
                    content = chunk.text
                    full_response += content
                    yield content
                
                self.conversation.add_message("assistant", full_response)
            else:
                content = response.text
                self.conversation.add_message("assistant", content)
                yield content

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
