"""
FastAPI REST API route handlers
"""
import logging
from fastapi import APIRouter, HTTPException, status
from models.schemas import (
    ConfigResponse,
    ModelListResponse,
    ConnectionTestResponse,
    TTSEngineRequest,
    SuccessResponse,
    ErrorResponse,
    TranscriptionResponse
)

logger = logging.getLogger(__name__)


def register_api_routes(app, app_state):
    """Register FastAPI routes with the app"""

    @app.get("/config", response_model=ConfigResponse, tags=["Configuration"])
    async def get_config():
        """Get current configuration"""
        config = app_state['config']
        return {
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
        }

    @app.get("/api/models", response_model=ModelListResponse, tags=["Models"])
    async def get_models():
        """Get available models from current LLM backend"""
        try:
            model_service = app_state['model_service']
            model_list, current_model = model_service.list_available_models()
            return {
                'models': model_list,
                'current': current_model
            }
        except Exception as e:
            logger.error(f"Error getting models: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e)
            )

    @app.post("/api/test-connection", response_model=ConnectionTestResponse, tags=["Connection"])
    async def test_connection():
        """Test connection to LLM server"""
        try:
            llm = app_state['llm']
            success, message = llm.test_connection()
            return {
                'success': success,
                'message': message
            }
        except Exception as e:
            logger.error(f"Connection test failed: {e}")
            return {
                'success': False,
                'message': f"Connection test failed: {str(e)}"
            }

    @app.post("/api/tts/engine", response_model=SuccessResponse, tags=["TTS"])
    async def set_tts_engine(request: TTSEngineRequest):
        """Set TTS engine"""
        try:
            config = app_state['config']
            engine = request.engine
            config['tts']['engine'] = engine

            return {
                'success': True,
                'message': f"TTS engine set to {engine}"
            }
        except Exception as e:
            logger.error(f"Error setting TTS engine: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e)
            )

    @app.post("/transcribe", response_model=TranscriptionResponse, tags=["Audio"])
    async def transcribe_audio(audio_data: dict):
        """Transcribe audio file"""
        try:
            audio = audio_data.get('audio')

            if not audio:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail='No audio data provided'
                )

            # Process audio with STT (run in thread pool for blocking operation)
            import asyncio
            stt = app_state['stt']
            text = await asyncio.to_thread(stt.transcribe_base64, audio)

            return {'text': text}

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e)
            )
