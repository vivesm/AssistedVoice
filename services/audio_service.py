"""
Audio processing service
Handles speech-to-text and text-to-speech operations
"""
import logging
import base64
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


class AudioService:
    """Service for audio processing (STT and TTS)"""

    def __init__(self, stt, tts):
        """
        Initialize audio service

        Args:
            stt: Speech-to-text instance
            tts: Text-to-speech instance
        """
        self.stt = stt
        self.tts = tts

    def transcribe_audio(self, audio_data: str) -> str:
        """
        Transcribe base64-encoded audio data to text

        Args:
            audio_data: Base64-encoded audio data

        Returns:
            Transcribed text
        """
        try:
            text = self.stt.transcribe_base64(audio_data)
            logger.info(f"Transcribed: {text}")
            return text
        except Exception as e:
            logger.error(f"Transcription error: {e}")
            raise

    def generate_speech(self, text: str, return_base64: bool = True):
        """
        Generate speech from text

        Args:
            text: Text to convert to speech
            return_base64: If True, return base64-encoded audio data

        Returns:
            Base64-encoded audio data if return_base64=True, otherwise file path
        """
        try:
            if self.tts is None:
                logger.warning("TTS engine is None, skipping speech generation")
                return None

            logger.info(f"Generating speech for: {text[:50]}...")

            # Generate speech
            audio_file = self.tts.synthesize(text)

            if return_base64:
                # Read and convert to base64
                with open(audio_file, 'rb') as f:
                    audio_data = base64.b64encode(f.read()).decode('utf-8')
                logger.info(f"Audio data generated, length: {len(audio_data)}")
                return audio_data
            else:
                return audio_file

        except Exception as e:
            logger.error(f"TTS error: {e}")
            raise

    def switch_tts_engine(self, engine: str, config: dict):
        """
        Switch TTS engine

        Args:
            engine: Engine name ('edge-tts', 'macos', 'pyttsx3', 'none')
            config: Configuration dictionary

        Returns:
            New TTS instance or None
        """
        from modules.tts import create_tts_engine

        try:
            # Update config
            config['tts']['engine'] = engine

            # Create new TTS engine
            if engine == 'none':
                logger.info("TTS disabled")
                self.tts = None
                return None
            else:
                new_tts = create_tts_engine(config)
                logger.info(f"TTS engine changed to: {engine}")
                self.tts = new_tts
                return new_tts

        except Exception as e:
            logger.error(f"Failed to switch TTS engine: {e}")
            raise
