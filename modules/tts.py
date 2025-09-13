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
import asyncio
import edge_tts
import base64

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


class EdgeTTS(TTSEngine):
    """Microsoft Edge TTS using edge-tts library"""
    
    def __init__(self, config: dict):
        self.config = config
        self.voice = config['tts'].get('edge_voice', 'en-US-JennyNeural')
        
        # Handle rate parameter - convert integer WPM to percentage string
        rate_value = config['tts'].get('rate', 180)
        if isinstance(rate_value, (int, float)):
            # Convert WPM to percentage (180 WPM = normal speed)
            wpm = rate_value
            if wpm < 150:
                self.rate = f"-{int((180-wpm)/180*100)}%"
            elif wpm > 210:
                self.rate = f"+{int((wpm-180)/180*100)}%"
            else:
                self.rate = "+0%"
        else:
            self.rate = str(rate_value) if rate_value else '+0%'
        
        # Handle volume parameter - convert float to percentage string
        volume_value = config['tts'].get('volume', 0.9)
        if isinstance(volume_value, (int, float)):
            # Convert 0.0-1.0 to percentage (-50% to +50%)
            vol = float(volume_value)
            if vol < 0.5:
                self.volume = f"-{int((0.5-vol)*100)}%"
            elif vol > 0.5:
                self.volume = f"+{int((vol-0.5)*100)}%"
            else:
                self.volume = "+0%"
        else:
            self.volume = str(volume_value) if volume_value else '+0%'
        
        self.pitch = config['tts'].get('pitch', '+0Hz')
        logger.info(f"Edge TTS initialized with voice: {self.voice}, rate: {self.rate}, volume: {self.volume}")
    
    def speak(self, text: str):
        """Speak text using edge-tts"""
        try:
            # Clean text for speech
            text = self._clean_text(text)
            
            # Create temporary audio file
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp_file:
                tmp_path = tmp_file.name
            
            # Generate speech using edge-tts
            asyncio.run(self._generate_speech(text, tmp_path))
            
            # Play the audio file
            self._play_audio(tmp_path)
            
            # Clean up
            os.unlink(tmp_path)
            
        except Exception as e:
            logger.error(f"Edge TTS error: {e}")
    
    def generate_audio_base64(self, text: str) -> Optional[str]:
        """Generate speech and return as base64-encoded audio data"""
        try:
            # Clean text for speech
            text = self._clean_text(text)
            
            # Create temporary audio file
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp_file:
                tmp_path = tmp_file.name
            
            # Generate speech using edge-tts
            asyncio.run(self._generate_speech(text, tmp_path))
            
            # Read audio file and encode to base64
            with open(tmp_path, 'rb') as audio_file:
                audio_data = audio_file.read()
                base64_audio = base64.b64encode(audio_data).decode('utf-8')
            
            # Clean up
            os.unlink(tmp_path)
            
            return f"data:audio/mp3;base64,{base64_audio}"
            
        except Exception as e:
            logger.error(f"Edge TTS base64 generation error: {e}")
            return None
    
    async def _generate_speech(self, text: str, output_path: str):
        """Generate speech using edge-tts async API"""
        communicate = edge_tts.Communicate(
            text, 
            self.voice,
            rate=self.rate,
            volume=self.volume,
            pitch=self.pitch
        )
        await communicate.save(output_path)
    
    def _play_audio(self, audio_path: str):
        """Play audio file using system command"""
        import platform
        system = platform.system()
        
        if system == 'Darwin':  # macOS
            subprocess.run(['afplay', audio_path], capture_output=True)
        elif system == 'Linux':
            # Try different Linux audio players
            for player in ['aplay', 'paplay', 'ffplay']:
                if subprocess.run(['which', player], capture_output=True).returncode == 0:
                    subprocess.run([player, audio_path], capture_output=True)
                    break
        elif system == 'Windows':
            # Windows Media Player
            subprocess.run(['start', '', audio_path], shell=True, capture_output=True)
    
    def speak_async(self, text: str):
        """Speak text asynchronously"""
        thread = Thread(target=self.speak, args=(text,))
        thread.daemon = True
        thread.start()
    
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
    
    def set_voice(self, voice: str):
        """Set voice"""
        self.voice = voice
    
    def set_rate(self, rate: str):
        """Set speech rate (e.g., '+50%', '-25%')"""
        self.rate = rate
    
    def set_volume(self, volume: str):
        """Set volume (e.g., '+50%', '-25%')"""
        self.volume = volume
    
    def set_pitch(self, pitch: str):
        """Set pitch (e.g., '+50Hz', '-25Hz')"""
        self.pitch = pitch
    
    @staticmethod
    async def list_voices_async():
        """List available Edge TTS voices asynchronously"""
        voices = await edge_tts.list_voices()
        return voices
    
    @staticmethod
    def list_voices():
        """List available Edge TTS voices"""
        return asyncio.run(EdgeTTS.list_voices_async())


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
    
    if engine_type == 'none':
        return SilentTTS(config)
    elif engine_type == 'edge-tts' or engine_type == 'edge':
        return EdgeTTS(config)
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