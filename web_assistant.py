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

# IMPORTANT: Template caching behavior
# In development (debug=True): Templates auto-reload when changed
# In production (debug=False): Templates are cached - restart server after changes
# To force template reload without restart, set TEMPLATES_AUTO_RELOAD=True
app.config['TEMPLATES_AUTO_RELOAD'] = True  # Always reload templates when changed

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
    return render_template('index.html')

@app.route('/config')
def get_config():
    """Get configuration info"""
    return jsonify({
        'model': config['ollama']['model'],
        'whisper_model': config['whisper']['model'],
        'tts_engine': config['tts']['engine'],
        'tts_voice': config['tts'].get('voice', 'default')
    })

@app.route('/api/models')
def get_models():
    """Get available Ollama models"""
    try:
        models = llm.client.list()
        # Filter out known problematic models but add a note about them
        model_list = []
        for model in models['models']:
            model_name = model.model
            # Keep gpt-oss models but mark them
            model_list.append(model_name)
        
        return jsonify({
            'models': model_list,
            'current': config['ollama']['model']
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/tts-engines')
def get_tts_engines():
    """Get available TTS engines"""
    engines = [
        {'value': 'edge-tts', 'label': 'Neural (Realistic)'},
        {'value': 'macos', 'label': 'Classic (System)'},
        {'value': 'none', 'label': 'Disabled'}
    ]
    return jsonify({
        'engines': engines,
        'current': config['tts']['engine']
    })

@app.route('/api/whisper-models')
def get_whisper_models():
    """Get available Whisper models"""
    models = [
        {'value': 'tiny', 'label': 'Tiny (Fastest)'},
        {'value': 'base', 'label': 'Base'},
        {'value': 'small', 'label': 'Small'},
        {'value': 'medium', 'label': 'Medium'},
        {'value': 'large', 'label': 'Large'},
        {'value': 'turbo', 'label': 'Turbo (Optimized)'}
    ]
    return jsonify({
        'models': models,
        'current': config['whisper']['model']
    })

@app.route('/api/voices/<engine>')
def get_voices(engine):
    """Get voices for specific TTS engine"""
    try:
        if engine == 'edge-tts':
            from modules.tts import EdgeTTS
            voices = EdgeTTS.list_voices()
            # Filter for English voices and format
            english_voices = []
            for voice in voices:
                if voice['Locale'].startswith('en-'):
                    english_voices.append({
                        'value': voice['ShortName'],
                        'label': f"{voice['ShortName']} ({voice['Gender']})"
                    })
            return jsonify({
                'voices': english_voices[:20],  # Limit to top 20
                'current': config['tts'].get('edge_voice', 'en-US-JennyNeural')
            })
        elif engine == 'macos':
            from modules.tts import MacOSTTS
            import platform
            if platform.system() == 'Darwin':
                voices = MacOSTTS.list_voices()
                voice_list = [{'value': v, 'label': v} for v in voices]
                return jsonify({
                    'voices': voice_list,
                    'current': config['tts'].get('voice', 'Samantha')
                })
            else:
                return jsonify({'voices': [], 'current': None})
        else:
            return jsonify({'voices': [], 'current': None})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
            emit('response_chunk', {'text': chunk, 'model': llm.model})
        
        # Complete response with model info
        emit('response_complete', {'text': response_text, 'model': llm.model})
        
        # Generate TTS if enabled by user
        if enable_tts and config['tts']['engine'] != 'none':
            emit('status', {'message': 'Speaking...', 'type': 'speaking'})
            
            # Try to generate audio as base64 for browser playback
            if hasattr(tts, 'generate_audio_base64'):
                logger.info("Generating audio as base64...")
                audio_data = tts.generate_audio_base64(response_text)
                if audio_data:
                    logger.info(f"Audio data generated, length: {len(audio_data)}")
                    emit('audio_data', {'audio': audio_data})
                else:
                    logger.warning("Failed to generate audio data")
                    # Fallback to server-side playback
                    if hasattr(tts, 'speak_async'):
                        tts.speak_async(response_text)
                    else:
                        tts.speak(response_text)
            else:
                # Use server-side playback for engines without base64 support
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
            emit('response_chunk', {'text': chunk, 'model': llm.model})
        
        # Complete response with model info
        emit('response_complete', {'text': response_text, 'model': llm.model})
        
        # Generate TTS if enabled by user
        if enable_tts and config['tts']['engine'] != 'none':
            emit('status', {'message': 'Speaking...', 'type': 'speaking'})
            
            # Try to generate audio as base64 for browser playback
            if hasattr(tts, 'generate_audio_base64'):
                logger.info("Generating audio as base64...")
                audio_data = tts.generate_audio_base64(response_text)
                if audio_data:
                    logger.info(f"Audio data generated, length: {len(audio_data)}")
                    emit('audio_data', {'audio': audio_data})
                else:
                    logger.warning("Failed to generate audio data")
                    # Fallback to server-side playback
                    if hasattr(tts, 'speak_async'):
                        tts.speak_async(response_text)
                    else:
                        tts.speak(response_text)
            else:
                # Use server-side playback for engines without base64 support
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

@socketio.on('change_model')
def handle_change_model(data):
    """Change the LLM model"""
    global llm, config
    try:
        new_model = data.get('model')
        if new_model:
            # Note: gpt-oss template issues have been fixed
            logger.info(f"Switching to model: {new_model}")
            
            # Save old model in case we need to revert
            old_model = config['ollama']['model']
            old_llm = llm
            
            try:
                # Update config
                config['ollama']['model'] = new_model
                # Reinitialize LLM with new model
                llm = OllamaLLM(config)
                # Get the actual model name that was loaded (might be different due to version tags)
                actual_model = llm.model
                emit('model_changed', {'model': actual_model})
                logger.info(f"Changed model to: {actual_model}")
            except Exception as model_error:
                # Revert to old model if new one fails
                config['ollama']['model'] = old_model
                llm = old_llm
                logger.error(f"Failed to switch to {new_model}, keeping {old_model}: {model_error}")
                emit('error', {'message': f"Failed to switch model: {str(model_error)}. Keeping current model."})
    except Exception as e:
        logger.error(f"Error changing model: {e}")
        emit('error', {'message': str(e)})

@socketio.on('change_tts')
def handle_change_tts(data):
    """Change TTS engine or voice"""
    global tts, config
    try:
        engine = data.get('engine')
        voice = data.get('voice')
        
        if engine:
            config['tts']['engine'] = engine
            
        if voice:
            if engine == 'edge-tts':
                config['tts']['edge_voice'] = voice
            elif engine == 'macos':
                config['tts']['voice'] = voice
        
        # Reinitialize TTS with new settings
        tts = create_tts_engine(config)
        
        # Update voice on existing engine if possible
        if hasattr(tts, 'set_voice') and voice:
            tts.set_voice(voice)
            
        emit('tts_changed', {'engine': engine, 'voice': voice})
        logger.info(f"Changed TTS to engine: {engine}, voice: {voice}")
    except Exception as e:
        logger.error(f"Error changing TTS: {e}")
        emit('error', {'message': str(e)})

@socketio.on('change_whisper_model')
def handle_change_whisper_model(data):
    """Change Whisper STT model"""
    global stt, config
    try:
        new_model = data.get('model')
        if new_model and new_model in ['tiny', 'base', 'small', 'medium', 'large', 'turbo']:
            emit('status', {'message': f'Loading Whisper {new_model} model...', 'type': 'loading'})
            emit('loading_progress', {'message': 'Initializing model loader...', 'progress': 10})
            
            # Update config
            old_model = config['whisper']['model']
            config['whisper']['model'] = new_model
            
            try:
                emit('loading_progress', {'message': 'Downloading model if needed...', 'progress': 30})
                # Reinitialize STT with new model
                # This may take 5-10 seconds for larger models
                stt = WhisperSTT(config)
                emit('loading_progress', {'message': 'Model loaded successfully!', 'progress': 90})
                emit('whisper_model_changed', {'model': new_model})
                emit('status', {'message': 'Ready', 'type': 'ready'})
                logger.info(f"Changed Whisper model to: {new_model}")
            except Exception as model_error:
                # Revert to old model if new one fails
                config['whisper']['model'] = old_model
                stt = WhisperSTT(config)
                logger.error(f"Failed to switch to Whisper {new_model}, reverting to {old_model}: {model_error}")
                emit('error', {'message': f"Failed to load Whisper {new_model}. Keeping {old_model}."})
                emit('status', {'message': 'Ready', 'type': 'ready'})
    except Exception as e:
        logger.error(f"Error changing Whisper model: {e}")
        emit('error', {'message': str(e)})
        emit('status', {'message': 'Ready', 'type': 'ready'})

@socketio.on('replay_text')
def handle_replay_text(data):
    """Replay text using TTS (same as normal response TTS)"""
    logger.info(f"🔊 REPLAY_TEXT EVENT RECEIVED: {data}")
    try:
        text = data.get('text', '').strip()
        enable_tts = data.get('enable_tts', True)
        
        if not text:
            return
            
        # Generate TTS if enabled by user (same logic as process_text)
        if enable_tts and config['tts']['engine'] != 'none':
            emit('status', {'message': 'Speaking...', 'type': 'speaking'})
            
            # Try to generate audio as base64 for browser playback
            if hasattr(tts, 'generate_audio_base64'):
                audio_data = tts.generate_audio_base64(text)
                if audio_data:
                    emit('audio_data', {'audio': audio_data})
                else:
                    # Fallback to server-side playback
                    if hasattr(tts, 'speak_async'):
                        tts.speak_async(text)
                    else:
                        tts.speak(text)
            else:
                # Use server-side playback for engines without base64 support
                if hasattr(tts, 'speak_async'):
                    tts.speak_async(text)
                else:
                    tts.speak(text)
            
            emit('tts_complete', {})
        
        emit('status', {'message': 'Ready', 'type': 'ready'})
        
    except Exception as e:
        logger.error(f"Error replaying text: {e}")
        emit('error', {'message': str(e)})
        emit('status', {'message': 'Ready', 'type': 'ready'})

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
        # Set debug=True for development (auto-reloads templates and code)
        # Set debug=False for production (better performance, caches templates)
        debug_mode = os.environ.get('FLASK_DEBUG', 'True').lower() == 'true'
        socketio.run(app, debug=debug_mode, host='0.0.0.0', port=5001, allow_unsafe_werkzeug=True)
    else:
        print("Failed to initialize components")
        sys.exit(1)