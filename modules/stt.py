"""
Speech-to-Text module using Whisper
"""
import os
import time
import queue
import threading
import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
import webrtcvad
from typing import Optional, Callable
import logging

logger = logging.getLogger(__name__)


class WhisperSTT:
    """Speech-to-Text using OpenAI Whisper"""
    
    def __init__(self, config: dict):
        self.config = config
        self.model = None
        self.vad = None
        self.audio_queue = queue.Queue()
        self.recording = False
        self.setup()
        
    def setup(self):
        """Initialize Whisper model and VAD"""
        # Load Whisper model
        model_name = self.config['whisper']['model']
        if model_name == 'turbo':
            model_name = 'large-v3'  # Use large-v3 as turbo equivalent
        
        device = self.config['whisper'].get('device', 'auto')
        
        if device == 'auto':
            device = 'auto'  # faster-whisper handles device selection
        
        # Use int8 for Apple Silicon, float16 for CUDA
        compute_type = self.config['whisper'].get('compute_type', 'int8')
        
        logger.info(f"Loading Whisper model '{model_name}'...")
        self.model = WhisperModel(
            model_name, 
            device=device,
            compute_type=compute_type,
            download_root="./models"
        )
        logger.info("Whisper model loaded successfully")
        
        # Initialize VAD if enabled
        if self.config['vad']['enabled']:
            self.vad = webrtcvad.Vad(self.config['vad']['mode'])
            logger.info("Voice Activity Detection initialized")
    
    def audio_callback(self, indata, frames, time_info, status):
        """Callback for audio stream"""
        if status:
            logger.warning(f"Audio callback status: {status}")
        
        if self.recording:
            self.audio_queue.put(indata.copy())
    
    def detect_speech(self, audio_data: np.ndarray) -> bool:
        """Detect if audio contains speech using VAD"""
        if not self.vad or not self.config['vad']['enabled']:
            return True
        
        # Convert to 16-bit PCM
        audio_int16 = (audio_data * 32767).astype(np.int16)
        
        # VAD works with specific frame sizes (10, 20, or 30 ms)
        sample_rate = self.config['audio']['sample_rate']
        frame_duration_ms = 30
        frame_size = int(sample_rate * frame_duration_ms / 1000)
        
        # Process frames
        speech_frames = 0
        total_frames = 0
        
        for i in range(0, len(audio_int16) - frame_size, frame_size):
            frame = audio_int16[i:i + frame_size].tobytes()
            try:
                if self.vad.is_speech(frame, sample_rate):
                    speech_frames += 1
                total_frames += 1
            except:
                continue
        
        # Return True if enough frames contain speech
        if total_frames > 0:
            speech_ratio = speech_frames / total_frames
            return speech_ratio > 0.3
        
        return False
    
    def record_audio(self, duration: Optional[float] = None, 
                    use_vad: bool = True) -> np.ndarray:
        """Record audio from microphone"""
        sample_rate = self.config['audio']['sample_rate']
        channels = self.config['audio']['channels']
        device = self.config['audio']['input_device']
        
        if use_vad and self.config['vad']['enabled']:
            # VAD-based recording
            return self._record_with_vad()
        else:
            # Fixed duration recording
            if duration is None:
                duration = 5.0  # Default duration
            
            logger.info(f"Recording for {duration} seconds...")
            recording = sd.rec(
                int(duration * sample_rate),
                samplerate=sample_rate,
                channels=channels,
                device=device,
                dtype='float32'
            )
            sd.wait()
            return recording.flatten()
    
    def _record_with_vad(self) -> np.ndarray:
        """Record audio using Voice Activity Detection"""
        sample_rate = self.config['audio']['sample_rate']
        channels = self.config['audio']['channels']
        device = self.config['audio']['input_device']
        
        # Recording parameters
        chunk_duration = self.config['audio']['chunk_duration']
        speech_timeout = self.config['vad']['speech_timeout']
        min_speech_duration = self.config['vad']['min_speech_duration']
        
        # Start audio stream
        stream = sd.InputStream(
            callback=self.audio_callback,
            channels=channels,
            samplerate=sample_rate,
            device=device,
            blocksize=int(sample_rate * chunk_duration)
        )
        
        audio_chunks = []
        speech_detected = False
        silence_start = None
        speech_start = None
        
        with stream:
            self.recording = True
            logger.info("Listening... (speak now)")
            
            while True:
                try:
                    # Get audio chunk
                    chunk = self.audio_queue.get(timeout=0.1)
                    audio_chunks.append(chunk)
                    
                    # Check for speech
                    if self.detect_speech(chunk):
                        if not speech_detected:
                            speech_detected = True
                            speech_start = time.time()
                            logger.info("Speech detected")
                        silence_start = None
                    else:
                        if speech_detected and silence_start is None:
                            silence_start = time.time()
                    
                    # Check stopping conditions
                    if speech_detected and silence_start:
                        silence_duration = time.time() - silence_start
                        if silence_duration >= speech_timeout:
                            speech_duration = time.time() - speech_start
                            if speech_duration >= min_speech_duration:
                                logger.info("Speech ended")
                                break
                            else:
                                # Reset if speech was too short
                                speech_detected = False
                                silence_start = None
                                speech_start = None
                                audio_chunks = []
                
                except queue.Empty:
                    continue
                except KeyboardInterrupt:
                    break
        
        self.recording = False
        
        if audio_chunks:
            return np.concatenate(audio_chunks).flatten()
        return np.array([])
    
    def transcribe(self, audio: np.ndarray) -> str:
        """Transcribe audio to text"""
        if len(audio) == 0:
            return ""
        
        start_time = time.time()
        
        # Transcribe with faster-whisper
        segments, info = self.model.transcribe(
            audio,
            language=self.config['whisper']['language'],
            beam_size=5,
            vad_filter=True
        )
        
        # Combine all segments
        transcription = " ".join([segment.text for segment in segments]).strip()
        elapsed = time.time() - start_time
        
        logger.info(f"Transcription ({elapsed:.2f}s): {transcription}")
        return transcription
    
    def record_and_transcribe(self, duration: Optional[float] = None,
                             use_vad: bool = True) -> str:
        """Record audio and transcribe to text"""
        audio = self.record_audio(duration, use_vad)
        if len(audio) > 0:
            return self.transcribe(audio)
        return ""


