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
from modules.config_helper import save_config_to_file

logger = logging.getLogger(__name__)


def register_websocket_handlers(sio, config, stt, tts, chat_service, audio_service, model_service, reading_service):
    """Register async WebSocket event handlers"""

    # Store references for handler access
    _state = {
        'llm': chat_service.llm if chat_service else None,
        'config': config,
        'stt': stt,
        'tts': tts,
        'chat_service': chat_service,
        'audio_service': audio_service,
        'model_service': model_service,
        'reading_service': reading_service,
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
    
        # Reset stitching state
        if f'last_live_text_{sid}' in _state:
            del _state[f'last_live_text_{sid}']

    @sio.event
    async def process_audio(sid, data):
        """Process audio from client (PTT mode)"""
        try:
            enable_tts = data.get('enable_tts', True)
            logger.info(f"Processing PTT audio from {sid} (size: {len(data['audio'])} bytes)")

            # Transcribe using STT module's optimized helper
            await sio.emit('status', {'message': 'Transcribing...', 'type': 'transcribing'}, room=sid)
            # Transcribe the audio (VAD disabled - we have good audio now)
            transcription = await asyncio.to_thread(_state['stt'].transcribe_base64, data['audio'], vad_filter=False, beam_size=5)

            if not transcription:
                await sio.emit('error', {'message': 'No speech detected'}, room=sid)
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


        except Exception as e:
            logger.error(f"Error processing audio: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def process_text(sid, data):
        """Process text input from client"""
        try:
            text = data.get('text', '').strip()
            images = data.get('images', [])  # List of base64-encoded images
            enable_tts = data.get('enable_tts', True)

            if not text and not images:
                return

            # Use default prompt if text is empty but images are present
            if not text and images:
                text = "Describe this image in detail."

            # Generate response
            await sio.emit('status', {'message': 'Generating response...', 'type': 'generating'}, room=sid)

            response_text = ""
            for chunk in _state['chat_service'].generate_response(text, images=images, stream=True):
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

                # Persist config
                save_config_to_file(_state['config'])

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

                # Persist config
                save_config_to_file(_state['config'])

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

                # Persist config
                save_config_to_file(_state['config'])
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

                # Persist config
                save_config_to_file(_state['config'])

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
    async def update_server_config(sid, data):
        """Update server configuration (type, host, port)"""
        try:
            if 'server' not in _state['config']:
                _state['config']['server'] = {}
            
            updated = False
            if 'type' in data:
                _state['config']['server']['type'] = data['type']
                updated = True
            if 'host' in data:
                _state['config']['server']['host'] = data['host']
                updated = True
            if 'port' in data:
                _state['config']['server']['port'] = data['port']
                updated = True
                
            if updated:
                logger.info(f"Server config updated: {data}")
                await sio.emit('status', {'message': 'Server configuration updated (restart required for some changes)', 'type': 'ready'}, room=sid)
                # Persist config
                save_config_to_file(_state['config'])
                
        except Exception as e:
            logger.error(f"Error updating server config: {e}")
            await sio.emit('error', {'message': str(e)}, room=sid)

    @sio.event
    async def update_vad_config(sid, data):
        """Update VAD configuration"""
        try:
            if 'vad' not in _state['config']:
                _state['config']['vad'] = {}
            
            updated = False
            if 'enabled' in data:
                _state['config']['vad']['enabled'] = data['enabled']
                updated = True
            if 'mode' in data:
                _state['config']['vad']['mode'] = data['mode']
                updated = True
            if 'speech_timeout' in data:
                _state['config']['vad']['speech_timeout'] = data['speech_timeout']
                updated = True
            if 'min_speech_duration' in data:
                _state['config']['vad']['min_speech_duration'] = data['min_speech_duration']
                updated = True
                
            if updated:
                logger.info(f"VAD config updated: {data}")
                await sio.emit('status', {'message': 'VAD configuration updated', 'type': 'ready'}, room=sid)
                # Persist config
                save_config_to_file(_state['config'])
                
        except Exception as e:
            logger.error(f"Error updating VAD config: {e}")
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

                # Persist config
                save_config_to_file(_state['config'])

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

                # Persist config
                save_config_to_file(_state['config'])

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

                # Persist config
                save_config_to_file(_state['config'])

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
                
                # Persist config
                save_config_to_file(_state['config'])
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

                # Persist config
                save_config_to_file(_state['config'])
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

                # Persist config
                save_config_to_file(_state['config'])
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

            # Calculate RMS for volume debugging (using simple mean absolute as proxy)
            rms = np.abs(pcm_array).mean()
            logger.info(f"Received live PCM chunk: {len(pcm_array)} samples, RMS: {rms:.6f} from {sid}")

            # Skip processing if chunk is silent (threshold: 0.0005)
            # This is essential to prevent CPU overload
            if rms < 0.0005:
                return

            # Get sample rate from client
            sample_rate = data.get('sampleRate', 16000)

            # Initialize session buffer if needed
            if 'live_pcm_buffers' not in _state:
                _state['live_pcm_buffers'] = {}
            if sid not in _state['live_pcm_buffers']:
                _state['live_pcm_buffers'][sid] = []
            
            # Concurrency check
            if f'is_transcribing_{sid}' not in _state:
                _state[f'is_transcribing_{sid}'] = False

            # Accumulate PCM samples
            _state['live_pcm_buffers'][sid].append(pcm_array)

            # Calculate total samples buffered
            total_samples = sum(len(chunk) for chunk in _state['live_pcm_buffers'][sid])

            # Target: ~2.5 seconds of audio for better context
            target_samples = sample_rate * 2.5

            # Process when we have enough audio and not already transcribing
            if total_samples >= target_samples and not _state[f'is_transcribing_{sid}']:
                # Set transcribing flag
                _state[f'is_transcribing_{sid}'] = True
                
                try:
                    # Concatenate all buffered PCM
                    full_audio = np.concatenate(_state['live_pcm_buffers'][sid])

                    # Normalize audio to improve transcription accuracy (like PTT mode's loudnorm)
                    # Calculate current RMS
                    audio_rms = np.sqrt(np.mean(full_audio ** 2))
                    if audio_rms > 0:
                        # Target RMS of 0.1 (similar to normalized audio)
                        target_rms = 0.1
                        normalization_factor = target_rms / audio_rms
                        # Apply gain with clipping protection
                        full_audio = np.clip(full_audio * normalization_factor, -1.0, 1.0)
                        logger.info(f"Audio normalized: RMS {audio_rms:.4f} -> {np.sqrt(np.mean(full_audio ** 2)):.4f} (gain: {normalization_factor:.2f}x)")

                    # Transcribe using optimized STT method with beam_size=3 for better accuracy
                    transcription = await asyncio.to_thread(_state['stt'].transcribe, full_audio, beam_size=3)
                finally:
                    _state[f'is_transcribing_{sid}'] = False

                # Log transcription result
                logger.info(f"Live transcription result: '{transcription}' from {sid}")

                # Keep last 1.0 seconds for context continuity
                keep_samples = int(sample_rate * 1.0)
                if len(full_audio) > keep_samples:
                    _state['live_pcm_buffers'][sid] = [full_audio[-keep_samples:]]
                else:
                    _state['live_pcm_buffers'][sid] = []

                if transcription:
                    # Improved stitching: find overlap by words
                    prev_text = _state.get(f'last_live_text_{sid}', "")
                    
                    # Split into words for comparison
                    prev_words = prev_text.lower().split()
                    curr_words = transcription.lower().split()
                    
                    # Find the longest suffix of prev_words that matches a prefix of curr_words
                    overlap_count = 0
                    for i in range(1, min(len(prev_words), len(curr_words)) + 1):
                        if prev_words[-i:] == curr_words[:i]:
                            overlap_count = i
                    
                    # The 'new' part is everything after the overlap
                    # Use the original case/punctuation from the current transcription
                    new_words_count = len(curr_words) - overlap_count
                    if overlap_count > 0:
                        # Re-split originally to keep punctuation
                        original_curr_words = transcription.split()
                        new_text = " ".join(original_curr_words[overlap_count:]).strip()
                    else:
                        new_text = transcription
                    
                    if not new_text:
                        logger.info("No new words in this chunk (overlap only)")
                    else:
                        logger.info(f"✅ Live Transcription (New): '{new_text}'")
                        _state[f'last_live_text_{sid}'] = transcription

                        # Add to live assistant buffer
                        _state['live_assistant'].add_transcript(new_text)

                        # Emit transcript immediately
                        await sio.emit('live_transcript', {
                            'text': new_text,
                            'timestamp': data.get('timestamp', 0)
                        }, room=sid)

                        # Check if should generate AI insight
                        if _state['live_assistant'].should_generate_insight(interval_chunks=3):
                            logger.info("🤖 Generating AI insight...")

                            # Generate insight (run in thread pool to avoid blocking)
                            insight = await asyncio.to_thread(_state['live_assistant'].generate_insight)
                            logger.info(f"✨ AI Insight generated: {insight.get('topic', 'Unknown')}")

                            # Emit AI insight
                            await sio.emit('ai_insight', {
                                'topic': insight['topic'],
                                'key_points': insight['key_points']
                            }, room=sid)
                else:
                    logger.info(f"🔇 Silent chunk (length: {len(full_audio)}) - no transcription")

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


    # ==================== Reading Mode Handlers ====================
    
    @sio.event
    async def start_reading(sid, data):
        """Initialize reading session with text or share code"""
        try:
            mode = data.get('mode', 'text')  # 'text' or 'share'
            
            if mode == 'share':
                # Fetch content from share.vives.io
                share_code = data.get('share_code', '').strip()
                if not share_code:
                    await sio.emit('reading_error', {'message': 'Share code is required'}, room=sid)
                    return
                
                logger.info(f"Fetching share content for code: {share_code}")
                success, content = await _state['reading_service'].fetch_share_content(share_code)
                
                if not success:
                    await sio.emit('reading_error', {'message': content}, room=sid)
                    return
                
                text = content
                source = f"share:{share_code}"
                
            else:  # mode == 'text'
                text = data.get('text', '').strip()
                if not text:
                    await sio.emit('reading_error', {'message': 'Text is required'}, room=sid)
                    return
                source = "text"
            
            # Validate text length
            max_length = _state['reading_service'].max_text_length
            if len(text) > max_length:
                await sio.emit('reading_error', {
                    'message': f'Text too large ({len(text)} chars). Maximum: {max_length}'
                }, room=sid)
                return
            
            # Create reading session
            try:
                session = _state['reading_service'].create_session(sid, text, source)
                
                # Send session info to client
                await sio.emit('reading_started', {
                    'total_chunks': session['total_chunks'],
                    'source': session['source'],
                    'text_length': len(text)
                }, room=sid)
                
                # Send initial progress
                progress = _state['reading_service'].get_progress(sid)
                await sio.emit('reading_progress', progress, room=sid)
                
                logger.info(f"Reading session started for {sid}: {session['total_chunks']} chunks")
                
            except ValueError as e:
                await sio.emit('reading_error', {'message': str(e)}, room=sid)
                
        except Exception as e:
            logger.error(f"Error starting reading session: {e}")
            await sio.emit('reading_error', {'message': str(e)}, room=sid)


    @sio.event
    async def reading_play(sid, data=None):
        """Start or resume reading from current position"""
        try:
            session = _state['reading_service'].get_session(sid)
            if not session:
                await sio.emit('reading_error', {'message': 'No active reading session'}, room=sid)
                return
            
            # Set state to playing
            _state['reading_service'].set_state(sid, 'playing')
            
            # Get current chunk
            chunk_text = _state['reading_service'].get_current_chunk(sid)
            if not chunk_text:
                await sio.emit('reading_complete', {}, room=sid)
                _state['reading_service'].set_state(sid, 'stopped')
                return
            
            # Send chunk info
            progress = _state['reading_service'].get_progress(sid)
            await sio.emit('reading_chunk', {
                'text': chunk_text,
                'progress': progress
            }, room=sid)
            
            # Generate TTS if enabled
            if _state['config']['tts']['engine'] != 'none':
                if hasattr(_state['tts'], 'generate_audio_base64'):
                    audio_data = await asyncio.to_thread(_state['tts'].generate_audio_base64, chunk_text)
                    if audio_data:
                        await sio.emit('reading_audio', {'audio': audio_data}, room=sid)
                else:
                    # Fallback to direct playback (not ideal for web)
                    if hasattr(_state['tts'], 'speak_async'):
                        await asyncio.to_thread(_state['tts'].speak_async, chunk_text)
                    else:
                        await asyncio.to_thread(_state['tts'].speak, chunk_text)
            
            logger.info(f"Playing chunk {progress['current_chunk']} for {sid}")
            
        except Exception as e:
            logger.error(f"Error playing reading: {e}")
            await sio.emit('reading_error', {'message': str(e)}, room=sid)


    @sio.event
    async def reading_pause(sid, data=None):
        """Pause reading at current position"""
        try:
            _state['reading_service'].set_state(sid, 'paused')
            await sio.emit('reading_paused', {}, room=sid)
            logger.info(f"Reading paused for {sid}")
        except Exception as e:
            logger.error(f"Error pausing reading: {e}")
            await sio.emit('reading_error', {'message': str(e)}, room=sid)


    @sio.event
    async def reading_stop(sid, data=None):
        """Stop reading and reset to beginning"""
        try:
            _state['reading_service'].reset_position(sid)
            await sio.emit('reading_stopped', {}, room=sid)
            
            # Send updated progress
            progress = _state['reading_service'].get_progress(sid)
            if progress:
                await sio.emit('reading_progress', progress, room=sid)
            
            logger.info(f"Reading stopped for {sid}")
        except Exception as e:
            logger.error(f"Error stopping reading: {e}")
            await sio.emit('reading_error', {'message': str(e)}, room=sid)


    @sio.event
    async def reading_next(sid, data=None):
        """Skip to next chunk"""
        try:
            next_chunk = _state['reading_service'].get_next_chunk(sid)
            
            if next_chunk is None:
                # Reached end
                await sio.emit('reading_complete', {}, room=sid)
                _state['reading_service'].set_state(sid, 'stopped')
            else:
                # Send updated progress
                progress = _state['reading_service'].get_progress(sid)
                await sio.emit('reading_progress', progress, room=sid)
                
                # If currently playing, play the new chunk
                session = _state['reading_service'].get_session(sid)
                if session and session['state'] == 'playing':
                    await reading_play(sid)
            
            logger.info(f"Skipped to next chunk for {sid}")
            
        except Exception as e:
            logger.error(f"Error skipping to next chunk: {e}")
            await sio.emit('reading_error', {'message': str(e)}, room=sid)


    @sio.event
    async def reading_previous(sid, data=None):
        """Go back to previous chunk"""
        try:
            prev_chunk = _state['reading_service'].get_previous_chunk(sid)
            
            if prev_chunk is None:
                # Already at beginning
                await sio.emit('reading_error', {'message': 'Already at beginning'}, room=sid)
            else:
                # Send updated progress
                progress = _state['reading_service'].get_progress(sid)
                await sio.emit('reading_progress', progress, room=sid)
                
                # If currently playing, play the new chunk
                session = _state['reading_service'].get_session(sid)
                if session and session['state'] == 'playing':
                    await reading_play(sid)
            
            logger.info(f"Went back to previous chunk for {sid}")
            
        except Exception as e:
            logger.error(f"Error going to previous chunk: {e}")
            await sio.emit('reading_error', {'message': str(e)}, room=sid)


    @sio.event
    async def reading_seek(sid, data):
        """Seek to specific chunk index"""
        try:
            chunk_index = data.get('chunk_index', 0)
            chunk_text = _state['reading_service'].seek_to_chunk(sid, chunk_index)
            
            if chunk_text is None:
                await sio.emit('reading_error', {'message': 'Invalid chunk index'}, room=sid)
            else:
                # Send updated progress
                progress = _state['reading_service'].get_progress(sid)
                await sio.emit('reading_progress', progress, room=sid)
                
                # If currently playing, play the new chunk
                session = _state['reading_service'].get_session(sid)
                if session and session['state'] == 'playing':
                    await reading_play(sid)
            
            logger.info(f"Seeked to chunk {chunk_index} for {sid}")
            
        except Exception as e:
            logger.error(f"Error seeking: {e}")
            await sio.emit('reading_error', {'message': str(e)}, room=sid)


    @sio.event
    async def reading_auto_advance(sid, data=None):
        """Auto-advance to next chunk (called when TTS completes)"""
        try:
            session = _state['reading_service'].get_session(sid)
            if not session or session['state'] != 'playing':
                return
            
            # Move to next chunk
            next_chunk = _state['reading_service'].get_next_chunk(sid)
            
            if next_chunk is None:
                # Reached end
                await sio.emit('reading_complete', {}, room=sid)
                _state['reading_service'].set_state(sid, 'stopped')
            else:
                # Auto-play next chunk
                await reading_play(sid)
            
        except Exception as e:
            logger.error(f"Error auto-advancing: {e}")
            await sio.emit('reading_error', {'message': str(e)}, room=sid)


    @sio.event
    async def end_reading(sid, data=None):
        """End reading session and clean up"""
        try:
            _state['reading_service'].delete_session(sid)
            await sio.emit('reading_ended', {}, room=sid)
            logger.info(f"Reading session ended for {sid}")
        except Exception as e:
            logger.error(f"Error ending reading session: {e}")
            await sio.emit('reading_error', {'message': str(e)}, room=sid)


    logger.info("✓ WebSocket handlers registered")
