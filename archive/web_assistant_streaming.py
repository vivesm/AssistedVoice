#!/usr/bin/env python3
"""
AssistedVoice Streaming Backend with Multiple Modes
Supports: Continuous, Smart Pause, and Push-to-Talk
"""
import os
import sys
import yaml
import json
import base64
import numpy as np
import tempfile
import time
import threading
from pathlib import Path
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import logging
from collections import deque
import webrtcvad

# Add modules to path
sys.path.insert(0, str(Path(__file__).parent))

from modules.stt import WhisperSTT
from modules.llm import OllamaLLM
from modules.tts import create_tts_engine

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Global components
stt = None
llm = None
tts = None
config = None
vad = None

# Session management
class StreamingSession:
    def __init__(self, sid, mode='ptt'):
        self.sid = sid
        self.mode = mode
        self.audio_buffer = deque(maxlen=200)  # Store more chunks for better processing
        self.transcription_buffer = ""
        self.last_speech_time = time.time()
        self.is_speaking = False
        self.current_audio_file = None
        self.processing_lock = threading.Lock()
        self.continuous_transcriber = None
        self.response_in_progress = False
        self.accumulated_audio = b''  # For accumulating complete WebM data
        
sessions = {}

def initialize_components():
    """Initialize AI components"""
    global stt, llm, tts, config, vad
    
    # Load configuration
    with open('config.yaml', 'r') as f:
        config = yaml.safe_load(f)
    
    logger.info("Initializing components...")
    
    # Initialize STT
    stt = WhisperSTT(config)
    logger.info("✓ Speech-to-Text initialized")
    
    # Initialize LLM
    llm = OllamaLLM(config)
    logger.info("✓ Language Model initialized")
    
    # Initialize TTS
    tts = create_tts_engine(config)
    logger.info("✓ Text-to-Speech initialized")
    
    # Initialize VAD for smart pause detection
    vad = webrtcvad.Vad(2)  # Aggressiveness level 2
    logger.info("✓ Voice Activity Detection initialized")
    
    return True

@app.route('/')
def index():
    """Serve the streaming interface"""
    return render_template('index_streaming.html')

@app.route('/config')
def get_config():
    """Get configuration info"""
    return jsonify({
        'model': config['ollama']['model'],
        'whisper_model': config['whisper']['model'],
        'tts_engine': config['tts']['engine'],
        'tts_voice': config['tts'].get('voice', 'default')
    })

@socketio.on('connect')
def handle_connect():
    """Handle client connection"""
    logger.info(f"Client connected: {request.sid}")
    sessions[request.sid] = StreamingSession(request.sid)
    emit('connected', {'status': 'Connected to AssistedVoice'})

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    logger.info(f"Client disconnected: {request.sid}")
    if request.sid in sessions:
        session = sessions[request.sid]
        # Clean up any resources
        if session.current_audio_file and os.path.exists(session.current_audio_file):
            os.unlink(session.current_audio_file)
        del sessions[request.sid]

# === CONTINUOUS MODE ===
@socketio.on('start_continuous_mode')
def handle_start_continuous(data):
    """Start continuous streaming mode"""
    session = sessions.get(request.sid)
    if not session:
        return
    
    session.mode = 'continuous'
    session.audio_buffer.clear()
    session.transcription_buffer = ""
    session.accumulated_audio = b''  # Reset accumulated audio
    
    logger.info(f"Started continuous mode for {request.sid}")
    emit('status', {'message': 'Continuous mode active', 'type': 'listening'})
    
    # Start continuous transcription thread
    session.continuous_transcriber = threading.Thread(
        target=continuous_transcription_worker,
        args=(session,)
    )
    session.continuous_transcriber.daemon = True
    session.continuous_transcriber.start()

@socketio.on('audio_stream_continuous')
def handle_continuous_audio(data):
    """Handle continuous audio streaming"""
    session = sessions.get(request.sid)
    if not session or session.mode != 'continuous':
        return
    
    try:
        # Decode audio chunk
        audio_data = base64.b64decode(data['audio'].split(',')[1] if ',' in data['audio'] else data['audio'])
        
        # Accumulate complete audio data
        session.accumulated_audio += audio_data
        
        # Add to buffer for processing
        session.audio_buffer.append({
            'data': audio_data,
            'timestamp': data.get('timestamp', time.time())
        })
        
        # Don't process immediately - let the worker thread handle it
        # This avoids processing incomplete audio chunks
            
    except Exception as e:
        logger.error(f"Error in continuous audio: {e}")

