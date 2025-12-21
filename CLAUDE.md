# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AssistedVoice is an intelligent AI bridge and execution engine that runs on macOS, providing high-performance LLM orchestration, multimodal vision handling, and MCP tool integration through a modern web interface and Signal bot integration.

**Architecture**: Modern async FastAPI backend with Socket.IO for real-time communication. It features a modular service layer with 7 integrated MCP tools (Docker-based), vision-aware model routing, SQLite persistence for conversation history, and optimized caching.

## Distributed Setup (New)

The system is designed to run in a distributed manner:
- **Backend (`sagan`)**: Hosting Ollama, Whisper, and the core `AssistedVoice` API (`web_assistant.py`).
- **Client (`atom`)**: Running the `SignalBot` (`run_bot.py`) or other lightweight clients.

**Accessing Backend on Sagan**:
- The backend API runs on `http://sagan.local:5001`.
- Ensure SSH access to `sagan` is configured if you need to manage the backend directly.
- The `SignalBot` on `atom` connects to this remote backend for STT and LLM services via `config.yaml`.

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
ollama pull qwen2-vl:latest # Recommended for vision

# Pull MCP images (Docker Desktop required)
docker pull mcp/brave-search
docker pull mcp/context7
docker pull mcp/playwright
docker pull mcp/docker
docker pull mcp/desktop-commander
docker pull mcp/memory
docker pull mcp/sequential-thinking
```

### Running the Application
```bash
# 1. (Optional) Create .env file for configuration
cp .env.example .env
# Edit .env to set SECRET_KEY, CORS_ALLOWED_ORIGINS, etc.

# 2. Start Ollama service (required for Ollama backend)
ollama serve

# 3. Start AssistedVoice manually (recommended)
source venv/bin/activate
python web_assistant.py

# Development mode with auto-reload (default)
# Auto-reload is enabled by default when FLASK_DEBUG=True (in .env)
python web_assistant.py

# Or use uvicorn directly:
uvicorn web_assistant:socket_app --reload --port 5001

# Open browser to:
# - Main UI: http://localhost:5001
# - API Docs (Swagger): http://localhost:5001/docs
# - API Docs (ReDoc): http://localhost:5001/redoc
```

**Note**: The server runs with **uvicorn** (ASGI) with automatic code reloading enabled in development mode.

### Testing
```bash
# Run all tests
pytest tests/

# Run specific functional logic tests
PYTHONPATH=. ./venv/bin/python3 tests/test_mcp_logic.py
pytest tests/unit/test_database_service.py

# Run with coverage
pytest --cov=modules tests/
```

## Architecture

### Core Components

**Web Server** (`web_assistant.py`)
- FastAPI application with async/await architecture
- Socket.IO (python-socketio[asyncio]) for async real-time communication
- Uvicorn ASGI server with auto-reload in development
- Automatic OpenAPI/Swagger documentation at `/docs` and `/redoc`
- Lifespan context manager for clean startup/shutdown
- Modular routers: `routers/api.py` (REST), `routers/pages.py` (HTML), `routers/websocket.py` (Socket.IO)
- Service layer: `services/chat_service.py`, `services/audio_service.py`, `services/model_service.py`
- Pydantic models in `models/schemas.py` for type-safe validation

**Speech Recognition** (`modules/stt.py`)
- WhisperSTT class using faster-whisper library
- Supports multiple model sizes (tiny to turbo)
- Automatic device detection (Metal/CUDA/CPU)

**Language Model** (`modules/llm.py` and `modules/llm_factory.py`)
- Factory pattern (`create_llm()`) supports Ollama, OpenAILLM, GeminiLLM, and NullLLM.
- All backends implement `BaseLLM` interface for multimodal (`images`) support.
- OptimizedOllamaLLM (multi-core optimized) with response caching.
- Vision-aware model names (automatic detection of vision capabilities).
- Performance metrics tracking (response time, tokens/second).

**MCP Tools Layer** (`services/mcp_service.py` and `services/chat_service.py`)
- Integration with 7 Docker-based MCP servers:
  - `search` (Brave Search), `docs` (Context7), `browse` (Playwright)
  - `docker` (Local Docker), `desktop` (Desktop Commander)
  - `memory` (Knowledge Graph), `thinking` (Sequential Thinking)
- Intent detection via regex patterns and prefix commands.
- Automated prompt augmentation with tool results.

**Database Layer** (`services/database_service.py`)
- SQLite-backed conversation persistence.
- Automatic session management and message retrieval.

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

**Connection**
- `connect` - Client connection established
- `disconnect` - Client disconnected

**Audio & Chat**
- `process_audio` - Process audio from microphone (base64 audio data)
- `process_text` - Process text message to LLM
- Real-time streaming of LLM responses via chunks

**Model Management**
- `change_model` - Switch active LLM model
- `change_whisper_model` - Switch Whisper speech recognition model
- `change_tts` - Switch TTS engine and voice

**AI Settings** (real-time updates)
- `update_temperature` - Adjust LLM temperature (0.0-1.0)
- `update_max_tokens` - Set max response tokens (50-2000)
- `update_system_prompt` - Update system prompt with custom text or templates

**Other**
- `clear_conversation` - Clear chat history
- `replay_text` - Replay message with TTS

### Configuration

**Environment Variables** (`.env` file - optional but recommended)
- `SECRET_KEY` - Flask session secret key (generate with: `python3 -c "import secrets; print(secrets.token_hex(32))"`)
- `CORS_ALLOWED_ORIGINS` - Allowed CORS origins (default: `*` for development, set specific origins for production)
- `FLASK_DEBUG` - Enable debug mode (default: `True`)
- `HOST` - Server host binding (default: `0.0.0.0`)
- `PORT` - Server port (default: `5001`)

Create `.env` from `.env.example`: `cp .env.example .env`

**Application Settings** (`config.yaml`)
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
- `5001`: Uvicorn ASGI server (AssistedVoice UI + API docs)
- `11434`: Ollama API server (default)
- `1234`: LM Studio API server (default)
- Change web port via environment variable `PORT` in `.env` or in `web_assistant.py:uvicorn.run()`

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

### Auto-Reload in Development
Uvicorn automatically reloads the server when Python files change (enabled with `--reload` flag or when `FLASK_DEBUG=True` in `.env`). Jinja2 templates in `templates/` are reloaded automatically. Changes to Python code, templates, or configuration trigger a server restart within 1-2 seconds.

### Async Architecture Benefits
- **Non-blocking I/O**: STT, TTS, and LLM operations run in thread pool via `asyncio.to_thread()`
- **Concurrent requests**: Multiple clients can interact simultaneously without blocking
- **Streaming responses**: LLM responses stream in real-time via async Socket.IO
- **Better scalability**: Handles more concurrent connections with fewer resources