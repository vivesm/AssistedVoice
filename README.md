# AssistedVoice: Unified High-Performance AI Backend

AssistedVoice is an intelligent AI bridge and execution engine designed to provide high-performance LLM, transcription, and vision capabilities to remote clients like [ChatLink](https://github.com/vives/ChatLink).

## Core Capabilities

### 🧠 Unified LLM Orchestration
- **Engine Agnostic**: Switch seamlessly between **Ollama** (Local), **OpenAI** (Cloud), and **Gemini** (Cloud).
- **Persistent Memory**: Conversation history is maintained even when switching between different models or engines (SQLite backend).
- **Optimized Caching**: Response caching for common local queries to minimize latency.

### 👁️ Multimodal Intelligence
- **Vision-Aware Routing**: Automatically detects image attachments and routes them to vision-capable models (e.g., `qwen3-vl:8b`) regardless of the currently active text model.
- **Smart Transcription**: Integrated Whisper service with base64 support for instant voice-to-text processing (WAV/WebM support).

### ⚡ REST & Socket Integration
- **Unified Chat API**: `/api/chat` handles text and multimodal (images) payloads in a single request.
- **External Control**: `/api/backend/switch` and `/api/models/switch` allow remote clients to reconfigure the server's AI engine on the fly.
- **WebSocket Streaming**: Real-time response streaming for ultra-fast user feedback.

### 🔧 MCP Tools Integration (NEW)
Your assistant can automatically use external tools via Docker MCP servers:

| Intent | Trigger Phrases | Tool Used | Capability |
|--------|----------------|-----------|------------|
| **Web Search** | "search for...", "what's the latest...", "current news about..." | Brave Search | Real-time web results |
| **Code Docs** | "docs for...", "how to use...", "documentation..." | Context7 | Up-to-date library docs |
| **Browse Web** | "open...", "visit...", "browse..." | Playwright | Read page content |
| **Docker** | "docker logs...", "list containers...", "docker ps" | Docker | Container management |
| **Sequential Thinking** | "think step by step...", "analyze...", "let's think about..." | Thinking | Deep problem solving |
| **Memory** | "remember...", "what do you know about...", "relation..." | Memory | Knowledge Graph |
| **Desktop** | "run command...", "shell...", "list processes" | Desktop Commander | File system & Terminal |

**Setup**: Requires Docker Desktop with MCP images pulled.

## Quick Start (Docker)

1. **Setup Environment**:
   ```bash
   cp .env.example .env
   # Edit .env and set your keys/secrets
   ```

2. **Start Services**:
   ```bash
   docker compose up -d --build
   ```

3. **Verify**:
   Visit [http://localhost:5001](http://localhost:5001) or check logs with `docker compose logs -f assistedvoice`.

## Configuration & Development

### 🐳 Docker Workflow
The system is optimized for a seamless Docker development experience:
- **Hot Reload**: Changes to `.py`, `.html`, or `.js` files on your host are instantly reflected in the container.
- **Persistence**: Database (`data/`), logs (`logs/`), and Signal account data (`signal_data/`) are persisted across restarts.
- **Dependency Updates**: Run `docker compose up -d --build` whenever you modify `requirements.txt`.

### 🏗️ Manual Installation
For host-mode execution without Docker:
```bash
# 1. Install dependencies
./setup.sh

# 2. Start the server
./start.sh
```

## Remote Client Integration (ChatLink)
AssistedVoice is specifically optimized to work with the ChatLink Signal bot. 
- **Voice Notes**: ChatLink sends voice attachments to AssistedVoice. It transcribes them and processes the query.
- **Model Switching**: ChatLink can change the active model remotely using Signal commands.
- **Multimodal Support**: Send images to the Signal bot and AssistedVoice will describe them using vision models.

## Architecture

```
AssistedVoice/
├── web_assistant.py       # Main FastAPI application
├── config.yaml           # Configuration
├── routers/              # FastAPI route handlers
│   ├── api.py           # REST API endpoints
│   ├── pages.py         # Page routes
│   └── websocket.py     # Async Socket.IO handlers
├── services/            # Business logic layer
│   ├── chat_service.py  # Chat with 7 MCP tool integration
│   ├── mcp_service.py   # Docker MCP clients
│   ├── audio_service.py # Audio processing
│   ├── model_service.py # Model management
│   └── database_service.py # SQLite persistence
├── modules/             # Core components
│   ├── stt.py          # Speech recognition (Whisper)
│   ├── llm.py          # Language model (Ollama)
│   ├── llm_factory.py  # LLM creation factory
│   └── tts.py          # Text-to-speech engines
├── models/             # Pydantic schemas
└── static/             # Frontend assets
```

## Performance Optimization
The system automatically detects and uses Metal Performance Shaders for acceleration on Apple Silicon.

---
**Powering your remote intelligence.** 🚀