def process_continuous_audio(session):
    """Process audio for continuous mode"""
    with session.processing_lock:
        try:
            # Need at least 20 chunks (2 seconds) for meaningful transcription
            if len(session.audio_buffer) < 20:
                return
            
            # Combine recent audio chunks
            recent_chunks = list(session.audio_buffer)[-30:]  # Last 3 seconds
            if not recent_chunks:
                return
                
            combined_audio = b''.join([chunk['data'] for chunk in recent_chunks])
            
            # Skip if audio is too small (likely invalid)
            if len(combined_audio) < 5000:  # Need more data for WebM
                return
            
            # Save to temporary file
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp_file:
                tmp_file.write(combined_audio)
                tmp_path = tmp_file.name
            
            try:
                # Transcribe WITHOUT VAD filter for continuous mode
                segments, info = stt.model.transcribe(
                    tmp_path, 
                    language=config['whisper']['language'],
                    vad_filter=False,  # Don't filter in continuous mode
                    beam_size=1,  # Faster for real-time
                    without_timestamps=True,  # Faster processing
                    initial_prompt="This is a conversation. "  # Help with context
                )
                
                transcription = " ".join([segment.text for segment in segments]).strip()
            except Exception as e:
                logger.debug(f"Transcription error (expected for small chunks): {e}")
                transcription = ""
            finally:
                # Clean up
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            
            if transcription and transcription != session.transcription_buffer:
                # New transcription detected
                new_text = transcription[len(session.transcription_buffer):] if session.transcription_buffer else transcription
                
                if new_text.strip():
                    # Send partial transcription
                    socketio.emit('partial_transcription', 
                                {'text': transcription}, 
                                room=session.sid)
                    
                    # Check if we have a complete phrase to respond to
                    if should_generate_response(new_text):
                        generate_streaming_response(session, new_text)
                    
                    session.transcription_buffer = transcription
                    
        except Exception as e:
            logger.error(f"Error processing continuous audio: {e}")

def should_generate_response(text):
    """Determine if text warrants a response"""
    # Simple heuristic: respond to questions or complete sentences
    text = text.strip().lower()
    return (
        '?' in text or
        text.endswith('.') or
        len(text.split()) > 5 or
        any(q in text for q in ['what', 'how', 'why', 'when', 'where', 'who'])
    )

def continuous_transcription_worker(session):
    """Background worker for continuous transcription"""
    while session.mode == 'continuous':
        time.sleep(1.0)  # Process every second for better audio chunks
        if len(session.audio_buffer) >= 20:  # Need enough data
            process_continuous_audio(session)

@socketio.on('stop_continuous_mode')
def handle_stop_continuous(data=None):
    """Stop continuous mode"""
    session = sessions.get(request.sid)
    if session:
        session.mode = 'ptt'
        session.audio_buffer.clear()
        logger.info(f"Stopped continuous mode for {request.sid}")

# === SMART PAUSE MODE ===
@socketio.on('start_smart_mode')
def handle_start_smart(data):
    """Start smart pause mode"""
    session = sessions.get(request.sid)
    if not session:
        return
    
    session.mode = 'smart'
    session.audio_buffer.clear()
    session.transcription_buffer = ""
    session.last_speech_time = time.time()
    session.accumulated_audio = b''  # Reset accumulated audio
    
    settings = data.get('settings', {})
    session.pause_duration = settings.get('pauseDuration', 1500) / 1000.0
    
    logger.info(f"Started smart mode for {request.sid}")
    emit('status', {'message': 'Smart pause mode active', 'type': 'listening'})

@socketio.on('audio_stream_smart')
def handle_smart_audio(data):
    """Handle smart pause audio streaming"""
    session = sessions.get(request.sid)
    if not session or session.mode != 'smart':
        return
    
    try:
        # Decode audio chunk
        audio_data = base64.b64decode(data['audio'].split(',')[1] if ',' in data['audio'] else data['audio'])
        
        # Accumulate audio
        session.accumulated_audio += audio_data
        
        # Add to buffer
        session.audio_buffer.append({
            'data': audio_data,
            'timestamp': data.get('timestamp', time.time())
        })
        
        # Simple speech detection based on audio size and activity
        is_speech = len(audio_data) > 500  # Simplified detection
        
        if is_speech:
            session.last_speech_time = time.time()
            if not session.is_speaking:
                session.is_speaking = True
                socketio.emit('vad_speech_start', room=session.sid)
        else:
            # Check for pause
            silence_duration = time.time() - session.last_speech_time
            
            if session.is_speaking and silence_duration > session.pause_duration:
                # Pause detected, process buffered audio
                session.is_speaking = False
                socketio.emit('vad_speech_end', room=session.sid)
                process_smart_pause_audio(session)
                
    except Exception as e:
        logger.error(f"Error in smart audio: {e}")

def detect_speech_in_chunk(audio_data):
    """Simple VAD check on audio chunk"""
    try:
        # For WebM, we'd need to decode first
        # For now, return True to process everything
        # In production, decode WebM to PCM first
        return len(audio_data) > 1000  # Simple size check
    except:
        return False

