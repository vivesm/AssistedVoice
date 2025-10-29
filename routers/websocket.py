"""
Async WebSocket event handlers
Handles real-time communication between client and server
"""
import os
import logging
import base64
import tempfile
import asyncio

logger = logging.getLogger(__name__)


def register_websocket_handlers(sio, config, stt, tts, chat_service, audio_service, model_service):
    """Register async WebSocket event handlers"""

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

    @sio.event
    async def connect(sid, environ):
        """Handle client connection"""
        logger.info(f"Client connected: {sid}")
        await sio.emit('connected', {'status': 'Connected to AssistedVoice'}, room=sid)

    @sio.event
    async def disconnect(sid):
        """Handle client disconnection"""
        logger.info(f"Client disconnected: {sid}")

    @sio.event
    async def process_audio(sid, data):
        """Process audio from client (PTT mode)"""
        try:
            enable_tts = data.get('enable_tts', True)

            await sio.emit('status', {'message': 'Processing audio...', 'type': 'processing'}, room=sid)

            # Decode base64 audio
            audio_data = base64.b64decode(data['audio'].split(',')[1] if ',' in data['audio'] else data['audio'])

            # Save to temporary file
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp_file:
                tmp_file.write(audio_data)
                tmp_path = tmp_file.name

            # Transcribe (run in thread pool for blocking operation)
            await sio.emit('status', {'message': 'Transcribing...', 'type': 'transcribing'}, room=sid)

            segments, info = await asyncio.to_thread(
                _state['stt'].model.transcribe,
                tmp_path,
                language=_state['config']['whisper']['language']
            )
            transcription = " ".join([segment.text for segment in segments]).strip()

            if not transcription:
                await sio.emit('error', {'message': 'No speech detected'}, room=sid)
                os.unlink(tmp_path)
                return

            # Emit transcription
            await sio.emit('transcription', {'text': transcription}, room=sid)

            # Generate response
            await sio.emit('status', {'message': 'Generating response...', 'type': 'generating'}, room=sid)

            response_text = ""
            for chunk in _state['chat_service'].generate_response(transcription, stream=True):
                response_text += chunk
                await sio.emit('response_chunk', {'text': chunk, 'model': _state['llm'].model}, room=sid)

            # Complete response with model info
            await sio.emit('response_complete', {'text': response_text, 'model': _state['llm'].model}, room=sid)

            # Generate TTS if enabled
            if enable_tts and _state['config']['tts']['engine'] != 'none':
                await sio.emit('status', {'message': 'Speaking...', 'type': 'speaking'}, room=sid)

                # Generate audio for browser playback
                if hasattr(_state['tts'], 'generate_audio_base64'):
                    logger.info("Generating audio as base64...")
                    audio_data = await asyncio.to_thread(_state['tts'].generate_audio_base64, response_text)
                    if audio_data:
                        logger.info(f"Audio data generated, length: {len(audio_data)}")
                        await sio.emit('audio_data', {'audio': audio_data}, room=sid)
                    else:
                        logger.warning("Failed to generate audio data")
                        if hasattr(_state['tts'], 'speak_async'):
                            await asyncio.to_thread(_state['tts'].speak_async, response_text)
                        else:
                            await asyncio.to_thread(_state['tts'].speak, response_text)
                else:
                    if hasattr(_state['tts'], 'speak_async'):
                        await asyncio.to_thread(_state['tts'].speak_async, response_text)
                    else:
                        await asyncio.to_thread(_state['tts'].speak, response_text)

                await sio.emit('tts_complete', {}, room=sid)

            await sio.emit('status', {'message': 'Ready', 'type': 'ready'}, room=sid)

            # Clean up
            os.unlink(tmp_path)

        except Exception as e:
            logger.error(f"Error processing audio: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def process_text(sid, data):
        """Process text input from client"""
        try:
            text = data.get('text', '').strip()
            enable_tts = data.get('enable_tts', True)

            if not text:
                return

            # Generate response
            await sio.emit('status', {'message': 'Generating response...', 'type': 'generating'}, room=sid)

            response_text = ""
            for chunk in _state['chat_service'].generate_response(text, stream=True):
                response_text += chunk
                await sio.emit('response_chunk', {'text': chunk, 'model': _state['llm'].model}, room=sid)

            # Complete response with model info
            await sio.emit('response_complete', {'text': response_text, 'model': _state['llm'].model}, room=sid)

            # Generate TTS if enabled
            if enable_tts and _state['config']['tts']['engine'] != 'none':
                await sio.emit('status', {'message': 'Speaking...', 'type': 'speaking'}, room=sid)

                if hasattr(_state['tts'], 'generate_audio_base64'):
                    logger.info("Generating audio as base64...")
                    audio_data = await asyncio.to_thread(_state['tts'].generate_audio_base64, response_text)
                    if audio_data:
                        logger.info(f"Audio data generated, length: {len(audio_data)}")
                        await sio.emit('audio_data', {'audio': audio_data}, room=sid)
                    else:
                        logger.warning("Failed to generate audio data")
                        if hasattr(_state['tts'], 'speak_async'):
                            await asyncio.to_thread(_state['tts'].speak_async, response_text)
                        else:
                            await asyncio.to_thread(_state['tts'].speak, response_text)
                else:
                    if hasattr(_state['tts'], 'speak_async'):
                        await asyncio.to_thread(_state['tts'].speak_async, response_text)
                    else:
                        await asyncio.to_thread(_state['tts'].speak, response_text)

                await sio.emit('tts_complete', {}, room=sid)

            await sio.emit('status', {'message': 'Ready', 'type': 'ready'}, room=sid)

        except Exception as e:
            logger.error(f"Error processing text: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def clear_conversation(sid, data=None):
        """Clear conversation history"""
        _state['chat_service'].clear_conversation()
        await sio.emit('conversation_cleared', {}, room=sid)

    @sio.event
    async def change_model(sid, data):
        """Change the LLM model"""
        try:
            new_model = data.get('model')
            if new_model:
                # Use model service to switch
                new_llm, actual_model = _state['model_service'].switch_model(new_model)

                # Update state
                _state['llm'] = new_llm
                _state['chat_service'].llm = new_llm

                await sio.emit('model_changed', {'model': actual_model}, room=sid)

        except Exception as e:
            logger.error(f"Error changing model: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def change_tts(sid, data):
        """Change TTS engine or voice"""
        try:
            engine = data.get('engine')
            if engine:
                # Use audio service to switch TTS (run in thread pool)
                new_tts = await asyncio.to_thread(
                    _state['audio_service'].switch_tts_engine,
                    engine,
                    _state['config']
                )
                _state['tts'] = new_tts

                await sio.emit('tts_changed', {'engine': engine}, room=sid)
                logger.info(f"TTS engine changed to: {engine}")

        except Exception as e:
            logger.error(f"Error changing TTS engine: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def change_whisper_model(sid, data):
        """Change Whisper model"""
        try:
            model = data.get('model')
            if model:
                logger.info(f"Switching Whisper model to: {model}")

                # Update config
                _state['config']['whisper']['model'] = model

                # Reinitialize Whisper (run in thread pool)
                from modules.stt import WhisperSTT
                new_stt = await asyncio.to_thread(WhisperSTT, _state['config'])
                _state['stt'] = new_stt

                await sio.emit('whisper_model_changed', {'model': model}, room=sid)
                logger.info(f"Whisper model changed to: {model}")

        except Exception as e:
            logger.error(f"Error changing Whisper model: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def replay_text(sid, data):
        """Replay text with TTS"""
        try:
            text = data.get('text', '').strip()
            enable_tts = data.get('enable_tts', True)

            if not text or not enable_tts:
                return

            if _state['config']['tts']['engine'] != 'none':
                await sio.emit('status', {'message': 'Speaking...', 'type': 'speaking'}, room=sid)

                if hasattr(_state['tts'], 'generate_audio_base64'):
                    audio_data = await asyncio.to_thread(_state['tts'].generate_audio_base64, text)
                    if audio_data:
                        await sio.emit('audio_data', {'audio': audio_data}, room=sid)
                    else:
                        if hasattr(_state['tts'], 'speak_async'):
                            await asyncio.to_thread(_state['tts'].speak_async, text)
                        else:
                            await asyncio.to_thread(_state['tts'].speak, text)
                else:
                    if hasattr(_state['tts'], 'speak_async'):
                        await asyncio.to_thread(_state['tts'].speak_async, text)
                    else:
                        await asyncio.to_thread(_state['tts'].speak, text)

                await sio.emit('tts_complete', {}, room=sid)
                await sio.emit('status', {'message': 'Ready', 'type': 'ready'}, room=sid)

        except Exception as e:
            logger.error(f"Error replaying text: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def update_temperature(sid, data):
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

                await sio.emit('status', {'message': f'Temperature set to {temperature}', 'type': 'ready'}, room=sid)

        except Exception as e:
            logger.error(f"Error updating temperature: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def update_max_tokens(sid, data):
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

                await sio.emit('status', {'message': f'Max tokens set to {max_tokens}', 'type': 'ready'}, room=sid)

        except Exception as e:
            logger.error(f"Error updating max tokens: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def update_system_prompt(sid, data):
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

                await sio.emit('status', {'message': 'System prompt updated', 'type': 'ready'}, room=sid)

        except Exception as e:
            logger.error(f"Error updating system prompt: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def update_voice_pitch(sid, data):
        """Update TTS voice pitch (Edge TTS only)"""
        try:
            pitch = data.get('pitch', '+0Hz')
            if hasattr(_state['tts'], 'set_pitch'):
                _state['tts'].set_pitch(pitch)
                # Update config
                _state['config']['tts']['pitch'] = pitch
                logger.info(f"Voice pitch updated to {pitch}")
                await sio.emit('status', {'message': f'Voice pitch updated to {pitch}', 'type': 'ready'}, room=sid)
            else:
                logger.warning("Current TTS engine does not support pitch adjustment")
        except Exception as e:
            logger.error(f"Error updating voice pitch: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def preview_voice(sid, data):
        """Preview a TTS voice"""
        try:
            text = data.get('text', 'Hello! This is a voice preview.')
            voice = data.get('voice')

            if not voice:
                await sio.emit('error', {'message': 'No voice specified'}, room=sid)
                return

            # Temporarily switch voice for preview
            old_voice = getattr(_state['tts'], 'voice', None)
            if hasattr(_state['tts'], 'set_voice'):
                _state['tts'].set_voice(voice)

            # Generate preview audio
            audio_data = await asyncio.to_thread(_state['audio_service'].generate_speech, text)

            # Restore original voice
            if old_voice and hasattr(_state['tts'], 'set_voice'):
                _state['tts'].set_voice(old_voice)

            if audio_data:
                await sio.emit('voice_preview', {'audio': audio_data}, room=sid)
                logger.info(f"Voice preview sent for {voice}")
            else:
                await sio.emit('error', {'message': 'Failed to generate preview'}, room=sid)

        except Exception as e:
            logger.error(f"Error generating voice preview: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    logger.info("✓ WebSocket handlers registered")
