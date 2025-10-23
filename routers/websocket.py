"""
WebSocket event handlers
Handles real-time communication between client and server
"""
import os
import logging
import base64
import tempfile
from flask import request
from flask_socketio import emit

logger = logging.getLogger(__name__)


def register_websocket_handlers(socketio, config, stt, tts, chat_service, audio_service, model_service):
    """Register WebSocket event handlers"""

    # Store references for handler access
    _state = {
        'llm': chat_service.llm,
        'config': config,
        'stt': stt,
        'tts': tts,
        'chat_service': chat_service,
        'audio_service': audio_service,
        'model_service': model_service
    }

    @socketio.on('connect')
    def handle_connect():
        """Handle client connection"""
        logger.info(f"Client connected: {request.sid}")
        emit('connected', {'status': 'Connected to AssistedVoice'})

    @socketio.on('disconnect')
    def handle_disconnect():
        """Handle client disconnection"""
        logger.info(f"Client disconnected: {request.sid}")

    @socketio.on('process_audio')
    def handle_audio(data):
        """Process audio from client (PTT mode)"""
        try:
            enable_tts = data.get('enable_tts', True)

            emit('status', {'message': 'Processing audio...', 'type': 'processing'})

            # Decode base64 audio
            audio_data = base64.b64decode(data['audio'].split(',')[1] if ',' in data['audio'] else data['audio'])

            # Save to temporary file
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp_file:
                tmp_file.write(audio_data)
                tmp_path = tmp_file.name

            # Transcribe
            emit('status', {'message': 'Transcribing...', 'type': 'transcribing'})

            segments, info = _state['stt'].model.transcribe(tmp_path, language=_state['config']['whisper']['language'])
            transcription = " ".join([segment.text for segment in segments]).strip()

            if not transcription:
                emit('error', {'message': 'No speech detected'})
                os.unlink(tmp_path)
                return

            # Emit transcription
            emit('transcription', {'text': transcription})

            # Generate response
            emit('status', {'message': 'Generating response...', 'type': 'generating'})

            response_text = ""
            for chunk in _state['chat_service'].generate_response(transcription, stream=True):
                response_text += chunk
                emit('response_chunk', {'text': chunk, 'model': _state['llm'].model})

            # Complete response with model info
            emit('response_complete', {'text': response_text, 'model': _state['llm'].model})

            # Generate TTS if enabled
            if enable_tts and _state['config']['tts']['engine'] != 'none':
                emit('status', {'message': 'Speaking...', 'type': 'speaking'})

                # Generate audio for browser playback
                if hasattr(_state['tts'], 'generate_audio_base64'):
                    logger.info("Generating audio as base64...")
                    audio_data = _state['tts'].generate_audio_base64(response_text)
                    if audio_data:
                        logger.info(f"Audio data generated, length: {len(audio_data)}")
                        emit('audio_data', {'audio': audio_data})
                    else:
                        logger.warning("Failed to generate audio data")
                        if hasattr(_state['tts'], 'speak_async'):
                            _state['tts'].speak_async(response_text)
                        else:
                            _state['tts'].speak(response_text)
                else:
                    if hasattr(_state['tts'], 'speak_async'):
                        _state['tts'].speak_async(response_text)
                    else:
                        _state['tts'].speak(response_text)

                emit('tts_complete', {})

            emit('status', {'message': 'Ready', 'type': 'ready'})

            # Clean up
            os.unlink(tmp_path)

        except Exception as e:
            logger.error(f"Error processing audio: {e}")
            emit('error', {'message': str(e)})

    @socketio.on('process_text')
    def handle_text(data):
        """Process text input from client"""
        try:
            text = data.get('text', '').strip()
            enable_tts = data.get('enable_tts', True)

            if not text:
                return

            # Generate response
            emit('status', {'message': 'Generating response...', 'type': 'generating'})

            response_text = ""
            for chunk in _state['chat_service'].generate_response(text, stream=True):
                response_text += chunk
                emit('response_chunk', {'text': chunk, 'model': _state['llm'].model})

            # Complete response with model info
            emit('response_complete', {'text': response_text, 'model': _state['llm'].model})

            # Generate TTS if enabled
            if enable_tts and _state['config']['tts']['engine'] != 'none':
                emit('status', {'message': 'Speaking...', 'type': 'speaking'})

                if hasattr(_state['tts'], 'generate_audio_base64'):
                    logger.info("Generating audio as base64...")
                    audio_data = _state['tts'].generate_audio_base64(response_text)
                    if audio_data:
                        logger.info(f"Audio data generated, length: {len(audio_data)}")
                        emit('audio_data', {'audio': audio_data})
                    else:
                        logger.warning("Failed to generate audio data")
                        if hasattr(_state['tts'], 'speak_async'):
                            _state['tts'].speak_async(response_text)
                        else:
                            _state['tts'].speak(response_text)
                else:
                    if hasattr(_state['tts'], 'speak_async'):
                        _state['tts'].speak_async(response_text)
                    else:
                        _state['tts'].speak(response_text)

                emit('tts_complete', {})

            emit('status', {'message': 'Ready', 'type': 'ready'})

        except Exception as e:
            logger.error(f"Error processing text: {e}")
            emit('error', {'message': str(e)})

    @socketio.on('clear_conversation')
    def handle_clear(data=None):
        """Clear conversation history"""
        _state['chat_service'].clear_conversation()
        emit('conversation_cleared', {})

    @socketio.on('change_model')
    def handle_change_model(data):
        """Change the LLM model"""
        try:
            new_model = data.get('model')
            if new_model:
                # Use model service to switch
                new_llm, actual_model = _state['model_service'].switch_model(new_model)

                # Update state
                _state['llm'] = new_llm
                _state['chat_service'].llm = new_llm

                emit('model_changed', {'model': actual_model})

        except Exception as e:
            logger.error(f"Error changing model: {e}")
            emit('error', {'message': str(e)})

    @socketio.on('change_tts')
    def handle_change_tts(data):
        """Change TTS engine or voice"""
        try:
            engine = data.get('engine')
            if engine:
                # Use audio service to switch TTS
                new_tts = _state['audio_service'].switch_tts_engine(engine, _state['config'])
                _state['tts'] = new_tts

                emit('tts_changed', {'engine': engine})
                logger.info(f"TTS engine changed to: {engine}")

        except Exception as e:
            logger.error(f"Error changing TTS engine: {e}")
            emit('error', {'message': str(e)})

    @socketio.on('change_whisper_model')
    def handle_change_whisper(data):
        """Change Whisper model"""
        try:
            model = data.get('model')
            if model:
                logger.info(f"Switching Whisper model to: {model}")

                # Update config
                _state['config']['whisper']['model'] = model

                # Reinitialize Whisper
                from modules.stt import WhisperSTT
                new_stt = WhisperSTT(_state['config'])
                _state['stt'] = new_stt

                emit('whisper_model_changed', {'model': model})
                logger.info(f"Whisper model changed to: {model}")

        except Exception as e:
            logger.error(f"Error changing Whisper model: {e}")
            emit('error', {'message': str(e)})

    @socketio.on('replay_text')
    def handle_replay(data):
        """Replay text with TTS"""
        try:
            text = data.get('text', '').strip()
            enable_tts = data.get('enable_tts', True)

            if not text or not enable_tts:
                return

            if _state['config']['tts']['engine'] != 'none':
                emit('status', {'message': 'Speaking...', 'type': 'speaking'})

                if hasattr(_state['tts'], 'generate_audio_base64'):
                    audio_data = _state['tts'].generate_audio_base64(text)
                    if audio_data:
                        emit('audio_data', {'audio': audio_data})
                    else:
                        if hasattr(_state['tts'], 'speak_async'):
                            _state['tts'].speak_async(text)
                        else:
                            _state['tts'].speak(text)
                else:
                    if hasattr(_state['tts'], 'speak_async'):
                        _state['tts'].speak_async(text)
                    else:
                        _state['tts'].speak(text)

                emit('tts_complete', {})
                emit('status', {'message': 'Ready', 'type': 'ready'})

        except Exception as e:
            logger.error(f"Error replaying text: {e}")
            emit('error', {'message': str(e)})

    @socketio.on('update_temperature')
    def handle_temperature(data):
        """Update temperature setting"""
        try:
            temperature = data.get('temperature')
            if temperature is not None:
                _state['chat_service'].update_temperature(temperature)
                # Also update config
                server_type = _state['config'].get('server', {}).get('type', 'ollama')
                config_section = 'lm_studio' if server_type == 'lm-studio' else 'ollama'
                if config_section not in _state['config']:
                    _state['config'][config_section] = {}
                _state['config'][config_section]['temperature'] = temperature

                emit('status', {'message': f'Temperature set to {temperature}', 'type': 'ready'})

        except Exception as e:
            logger.error(f"Error updating temperature: {e}")
            emit('error', {'message': str(e)})

    @socketio.on('update_max_tokens')
    def handle_max_tokens(data):
        """Update max tokens setting"""
        try:
            max_tokens = data.get('max_tokens')
            if max_tokens is not None:
                _state['chat_service'].update_max_tokens(max_tokens)
                # Also update config
                server_type = _state['config'].get('server', {}).get('type', 'ollama')
                config_section = 'lm_studio' if server_type == 'lm-studio' else 'ollama'
                if config_section not in _state['config']:
                    _state['config'][config_section] = {}
                _state['config'][config_section]['max_tokens'] = max_tokens

                emit('status', {'message': f'Max tokens set to {max_tokens}', 'type': 'ready'})

        except Exception as e:
            logger.error(f"Error updating max tokens: {e}")
            emit('error', {'message': str(e)})

    @socketio.on('update_system_prompt')
    def handle_system_prompt(data):
        """Update system prompt"""
        try:
            system_prompt = data.get('system_prompt')
            if system_prompt is not None:
                _state['chat_service'].update_system_prompt(system_prompt)
                # Also update config
                server_type = _state['config'].get('server', {}).get('type', 'ollama')
                config_section = 'lm_studio' if server_type == 'lm-studio' else 'ollama'
                if config_section not in _state['config']:
                    _state['config'][config_section] = {}
                _state['config'][config_section]['system_prompt'] = system_prompt

                emit('status', {'message': 'System prompt updated', 'type': 'ready'})

        except Exception as e:
            logger.error(f"Error updating system prompt: {e}")
            emit('error', {'message': str(e)})
