"""
FastAPI REST API route handlers
"""
import logging
import asyncio
from fastapi import HTTPException, status, Body
from models.schemas import (
    ConfigResponse,
    ModelListResponse,
    ModelSwitchRequest,
    BackendSwitchRequest,
    ConnectionTestResponse,
    TTSEngineRequest,
    SuccessResponse,
    TranscriptionResponse,
    ChatRequest,
    ChatResponse
)

logger = logging.getLogger(__name__)


def register_api_routes(app, app_state):
    """Register FastAPI routes with the app"""

    @app.get("/config", response_model=ConfigResponse, tags=["Configuration"])
    async def get_config():
        """Get current configuration"""
        config = app_state['config']
        return {
            'whisper': config.get('whisper', {}),
            'ollama': config.get('ollama', {}),
            'lm_studio': config.get('lm_studio', {}),
            'tts': config.get('tts', {}),
            'server': config.get('server', {}),
            'ui': config.get('ui', {}),
            'audio': config.get('audio', {}),
            'vad': config.get('vad', {}),
            'performance': config.get('performance', {}),
            'initialized': app_state.get('initialized', {})
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

    @app.post("/api/models/switch", response_model=SuccessResponse, tags=["Models"])
    async def switch_model(request: ModelSwitchRequest):
        """Switch model on current backend"""
        try:
            model_service = app_state['model_service']
            new_llm, actual_model = model_service.switch_model(request.model)
            
            # Update app state
            app_state['llm'] = new_llm
            app_state['chat_service'].llm = new_llm
            app_state['model_service'].llm = new_llm
            
            return {
                'success': True,
                'message': f"Switched to model: {actual_model}"
            }
        except Exception as e:
            logger.error(f"Error switching model: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e)
            )

    @app.post("/api/backend/switch", response_model=SuccessResponse, tags=["Models"])
    async def switch_backend(request: BackendSwitchRequest):
        """Switch LLM backend (e.g. ollama to openai)"""
        try:
            config = app_state['config']
            config['server']['type'] = request.type
            if request.model:
                 # Update model in relevant section
                 section = request.type if request.type in config else 'ollama'
                 if section not in config: config[section] = {}
                 config[section]['model'] = request.model
            
            from modules.llm_factory import switch_llm_server
            # Preserve history using switch_llm_server helper
            new_llm = switch_llm_server(app_state['llm'], config)
            
            # Update app state
            app_state['llm'] = new_llm
            app_state['chat_service'].llm = new_llm
            app_state['model_service'].llm = new_llm
            
            return {
                'success': True,
                'message': f"Switched backend to {request.type} ({new_llm.__class__.__name__})"
            }
        except Exception as e:
            logger.error(f"Error switching backend: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e)
            )

    @app.post("/api/chat", response_model=ChatResponse, tags=["Chat"])
    async def chat(request: ChatRequest):
        """Text-based chat endpoint"""
        try:
            llm = app_state['llm']
            
            # Use assistant to generate response
            response_text = ""
            if hasattr(llm, 'generate'):
                 # Note: Rest API non-streaming implementation
                 for chunk in llm.generate(request.text, stream=True, images=request.images):
                     response_text += chunk
            else:
                 raise HTTPException(status_code=500, detail="LLM not ready")

            return {
                'text': response_text,
                'model': llm.model if hasattr(llm, 'model') else "unknown"
            }
        except Exception as e:
            logger.error(f"Chat error: {e}")
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
            audio = audio_data.get('audio') or audio_data.get('audio_data')

            if not audio:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail='No audio data provided'
                )

            # Process audio with STT (run in thread pool for blocking operation)
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

    # ========== Conversation API Endpoints ==========

    @app.get("/api/conversations", tags=["Conversations"])
    async def list_conversations(limit: int = 50):
        """Get all conversations"""
        try:
            db = app_state.get('database_service')
            if not db:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database service not available"
                )
            conversations = db.get_all_conversations(limit=limit)
            return {"conversations": conversations}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error listing conversations: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e)
            )

    @app.get("/api/conversations/{conversation_id}", tags=["Conversations"])
    async def get_conversation(conversation_id: str):
        """Get a conversation with all messages"""
        try:
            db = app_state.get('database_service')
            if not db:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database service not available"
                )
            conversation = db.get_conversation(conversation_id)
            if not conversation:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Conversation not found"
                )
            return conversation
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error getting conversation: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e)
            )

    @app.post("/api/conversations", tags=["Conversations"])
    async def create_conversation(data: dict):
        """Create a new conversation"""
        try:
            db = app_state.get('database_service')
            if not db:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database service not available"
                )
            
            conversation_id = data.get('id')
            if not conversation_id:
                import time
                conversation_id = str(int(time.time() * 1000))
            
            title = data.get('title', 'New Chat')
            model = data.get('model')
            messages = data.get('messages', [])
            
            if messages:
                # Save full conversation with messages
                conversation = db.save_full_conversation(
                    conversation_id=conversation_id,
                    messages=messages,
                    model=model
                )
            else:
                # Create empty conversation
                conversation = db.create_conversation(
                    conversation_id=conversation_id,
                    title=title,
                    model=model
                )
            
            return conversation
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error creating conversation: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e)
            )

    @app.put("/api/conversations/{conversation_id}", tags=["Conversations"])
    async def update_conversation(conversation_id: str, data: dict):
        """Update a conversation"""
        try:
            db = app_state.get('database_service')
            if not db:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database service not available"
                )
            
            # If messages provided, save full conversation
            messages = data.get('messages')
            if messages:
                conversation = db.save_full_conversation(
                    conversation_id=conversation_id,
                    messages=messages,
                    model=data.get('model')
                )
                return conversation
            
            # Otherwise just update metadata
            success = db.update_conversation(
                conversation_id=conversation_id,
                title=data.get('title'),
                model=data.get('model')
            )
            
            if not success:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Conversation not found"
                )
            
            return db.get_conversation(conversation_id)
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error updating conversation: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e)
            )

    @app.delete("/api/conversations/{conversation_id}", tags=["Conversations"])
    async def delete_conversation(conversation_id: str):
        """Delete a conversation"""
        try:
            db = app_state.get('database_service')
            if not db:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database service not available"
                )
            
            success = db.delete_conversation(conversation_id)
            
            if not success:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Conversation not found"
                )
            
            return {"success": True, "message": "Conversation deleted"}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error deleting conversation: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e)
            )

    @app.post("/api/conversations/{conversation_id}/messages", tags=["Conversations"])
    async def add_message(conversation_id: str, data: dict):
        """Add a message to a conversation"""
        try:
            db = app_state.get('database_service')
            if not db:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Database service not available"
                )
            
            role = data.get('role')
            content = data.get('content')
            
            if not role or not content:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Message must have role and content"
                )
            
            message = db.add_message(
                conversation_id=conversation_id,
                role=role,
                content=content,
                metadata=data.get('metadata')
            )
            
            return message
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error adding message: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=str(e)
            )
