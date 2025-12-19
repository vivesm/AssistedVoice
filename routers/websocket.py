"""
Async WebSocket event handlers
Handles real-time communication between client and server
"""
import os
import logging
import base64
import tempfile
import asyncio
import subprocess
import numpy as np
from services.live_assistant_service import LiveAssistantService

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
        'model_service': model_service,
        'live_assistant': LiveAssistantService(chat_service)
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

        # Clean up live PCM buffers for this session
        if 'live_pcm_buffers' in _state and sid in _state['live_pcm_buffers']:
            del _state['live_pcm_buffers'][sid]
            logger.debug(f"Cleaned up PCM buffer for {sid}")

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
            voice = data.get('voice')
            
            if engine:
                # Use audio service to switch TTS (run in thread pool)
                new_tts = await asyncio.to_thread(
                    _state['audio_service'].switch_tts_engine,
                    engine,
                    _state['config']
                )
                _state['tts'] = new_tts
                
                # If voice also provided, set it
                if voice and hasattr(new_tts, 'set_voice'):
                    new_tts.set_voice(voice)
                    _state['config']['tts']['voice' if engine == 'macos' else 'edge_voice'] = voice

                await sio.emit('tts_changed', {'engine': engine, 'voice': voice}, room=sid)
                logger.info(f"TTS engine changed to: {engine}, voice: {voice}")

        except Exception as e:
            logger.error(f"Error changing TTS engine: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def update_voice(sid, data):
        """Permanently change the TTS voice for the current engine"""
        try:
            voice = data.get('voice')
            if voice and hasattr(_state['tts'], 'set_voice'):
                _state['tts'].set_voice(voice)
                
                # Update config dynamically based on engine
                engine = _state['config']['tts']['engine']
                if engine == 'edge-tts':
                    _state['config']['tts']['edge_voice'] = voice
                else:
                    _state['config']['tts']['voice'] = voice
                    
                logger.info(f"TTS voice updated to: {voice} for engine: {engine}")
                await sio.emit('status', {'message': f'Voice set to {voice}', 'type': 'ready'}, room=sid)
            else:
                logger.warning(f"Voice update requested but engine {type(_state['tts']).__name__} does not support set_voice or voice missing")
        except Exception as e:
            logger.error(f"Error updating voice: {e}")
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
                        logger.info(f"Sending audio data ({len(audio_data)} bytes) for replay")
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

    @sio.event
    async def update_speech_rate(sid, data):
        """Update TTS speech rate"""
        try:
            rate = data.get('rate')
            if rate and hasattr(_state['tts'], 'set_rate'):
                _state['tts'].set_rate(rate)
                # Update config
                _state['config']['tts']['rate'] = rate
                logger.info(f"Speech rate updated to {rate}")
                await sio.emit('status', {'message': f'Speech rate updated to {rate}', 'type': 'ready'}, room=sid)
        except Exception as e:
            logger.error(f"Error updating speech rate: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def update_voice_volume(sid, data):
        """Update TTS voice volume"""
        try:
            volume = data.get('volume')
            if volume and hasattr(_state['tts'], 'set_volume'):
                # Handle both numeric and string percentage
                vol_str = str(volume)
                if not vol_str.startswith(('+', '-')) and not vol_str.endswith('%'):
                    vol_str = f"+{vol_str}%" if int(volume) >= 0 else f"{vol_str}%"
                
                _state['tts'].set_volume(vol_str)
                # Update config
                _state['config']['tts']['volume'] = vol_str
                logger.info(f"Voice volume updated to {vol_str}")
        except Exception as e:
            logger.error(f"Error updating voice volume: {e}")

    @sio.event
    async def stop_generation(sid, data=None):
        """Stop LLM response generation"""
        try:
            logger.info(f"Client {sid} requested to stop generation")
            # Note: Since we're using synchronous generators, we can't actually stop mid-stream
            # This event serves as a signal to the client that generation should be considered stopped
            # In a future implementation with async generators, we could interrupt the generation
            await sio.emit('generation_stopped', {}, room=sid)
            await sio.emit('status', {'message': 'Generation stopped', 'type': 'ready'}, room=sid)
        except Exception as e:
            logger.error(f"Error stopping generation: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def live_audio_chunk(sid, data):
        """Process continuous audio chunks in live assistant mode"""
        try:
            logger.debug(f"Received live audio chunk from {sid}")

            # Decode base64 audio
            audio_data = base64.b64decode(data['audio'].split(',')[1] if ',' in data['audio'] else data['audio'])

            # Save to temporary WebM file
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp_webm:
                tmp_webm.write(audio_data)
                webm_path = tmp_webm.name

            # Convert WebM to WAV for better Whisper compatibility
            wav_path = webm_path.replace('.webm', '.wav')

            try:
                # Use FFmpeg to convert WebM to WAV (run in thread pool)
                await asyncio.to_thread(
                    subprocess.run,
                    [
                        'ffmpeg', '-i', webm_path,
                        '-ar', '16000',  # 16kHz sample rate
                        '-ac', '1',       # Mono
                        '-y',             # Overwrite output file
                        wav_path
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=True
                )

                # Transcribe WAV file (run in thread pool for blocking operation)
                segments, info = await asyncio.to_thread(
                    _state['stt'].model.transcribe,
                    wav_path,
                    language=_state['config']['whisper']['language']
                )
                transcription = " ".join([segment.text for segment in segments]).strip()

            finally:
                # Clean up temp files
                if os.path.exists(webm_path):
                    os.unlink(webm_path)
                if os.path.exists(wav_path):
                    os.unlink(wav_path)

            if not transcription:
                return  # Skip empty transcriptions

            # Add to live assistant buffer
            _state['live_assistant'].add_transcript(transcription)

            # Emit transcript immediately
            await sio.emit('live_transcript', {
                'text': transcription,
                'timestamp': data.get('timestamp', 0)
            }, room=sid)

            # Check if should generate AI insight
            if _state['live_assistant'].should_generate_insight(interval_chunks=3):
                logger.info("Generating AI insight...")

                # Generate insight (run in thread pool to avoid blocking)
                insight = await asyncio.to_thread(_state['live_assistant'].generate_insight)

                # Emit AI insight
                await sio.emit('ai_insight', {
                    'topic': insight['topic'],
                    'key_points': insight['key_points']
                }, room=sid)

        except Exception as e:
            logger.error(f"Error processing live audio chunk: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def live_pcm_chunk(sid, data):
        """Process continuous PCM audio chunks from AudioWorklet"""
        try:
            # Decode base64 PCM data
            pcm_b64 = data['audio']
            pcm_bytes = base64.b64decode(pcm_b64)

            # Convert bytes to numpy Float32 array
            pcm_array = np.frombuffer(pcm_bytes, dtype=np.float32)

            logger.info(f"Received live PCM chunk: {len(pcm_array)} samples from {sid}")

            # Get sample rate from client
            sample_rate = data.get('sampleRate', 16000)

            # Initialize session buffer if needed
            if 'live_pcm_buffers' not in _state:
                _state['live_pcm_buffers'] = {}
            if sid not in _state['live_pcm_buffers']:
                _state['live_pcm_buffers'][sid] = []

            # Accumulate PCM samples
            _state['live_pcm_buffers'][sid].append(pcm_array)

            # Calculate total samples buffered
            total_samples = sum(len(chunk) for chunk in _state['live_pcm_buffers'][sid])

            # Target: ~2.5 seconds of audio (faster feedback)
            target_samples = sample_rate * 2.5

            logger.info(f"Buffer status: {total_samples}/{target_samples} samples ({total_samples/sample_rate:.2f}s accumulated)")

            # Process when we have enough audio
            if total_samples >= target_samples:
                # Concatenate all buffered PCM
                full_audio = np.concatenate(_state['live_pcm_buffers'][sid])

                # Transcribe directly with Whisper (numpy array input)
                segments, info = await asyncio.to_thread(
                    _state['stt'].model.transcribe,
                    full_audio,
                    language=_state['config']['whisper']['language'],
                    vad_filter=True,  # Enable VAD to filter silence/noise
                    beam_size=1  # Fast decoding for real-time
                )

                # Convert generator to list once to avoid exhaustion
                segments_list = list(segments)
                transcription = " ".join([segment.text for segment in segments_list]).strip()

                # Log transcription result
                logger.info(f"Transcription result: '{transcription}' (segments: {len(segments_list)}, duration: {info.duration:.2f}s)")

                # Keep last 1 second for context continuity
                keep_samples = sample_rate * 1
                if len(full_audio) > keep_samples:
                    _state['live_pcm_buffers'][sid] = [full_audio[-keep_samples:]]
                else:
                    _state['live_pcm_buffers'][sid] = []

                # Only emit if we got transcription
                if transcription:
                    # Add to live assistant buffer
                    _state['live_assistant'].add_transcript(transcription)

                    # Emit transcript immediately
                    await sio.emit('live_transcript', {
                        'text': transcription,
                        'timestamp': data.get('timestamp', 0)
                    }, room=sid)

                    # Check if should generate AI insight
                    if _state['live_assistant'].should_generate_insight(interval_chunks=3):
                        logger.info("Generating AI insight...")

                        # Generate insight (run in thread pool to avoid blocking)
                        insight = await asyncio.to_thread(_state['live_assistant'].generate_insight)

                        # Emit AI insight
                        await sio.emit('ai_insight', {
                            'topic': insight['topic'],
                            'key_points': insight['key_points']
                        }, room=sid)
                else:
                    logger.warning(f"Empty transcription from {len(full_audio)} samples - likely silence or low volume")

        except Exception as e:
            logger.error(f"Error processing live PCM chunk: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def clear_live_assistant(sid, data=None):
        """Clear live assistant transcript buffer"""
        try:
            _state['live_assistant'].clear()
            await sio.emit('live_assistant_cleared', {}, room=sid)
        except Exception as e:
            logger.error(f"Error clearing live assistant: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    logger.info("✓ WebSocket handlers registered")
