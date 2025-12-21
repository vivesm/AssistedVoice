import unittest
from unittest.mock import MagicMock, patch
from modules.llm import OllamaLLM

class TestMultimodalLLM(unittest.TestCase):
    def setUp(self):
        self.config = {
            'ollama': {
                'model': 'llama3.2',
                'vision_model': 'qwen3-vl',
                'fallback_model': 'mistral',
                'base_url': 'http://mock-server:11434'
            },
            'performance': {'cache_responses': False}
        }

    @patch('modules.llm.Client')
    def test_vision_model_switching(self, mock_client_cls):
        # Setup mock client
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client
        mock_client.list.return_value = {'models': [{'name': 'llama3.2'}, {'name': 'qwen3-vl'}]}
        
        # Setup chat mock to yield a simple response
        # When called, it returns an iterator (generator)
        def chat_side_effect(*args, **kwargs):
            yield {'message': {'content': 'Response'}}
        mock_client.chat.side_effect = chat_side_effect
        
        # Initialize LLM
        llm = OllamaLLM(self.config)
        
        # 1. Test standard generation (no images)
        generator = llm.generate("Hello")
        list(generator) # Consume generator
        
        # Verify it used the default model
        mock_client.chat.assert_called_with(
            model='llama3.2',
            messages=[{'role': 'user', 'content': 'Hello'}],
            stream=True,
            options={'temperature': 0.7, 'num_predict': 500}
        )
        
        # 2. Test vision generation (with images)
        generator = llm.generate("Describe this", images=["base64data..."])
        list(generator) # Consume generator
        
        # Verify it switched to vision model
        # Note: messages[1] is the assistant response from the first call ('Response')
        mock_client.chat.assert_called_with(
            model='qwen3-vl',
            messages=[
                {'role': 'user', 'content': 'Hello'}, 
                {'role': 'assistant', 'content': 'Response'}, 
                {'role': 'user', 'content': 'Describe this', 'images': ['base64data...']}
            ],
            stream=True,
            options={'temperature': 0.7, 'num_predict': 500}
        )

if __name__ == '__main__':
    unittest.main()
