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
# Set up virtual environment and install dependencies
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

**Web Interface (AssistedVoice Backend)**
```bash
# 1. (Optional) Create .env file for configuration
cp .env.example .env
# Edit .env to set SECRET_KEY, CORS_ALLOWED_ORIGINS, BRAVE_API_KEY, etc.

# 2. Start Ollama service (required for Ollama backend)
ollama serve

# 3. Start AssistedVoice web server (recommended method)
./start.sh

# Or manually:
source venv/bin/activate
python web_assistant.py

# Or use uvicorn directly:
uvicorn web_assistant:socket_app --reload --port 5001

# Open browser to:
# - Main UI: http://localhost:5001
# - API Docs (Swagger): http://localhost:5001/docs
# - API Docs (ReDoc): http://localhost:5001/redoc
```

**Signal Bot (Standalone Client)**
```bash
# 1. Configure Signal credentials in .env
# Add: SIGNAL_NUMBER, OPENAI_API_KEY, GEMINI_API_KEY

# 2. Ensure backend is running (on sagan or locally)
# Update config.yaml whisper.remote_url if using remote backend

# 3. Start Signal bot
source venv/bin/activate
python run_bot.py

# The bot will listen for Signal messages and respond using the configured backend
```

### Signal Bot Setup (signal-cli-rest-api)

The Signal bot requires `signal-cli-rest-api` to send/receive Signal messages.

**Docker Setup (Recommended)**
```bash
# 1. Create Docker network for inter-container communication (if not already exists)
docker network create assistedvoice-net

# 2. Run signal-cli-rest-api container
docker run -d \
  --name signal-api \
  --network assistedvoice-net \
  -p 8080:8080 \
  -v ~/signal-data:/home/.local/share/signal-cli \
  bbernhard/signal-cli-rest-api:latest

# 3. Register your phone number (one-time setup)
# Visit http://localhost:8080/v1/qrcodelink?device_name=signal-bot
# Scan the QR code with your Signal app: Settings > Linked Devices > Link New Device

# 4. Verify registration
curl -X GET http://localhost:8080/v1/about

# 5. Update .env with your Signal number and allowed users
echo "SIGNAL_NUMBER=+1234567890" >> .env
echo "SIGNAL_API_URL=http://signal-api:8080" >> .env
echo "ALLOWED_USERS=+1234567890,+0987654321" >> .env
```

**Native Installation (Alternative)**
```bash
# Install signal-cli (requires Java 17+)
# macOS
brew install signal-cli

# Linux (Debian/Ubuntu)
wget https://github.com/AsamK/signal-cli/releases/download/v0.11.11/signal-cli-0.11.11.tar.gz
tar xf signal-cli-0.11.11.tar.gz -C /opt
sudo ln -sf /opt/signal-cli-0.11.11/bin/signal-cli /usr/local/bin/

# Register your number
signal-cli -u +1234567890 register

# Verify with code received via SMS
signal-cli -u +1234567890 verify [CODE]

# Start signal-cli in daemon mode
signal-cli -u +1234567890 daemon --http 0.0.0.0:8080

# Update .env
echo "SIGNAL_API_URL=http://localhost:8080" >> .env
```

**Configuration**

The Signal bot uses the following environment variables from `.env`:

```bash
# Required
SIGNAL_NUMBER=+13475332155           # Your Signal bot number
ALLOWED_USERS=+13475332155           # Comma-separated allowed users
SIGNAL_API_URL=http://signal-api:8080  # signal-cli-rest-api endpoint

# Backend Integration (for distributed setup)
BACKEND_URL=http://sagan.local:5001  # AssistedVoice backend for STT/LLM

# Optional Features
HA_URL=http://homeassistant:8123     # Home Assistant integration
HA_TOKEN=your-ha-token               # HA Long-Lived Access Token
VIDEO_TRANSCRIBE_HELPER=/path/to/transcribe_and_share.py  # Video transcription
SIGNAL_DATA_PATH=/path/to/signal-data  # For voice/image attachments
HOST_USER=root                       # SSH user for agent mode
HOST_ADDR=host.docker.internal       # SSH host for agent mode
```

**Distributed Setup (Client-Server)**

For running the Signal bot on one machine (`atom`) and the backend on another (`sagan`):

```bash
# On Backend Server (sagan)
# 1. Start AssistedVoice backend
cd /path/to/AssistedVoice
source venv/bin/activate
python web_assistant.py  # Runs on http://sagan.local:5001

# On Client Machine (atom)
# 2. Configure .env to point to remote backend
echo "BACKEND_URL=http://sagan.local:5001" >> .env

# 3. Update config.yaml for remote Whisper STT
# Edit config.yaml:
whisper:
  mode: remote
  remote_url: "http://sagan.local:5001/transcribe"

# 4. Start Signal bot
python run_bot.py
```

