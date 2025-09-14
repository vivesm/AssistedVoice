# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AssistedVoice is a local AI voice assistant that runs entirely on macOS, combining Whisper speech recognition with Ollama language models for private, offline AI conversations through a modern web interface.

## Commands

### Setup and Installation
```bash
# Install dependencies and set up virtual environment
./setup.sh

# Manual setup if needed
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Install Ollama (if not installed)
curl -fsSL https://ollama.com/install.sh | sh

# Pull Ollama models
ollama pull llama3.2:3b    # Fast, lightweight
ollama pull deepseek-r1:8b  # Better quality
ollama pull mistral:7b      # Good balance
```

### Running the Application
```bash
# Start Ollama service (required)
ollama serve

# Start AssistedVoice (activates venv automatically)
./start.sh

# Or manually
source venv/bin/activate
python web_assistant.py

# Development mode with auto-reload
FLASK_DEBUG=True python web_assistant.py
```

### Testing
```bash
# Run all tests
pytest tests/

# Run specific test categories
pytest tests/unit/
pytest tests/integration/

# Run with coverage
pytest --cov=modules tests/
```

## Architecture

### Core Components

**Web Server** (`web_assistant.py`)
- Flask application with SocketIO for real-time communication
- Handles audio processing, model switching, and TTS requests
- Template auto-reload enabled for development

**Speech Recognition** (`modules/stt.py`)
- WhisperSTT class using faster-whisper library
- Supports multiple model sizes (tiny to turbo)
- Automatic device detection (Metal/CUDA/CPU)

**Language Model** (`modules/llm.py`)
- OllamaLLM class with streaming support
- ConversationManager for context management
- Automatic fallback to working models
- Performance metrics tracking (response time, tokens/second)

**Text-to-Speech** (`modules/tts.py`)
- Multiple engines: Edge TTS (neural voices), macOS (system voices), pyttsx3
- Factory pattern via create_tts_engine()
- Async support for Edge TTS

### API Endpoints

- `GET /` - Main web interface
- `GET /config` - Get current configuration
- `GET /api/models` - List available Ollama models
- `POST /api/models/switch` - Switch active model
- `POST /api/whisper/switch` - Switch Whisper model
- `POST /transcribe` - Process audio to text
- `POST /chat` - Send text message to LLM
- `POST /tts` - Generate speech from text
- `POST /api/tts/engine` - Switch TTS engine
- `POST /api/tts/voice` - Switch TTS voice

### WebSocket Events

- `connect`/`disconnect` - Client connection management
- Real-time streaming of LLM responses

### Configuration

Main configuration in `config.yaml`:
- `whisper`: Speech recognition settings (model, language, device)
- `ollama`: LLM settings (model, temperature, system prompt)
- `tts`: Text-to-speech settings (engine, voice, rate)
- `audio`: Recording settings (sample rate, VAD)

### Frontend

- **Static files**: `static/app.js`, `static/style_simple.css`
- **Templates**: `templates/index.html`
- Features: Push-to-talk, model selection, performance metrics display
- Visual feedback: Recording animation, typing indicators, loading states

## Development Notes

### Model Management
- Models stored in `models/` directory
- Whisper models auto-download on first use
- Ollama models must be pulled manually via `ollama pull`

### Error Handling
- Automatic fallback when selected Ollama model fails
- Graceful degradation for TTS engine failures
- Comprehensive logging to `logs/assistant.log`

### Performance Considerations
- Streaming responses for better UX
- WebSocket for real-time communication
- Response caching configurable in config.yaml
- Metal Performance Shaders acceleration on Apple Silicon

### Testing Structure
- Unit tests: `tests/unit/` - Component testing
- Integration tests: `tests/integration/` - End-to-end flows
- Mock fixtures for external dependencies

## Port Usage
- `5001`: Default web server port
- Change in `web_assistant.py:app.run()` if needed