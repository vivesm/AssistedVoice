"""
REST API route handlers
"""
import logging
from flask import jsonify, request
import requests

logger = logging.getLogger(__name__)


def register_api_routes(app, config, llm, stt, model_service):
    """Register API routes with the Flask app"""

    @app.route('/config')
    def get_config():
        """Get current configuration"""
        return jsonify({
            'whisper': {
                'model': config['whisper']['model']
            },
            'ollama': {
                'model': config.get('ollama', {}).get('model', 'unknown'),
                'temperature': config.get('ollama', {}).get('temperature', 0.7),
                'max_tokens': config.get('ollama', {}).get('max_tokens', 500)
            },
            'lm_studio': {
                'model': config.get('lm_studio', {}).get('model', 'unknown'),
                'temperature': config.get('lm_studio', {}).get('temperature', 0.7),
                'max_tokens': config.get('lm_studio', {}).get('max_tokens', 500)
            },
            'tts': {
                'engine': config['tts']['engine']
            },
            'server': {
                'type': config.get('server', {}).get('type', 'ollama')
            }
        })

    @app.route('/api/models')
    def get_models():
        """Get available models from current LLM backend"""
        try:
            model_list, current_model = model_service.list_available_models()
            return jsonify({
                'models': model_list,
                'current': current_model
            })
        except Exception as e:
            logger.error(f"Error getting models: {e}")
            return jsonify({'error': str(e)}), 500

    @app.route('/api/test-connection', methods=['POST'])
    def test_connection():
        """Test connection to LLM server"""
        try:
            success, message = llm.test_connection()
            return jsonify({
                'success': success,
                'message': message
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'message': f"Connection test failed: {str(e)}"
            }), 500

    @app.route('/api/tts/engine', methods=['POST'])
    def set_tts_engine():
        """Set TTS engine"""
        data = request.json
        engine = data.get('engine', 'edge-tts')

        config['tts']['engine'] = engine

        return jsonify({
            'success': True,
            'engine': engine
        })

    @app.route('/transcribe', methods=['POST'])
    def transcribe_audio():
        """Transcribe audio file"""
        try:
            data = request.json
            audio_data = data.get('audio')

            if not audio_data:
                return jsonify({'error': 'No audio data provided'}), 400

            # Process audio with STT
            text = stt.transcribe_base64(audio_data)

            return jsonify({
                'text': text
            })
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            return jsonify({'error': str(e)}), 500
