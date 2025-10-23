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
# Start Ollama service (required for Ollama backend)
ollama serve

# Start AssistedVoice manually (recommended)
source venv/bin/activate
python web_assistant.py

# Development mode with auto-reload and template changes
FLASK_DEBUG=True python web_assistant.py

# Open browser to http://localhost:5001
```

**Note**: The `start.sh` script may reference an outdated filename. Use manual startup instead.

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

**Language Model** (`modules/llm.py` and `modules/llm_factory.py`)
- Factory pattern (`create_llm()`) supports multiple backends
- OllamaLLM and OptimizedOllamaLLM (with caching) for Ollama
- LMStudioLLM (`modules/llm_lmstudio.py`) for LM Studio OpenAI-compatible API
- BaseLLM (`modules/llm_base.py`) interface for extensibility
- ConversationManager for context management
- Automatic fallback to working models
- Performance metrics tracking (response time, tokens/second)
- Server type auto-detection

**Text-to-Speech** (`modules/tts.py`)
- Multiple engines: Edge TTS (neural voices), macOS (system voices), pyttsx3
- Factory pattern via create_tts_engine()
- Async support for Edge TTS

### API Endpoints

**Core**
- `GET /` - Main web interface
- `GET /config` - Get current configuration

**Models**
- `GET /api/models` - List available models (Ollama or LM Studio)
- `POST /api/models/switch` - Switch active LLM model
- `POST /api/whisper/switch` - Switch Whisper model

**Inference**
- `POST /transcribe` - Process audio to text (base64 audio → text)
- `POST /chat` - Send text message to LLM (with streaming via WebSocket)

**TTS**
- `POST /tts` - Generate speech from text
- `POST /api/tts/engine` - Switch TTS engine (edge-tts/macos/none)
- `POST /api/tts/voice` - Switch TTS voice
- `GET /api/tts/voices` - List available voices for current engine

### WebSocket Events

- `connect`/`disconnect` - Client connection management
- Real-time streaming of LLM responses

### Configuration

Main configuration in `config.yaml`:
- `server`: Backend server settings (type: ollama/lm-studio, host, port, timeout)
- `whisper`: Speech recognition settings (model, language, device, compute_type)
- `ollama`: Ollama-specific LLM settings (model, temperature, max_tokens, system_prompt)
- `tts`: Text-to-speech settings (engine: edge-tts/macos/none, voice, rate)
- `audio`: Recording settings (sample_rate, channels, silence_threshold)
- `vad`: Voice Activity Detection settings (enabled, mode, speech_timeout)
- `performance`: Optimization flags (cache_responses, response_streaming)

### Frontend

- **Static files**:
  - `static/app.js` - Main application logic with WebSocket, audio recording, model switching
  - `static/style-simple.css` - Modern glassmorphism UI with animations
  - `static/style.css` - Legacy styles (if needed)
- **Templates**: `templates/index.html` - Single-page web UI
- **Features**:
  - Push-to-talk recording with visual feedback (animated border, status updates)
  - Real-time model switching (LLM, Whisper, TTS engine/voice)
  - Performance metrics display (response time, first token, tokens/sec)
  - Advanced AI settings (temperature, max tokens, system prompt presets)
  - Message replay with TTS speaker buttons
  - Conversation persistence across page refreshes
  - Quick mute button for instant TTS toggle

## Development Notes

### Model Management
- **Whisper models**: Auto-download to `models/` directory on first use
- **Ollama models**: Must be pulled manually via `ollama pull <model>` before use
- **LM Studio models**: Configured in LM Studio app, accessible via API on port 1234
- **Model switching**: Automatic fallback if selected model fails (e.g., gpt-oss models → mistral)
- **Server switching**: Change `server.type` in config.yaml to switch between Ollama/LM Studio

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
- `5001`: Flask web server (AssistedVoice UI)
- `11434`: Ollama API server (default)
- `1234`: LM Studio API server (default)
- Change web port in `web_assistant.py:app.run()` if needed

## Key Implementation Details

### LLM Backend Flexibility
The app uses a factory pattern to support multiple LLM backends:
- Configure `server.type` in config.yaml as `ollama`, `lm-studio`, or `custom`
- Factory (`create_llm()`) instantiates appropriate class
- All backends implement `BaseLLM` interface for consistency
- OptimizedOllamaLLM adds response caching when `performance.cache_responses: true`

### Audio Processing Pipeline
1. Client records audio in browser (push-to-talk button)
2. Audio sent as base64 to `/transcribe` endpoint
3. WhisperSTT processes with selected model (tiny→turbo)
4. Transcribed text displayed and sent to LLM via `/chat`
5. LLM response streams back via WebSocket
6. Optional TTS playback via Edge TTS or macOS voices

### Template Auto-Reload
`app.config['TEMPLATES_AUTO_RELOAD'] = True` in web_assistant.py:39 enables automatic template reloading in development. Changes to `templates/index.html` appear on browser refresh without server restart.