class PushToTalkSTT(WhisperSTT):
    """Push-to-talk variant of Whisper STT"""
    
    def __init__(self, config: dict, key: str = 'space'):
        super().__init__(config)
        self.ptt_key = key
        self.is_recording = False
        
    def start_ptt_recording(self, callback: Callable[[str], None]):
        """Start push-to-talk recording with callback"""
        try:
            import keyboard
        except ImportError:
            logger.error("Keyboard module not available for push-to-talk")
            return
        
        def on_key_press():
            if not self.is_recording:
                self.is_recording = True
                logger.info(f"Push-to-talk: Recording started (holding {self.ptt_key})")
                # Start recording in background
                audio_chunks = []
                
                # Record while key is held
                sample_rate = self.config['audio']['sample_rate']
                stream = sd.InputStream(
                    samplerate=sample_rate,
                    channels=self.config['audio']['channels'],
                    device=self.config['audio']['input_device']
                )
                
                with stream:
                    while keyboard.is_pressed(self.ptt_key):
                        chunk, _ = stream.read(int(sample_rate * 0.1))
                        audio_chunks.append(chunk)
                
                # Process audio
                if audio_chunks:
                    audio = np.concatenate(audio_chunks).flatten()
                    text = self.transcribe(audio)
                    if text:
                        callback(text)
                
                self.is_recording = False
                logger.info("Push-to-talk: Recording stopped")
        
        # Register hotkey
        keyboard.on_press_key(self.ptt_key, lambda _: on_key_press())
        logger.info(f"Push-to-talk enabled. Hold '{self.ptt_key}' to record.")