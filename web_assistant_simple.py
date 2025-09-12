#!/usr/bin/env python3
"""
AssistedVoice Simple Push-to-Talk Backend
"""
import os
import sys
import yaml
import json
import base64
import tempfile
from pathlib import Path
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import logging

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

def initialize_components():
    """Initialize AI components"""
    global stt, llm, tts, config
    
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
    
    return True

@app.route('/')
def index():
    """Serve the simple interface"""
    return render_template('index_simple.html')

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
    emit('connected', {'status': 'Connected to AssistedVoice'})

@socketio.on('disconnect')
def handle_disconnect():
    """Handle client disconnection"""
    logger.info(f"Client disconnected: {request.sid}")

@socketio.on('process_audio')
def handle_audio(data):
    """Process audio from client (PTT mode)"""
    try:
        # Get TTS preference from client
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
        
        segments, info = stt.model.transcribe(tmp_path, language=config['whisper']['language'])
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
        for chunk in llm.generate(transcription, stream=True):
            response_text += chunk
            emit('response_chunk', {'text': chunk})
        
        # Complete response
        emit('response_complete', {'text': response_text})
        
        # Generate TTS if enabled by user
        if enable_tts and config['tts']['engine'] != 'none':
            emit('status', {'message': 'Speaking...', 'type': 'speaking'})
            # Use the TTS engine we initialized
            if hasattr(tts, 'speak_async'):
                tts.speak_async(response_text)
            else:
                tts.speak(response_text)
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
        for chunk in llm.generate(text, stream=True):
            response_text += chunk
            emit('response_chunk', {'text': chunk})
        
        # Complete response
        emit('response_complete', {'text': response_text})
        
        # Generate TTS if enabled by user
        if enable_tts and config['tts']['engine'] != 'none':
            emit('status', {'message': 'Speaking...', 'type': 'speaking'})
            # Use the TTS engine we initialized
            if hasattr(tts, 'speak_async'):
                tts.speak_async(response_text)
            else:
                tts.speak(response_text)
            emit('tts_complete', {})
        
        emit('status', {'message': 'Ready', 'type': 'ready'})
        
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
        print("   AssistedVoice - Push to Talk")
        print("="*60)
        print("\n✓ All components initialized")
        print(f"✓ Model: {config['ollama']['model']}")
        print(f"✓ Whisper: {config['whisper']['model']}")
        print(f"✓ TTS: {config['tts']['engine']}")
        print("\n" + "="*60)
        print("\n🌐 Open your browser to: http://localhost:5001")
        print("\nPress Ctrl+C to stop the server")
        print("="*60 + "\n")
        
        # Run server
        socketio.run(app, debug=False, host='0.0.0.0', port=5001, allow_unsafe_werkzeug=True)
    else:
        print("Failed to initialize components")
        sys.exit(1)