**Verifying Setup**

```bash
# Test signal-api is running
curl http://localhost:8080/v1/about

# Test backend connectivity (if remote)
curl http://sagan.local:5001/config

# Start Signal bot with logging
python run_bot.py

# Send test message to your bot via Signal
# Send: "ping"
# Expected response: "Pong! 🏓"

# Test help command
# Send: "/help"
# Expected: Detailed help message with available commands

# Test model switching
# Send: "/model llama3.2:latest"
# Expected: Model switch confirmation with ✅ reaction
```

**Troubleshooting**

Common issues:
- **"SIGNAL_NUMBER not configured"**: Add `SIGNAL_NUMBER` to `.env` file
- **"Connection refused to signal-api"**: Check if signal-api container/service is running with `docker ps` or `curl localhost:8080/v1/about`
- **"Attachments not working"**: Check `SIGNAL_DATA_PATH` points to signal-cli data directory (usually `~/signal-data` or `/home/.local/share/signal-cli`)
- **"Model switching fails"**: Verify `BACKEND_URL` points to running AssistedVoice backend (test with `curl $BACKEND_URL/api/models`)
- **"Home Assistant commands fail"**: Ensure `HA_TOKEN` is set to valid Long-Lived Access Token
- **"Video transcription fails"**: Check `VIDEO_TRANSCRIBE_HELPER` path exists and is executable

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

**Signal Bot** (`signal_bot/chatops_bot.py` and `run_bot.py`)
- Standalone Signal messaging integration (runs independently from web server)
- Per-user LLM session management (separate instances per Signal user)
- Voice message transcription via remote/local Whisper backend
- Mode detection: ASK (read-only), DO (action execution), AGENT (SSH commands)
- Command execution system with confirmation workflows
- Home Assistant integration for smart home control
- User preference persistence (JSON-based storage)
- Multi-backend support: uses same LLM factory as web interface

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
- `BRAVE_API_KEY` - Brave Search API key for MCP web search tool
- `OPENAI_API_KEY` - OpenAI API key (for cloud LLM backend)
- `GEMINI_API_KEY` - Google Gemini API key (for cloud LLM backend)
- `SIGNAL_NUMBER` - Bot's Signal phone number (for Signal bot integration)
- `SIGNAL_API_URL` - Signal API endpoint (default: `http://signal-api:8080`)

Create `.env` from `.env.example`: `cp .env.example .env`

**Application Settings** (`config.yaml`)
- `server`: Backend server settings (type: ollama/lm-studio, host, port, timeout)
- `whisper`: Speech recognition settings (model, language, device, compute_type, **mode: remote/local**, **remote_url**)
- `ollama`: Ollama-specific LLM settings (model, temperature, max_tokens, system_prompt, **vision_model**)
- `lm_studio`: LM Studio-specific settings (model, fallback_model, context_window)
- `tts`: Text-to-speech settings (engine: edge-tts/macos/none, voice, rate)
- `audio`: Recording settings (sample_rate, channels, silence_threshold)
- `vad`: Voice Activity Detection settings (enabled, mode, speech_timeout)
- `performance`: Optimization flags (cache_responses, response_streaming)
- `reading_mode`: Text extraction and TTS reading settings (enabled, chunk_size, share_base_url)

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
- Configure `server.type` in config.yaml as `ollama`, `lm-studio`, `openai`, or `gemini`
- Factory (`create_llm()`) instantiates appropriate class from `modules/llm_factory.py`
- All backends implement `BaseLLM` interface for consistency and multimodal support
- OptimizedOllamaLLM adds response caching when `performance.cache_responses: true`
- Cloud backends (OpenAI, Gemini) require API keys in `.env`

### Remote Backend Architecture
The Signal bot (`run_bot.py`) can operate in client mode, delegating heavy tasks to a remote backend:
- **Whisper STT**: Configure `whisper.mode: remote` and `whisper.remote_url` in config.yaml to use backend's `/transcribe` endpoint
- **LLM**: Signal bot creates its own LLM instances using the factory, but can connect to remote Ollama/LM Studio servers via `server.host`
- **Network Setup**: Backend runs on `sagan.local:5001`, client runs on `atom` - both share same config.yaml structure
- This allows resource-intensive operations (Whisper, Ollama) to run on powerful hardware while lightweight clients handle I/O

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