def process_smart_pause_audio(session):
    """Process audio after pause detection"""
    with session.processing_lock:
        if not session.accumulated_audio or len(session.accumulated_audio) < 5000:
            return
        
        try:
            # Use accumulated audio for complete WebM
            # Save to temporary file
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp_file:
                tmp_file.write(session.accumulated_audio)
                tmp_path = tmp_file.name
            
            # Transcribe without aggressive VAD
            segments, info = stt.model.transcribe(
                tmp_path,
                language=config['whisper']['language'],
                vad_filter=False,  # Don't filter for smart mode
                without_timestamps=True  # Faster processing
            )
            
            transcription = " ".join([segment.text for segment in segments]).strip()
            
            # Clean up
            os.unlink(tmp_path)
            
            if transcription:
                # Send final transcription
                socketio.emit('transcription', 
                            {'text': transcription}, 
                            room=session.sid)
                
                # Generate response
                generate_streaming_response(session, transcription)
            
            # Clear buffer for next utterance
            session.audio_buffer.clear()
            session.transcription_buffer = ""
            session.accumulated_audio = b''  # Reset accumulated audio
            
        except Exception as e:
            logger.error(f"Error processing smart pause audio: {e}")

@socketio.on('stop_smart_mode')
def handle_stop_smart(data=None):
    """Stop smart mode"""
    session = sessions.get(request.sid)
    if session:
        session.mode = 'ptt'
        session.audio_buffer.clear()
        logger.info(f"Stopped smart mode for {request.sid}")

# === PUSH-TO-TALK MODE (existing) ===
@socketio.on('process_audio')
def handle_audio(data):
    """Process audio from client (PTT mode)"""
    session = sessions.get(request.sid)
    if not session:
        return
    
    try:
        emit('status', {'message': 'Processing audio...', 'type': 'processing'})
        
        # Decode base64 audio
        audio_data = base64.b64decode(data['audio'].split(',')[1] if ',' in data['audio'] else data['audio'])
        
        # Save to temporary file
        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as tmp_file:
            tmp_file.write(audio_data)
            tmp_path = tmp_file.name
        
        # Transcribe
        emit('status', {'message': 'Transcribing...', 'type': 'transcribing'})
        
        segments, info = stt.model.transcribe(tmp_path, language=config['whisper']['language'])
        transcription = " ".join([segment.text for segment in segments]).strip()
        
        if not transcription:
            emit('error', {'message': 'No speech detected'})
            os.unlink(tmp_path)
            return
        
        # Emit transcription
        emit('transcription', {'text': transcription})
        
        # Generate response
        generate_streaming_response(session, transcription)
        
        # Clean up
        os.unlink(tmp_path)
        
    except Exception as e:
        logger.error(f"Error processing audio: {e}")
        emit('error', {'message': str(e)})

# === SHARED FUNCTIONS ===
def generate_streaming_response(session, text):
    """Generate and stream LLM response"""
    if session.response_in_progress:
        return  # Avoid overlapping responses
    
    session.response_in_progress = True
    
    try:
        socketio.emit('status', 
                     {'message': 'Generating response...', 'type': 'generating'},
                     room=session.sid)
        
        response_text = ""
        for chunk in llm.generate(text, stream=True):
            response_text += chunk
            socketio.emit('response_chunk', {'text': chunk}, room=session.sid)
        
        # Complete response
        socketio.emit('response_complete', {'text': response_text}, room=session.sid)
        
        # Generate TTS if enabled
        if config['tts']['engine'] != 'none':
            socketio.emit('status', 
                         {'message': 'Speaking...', 'type': 'speaking'},
                         room=session.sid)
            
            if config['tts']['engine'] == 'macos':
                import subprocess
                voice = config['tts'].get('voice', 'Samantha')
                subprocess.run(['say', '-v', voice, response_text])
                socketio.emit('tts_complete', {}, room=session.sid)
        
        socketio.emit('status', {'message': 'Ready', 'type': 'ready'}, room=session.sid)
        
    except Exception as e:
        logger.error(f"Error generating response: {e}")
        socketio.emit('error', {'message': str(e)}, room=session.sid)
    finally:
        session.response_in_progress = False

@socketio.on('process_text')
def handle_text(data):
    """Process text input from client"""
    session = sessions.get(request.sid)
    if not session:
        return
    
    try:
        text = data.get('text', '').strip()
        
        if not text:
            return
        
        # Generate response
        generate_streaming_response(session, text)
        
    except Exception as e:
        logger.error(f"Error processing text: {e}")
        emit('error', {'message': str(e)})

@socketio.on('clear_conversation')
def handle_clear(data=None):
    """Clear conversation history"""
    llm.clear_conversation()
    emit('conversation_cleared', {})

if __name__ == '__main__':
    # Initialize components
    if initialize_components():
        print("\n" + "="*60)
        print("   AssistedVoice Streaming Interface")
        print("="*60)
        print("\n✓ All components initialized")
        print(f"✓ Model: {config['ollama']['model']}")
        print(f"✓ Whisper: {config['whisper']['model']}")
        print(f"✓ TTS: {config['tts']['engine']}")
        print("\n" + "="*60)
        print("\n🌐 Open your browser to: http://localhost:5001")
        print("\nModes available:")
        print("  • Continuous: Real-time streaming")
        print("  • Smart Pause: Natural conversation")
        print("  • Push-to-Talk: Manual control")
        print("\nPress Ctrl+C to stop the server")
        print("="*60 + "\n")
        
        # Run server
        socketio.run(app, debug=False, host='0.0.0.0', port=5001, allow_unsafe_werkzeug=True)
    else:
        print("Failed to initialize components")
        sys.exit(1)