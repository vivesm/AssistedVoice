"""
Text-to-Speech module with multiple engine support
"""
import os
import subprocess
import tempfile
import logging
from typing import Optional
import pyttsx3
from threading import Thread
import queue

logger = logging.getLogger(__name__)


class TTSEngine:
    """Base TTS Engine class"""
    
    def speak(self, text: str):
        """Convert text to speech"""
        raise NotImplementedError
    
    def stop(self):
        """Stop current speech"""
        pass
    
    def set_voice(self, voice: str):
        """Set voice"""
        pass
    
    def set_rate(self, rate: int):
        """Set speech rate"""
        pass
    
    def set_volume(self, volume: float):
        """Set volume"""
        pass


class MacOSTTS(TTSEngine):
    """macOS native TTS using 'say' command"""
    
    def __init__(self, config: dict):
        self.config = config
        self.voice = config['tts'].get('voice', 'Samantha')
        self.rate = config['tts'].get('rate', 180)
        self.current_process = None
        
    def speak(self, text: str):
        """Speak text using macOS say command"""
        try:
            # Clean text for speech
            text = self._clean_text(text)
            
            # Build command
            cmd = ['say']
            if self.voice:
                cmd.extend(['-v', self.voice])
            if self.rate:
                cmd.extend(['-r', str(self.rate)])
            cmd.append(text)
            
            # Execute
            self.current_process = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            self.current_process.wait()
            
        except Exception as e:
            logger.error(f"macOS TTS error: {e}")
    
    def speak_async(self, text: str):
        """Speak text asynchronously"""
        thread = Thread(target=self.speak, args=(text,))
        thread.daemon = True
        thread.start()
    
    def stop(self):
        """Stop current speech"""
        if self.current_process:
            self.current_process.terminate()
            self.current_process = None
    
    def set_voice(self, voice: str):
        """Set voice"""
        self.voice = voice
    
    def set_rate(self, rate: int):
        """Set speech rate"""
        self.rate = rate
    
    def _clean_text(self, text: str) -> str:
        """Clean text for speech output"""
        # Remove markdown formatting
        text = text.replace('**', '').replace('*', '')
        text = text.replace('```', '').replace('`', '')
        text = text.replace('#', '')
        
        # Remove URLs
        import re
        text = re.sub(r'http[s]?://\S+', 'link', text)
        
        # Remove excessive whitespace
        text = ' '.join(text.split())
        
        return text
    
    @staticmethod
    def list_voices():
        """List available macOS voices"""
        try:
            result = subprocess.run(
                ['say', '-v', '?'],
                capture_output=True,
                text=True
            )
            voices = []
            for line in result.stdout.split('\n'):
                if line:
                    parts = line.split()
                    if parts:
                        voice_name = parts[0]
                        voices.append(voice_name)
            return voices
        except:
            return []


class Pyttsx3TTS(TTSEngine):
    """Cross-platform TTS using pyttsx3"""
    
    def __init__(self, config: dict):
        self.config = config
        self.engine = pyttsx3.init()
        self.setup()
        
    def setup(self):
        """Configure TTS engine"""
        # Set properties
        self.engine.setProperty('rate', self.config['tts'].get('rate', 180))
        self.engine.setProperty('volume', self.config['tts'].get('volume', 0.9))
        
        # Set voice if specified
        voice_name = self.config['tts'].get('voice')
        if voice_name:
            voices = self.engine.getProperty('voices')
            for voice in voices:
                if voice_name.lower() in voice.name.lower():
                    self.engine.setProperty('voice', voice.id)
                    break
    
    def speak(self, text: str):
        """Speak text"""
        try:
            text = self._clean_text(text)
            self.engine.say(text)
            self.engine.runAndWait()
        except Exception as e:
            logger.error(f"pyttsx3 TTS error: {e}")
    
    def stop(self):
        """Stop speech"""
        self.engine.stop()
    
    def _clean_text(self, text: str) -> str:
        """Clean text for speech"""
        # Remove markdown and special characters
        text = text.replace('**', '').replace('*', '')
        text = text.replace('```', '').replace('`', '')
        text = text.replace('#', '')
        return ' '.join(text.split())


class SilentTTS(TTSEngine):
    """Silent TTS for text-only mode"""
    
    def __init__(self, config: dict):
        self.config = config
        logger.info("Text-only mode - TTS disabled")
    
    def speak(self, text: str):
        """Do nothing - text only mode"""
        pass


class StreamingTTS:
    """TTS with streaming support for real-time synthesis"""
    
    def __init__(self, engine: TTSEngine):
        self.engine = engine
        self.text_queue = queue.Queue()
        self.is_speaking = False
        self.worker_thread = None
        
    def start(self):
        """Start streaming TTS worker"""
        self.worker_thread = Thread(target=self._worker)
        self.worker_thread.daemon = True
        self.worker_thread.start()
    
    def _worker(self):
        """Worker thread for streaming TTS"""
        buffer = ""
        
        while True:
            try:
                # Get text chunk
                chunk = self.text_queue.get(timeout=0.1)
                
                if chunk is None:  # End signal
                    if buffer:
                        self.engine.speak(buffer)
                        buffer = ""
                    continue
                
                buffer += chunk
                
                # Speak on sentence boundaries
                if any(char in chunk for char in '.!?'):
                    if buffer.strip():
                        self.is_speaking = True
                        self.engine.speak(buffer)
                        self.is_speaking = False
                        buffer = ""
                
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"Streaming TTS error: {e}")
    
    def add_text(self, text: str):
        """Add text to speak queue"""
        self.text_queue.put(text)
    
    def flush(self):
        """Flush remaining text"""
        self.text_queue.put(None)
    
    def stop(self):
        """Stop speaking"""
        # Clear queue
        while not self.text_queue.empty():
            try:
                self.text_queue.get_nowait()
            except:
                pass
        
        # Stop engine
        self.engine.stop()


def create_tts_engine(config: dict) -> TTSEngine:
    """Factory function to create TTS engine"""
    engine_type = config['tts'].get('engine', 'macos')
    
    if engine_type == 'none' or config['ui'].get('mode') == 'text':
        return SilentTTS(config)
    elif engine_type == 'macos':
        # Check if on macOS
        import platform
        if platform.system() == 'Darwin':
            return MacOSTTS(config)
        else:
            logger.warning("macOS TTS not available on this platform, using pyttsx3")
            return Pyttsx3TTS(config)
    elif engine_type == 'pyttsx3':
        return Pyttsx3TTS(config)
    else:
        logger.warning(f"Unknown TTS engine: {engine_type}, using silent mode")
        return SilentTTS(config)