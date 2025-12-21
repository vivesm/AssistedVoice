import unittest
from unittest.mock import MagicMock, patch
import json
from modules.stt import WhisperSTT

class TestRemoteSTT(unittest.TestCase):
    def setUp(self):
        self.config = {
            'whisper': {
                'mode': 'remote',
                'remote_url': 'http://mock-remote:5001/transcribe',
                'model': 'small',
                'device': 'cpu'
            },
            'vad': {'enabled': False},
            'audio': {'sample_rate': 16000}
        }

    @patch('modules.stt.requests.post')
    def test_transcribe_remote_success(self, mock_post):
        # Setup mock response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'text': 'Hello world'}
        mock_post.return_value = mock_response

        # Initialize STT (should skip model loading)
        stt = WhisperSTT(self.config)
        
        # Test transcribe_remote
        text = stt.transcribe_remote("fake_base64_audio")
        
        self.assertEqual(text, 'Hello world')
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        self.assertEqual(args[0], 'http://mock-remote:5001/transcribe')
        self.assertEqual(kwargs['json']['audio'], 'fake_base64_audio')

    @patch('modules.stt.requests.post')
    def test_transcribe_remote_base64_passthrough(self, mock_post):
        # Setup mock response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'text': 'Passthrough works'}
        mock_post.return_value = mock_response

        stt = WhisperSTT(self.config)
        
        # Test transcribe_base64 (should call transcribe_remote directly)
        text = stt.transcribe_base64("more_fake_audio")
        
        self.assertEqual(text, 'Passthrough works')
        mock_post.assert_called_once()

    @patch('modules.stt.WhisperModel')
    def test_remote_mode_skips_model_load(self, mock_model):
        # Initialize STT in remote mode
        stt = WhisperSTT(self.config)
        
        # Ensure WhisperModel was NOT instantiated
        mock_model.assert_not_called()
        self.assertIsNone(stt.model)

if __name__ == '__main__':
    unittest.main()
