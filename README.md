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

## Setup

### Prerequisites
- macOS (optimized for Apple Silicon)
- Python 3.8+
- 16GB+ RAM recommended
- Docker Desktop (for MCP tools)

### 1. Environment Configuration
Create a `.env` file with your API keys:
```env
OPENAI_API_KEY=your_key
GEMINI_API_KEY=your_key
BRAVE_API_KEY=your_brave_key # For web search
```

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/vivesm/AssistedVoice.git
cd AssistedVoice

# Run the setup script
./setup.sh
```

### 3. Pull MCP Images (Optional)
```bash
docker pull mcp/brave-search
docker pull mcp/context7
docker pull mcp/playwright
docker pull mcp/docker
docker pull mcp/desktop-commander
docker pull mcp/memory
docker pull mcp/sequential-thinking
```

### 4. Running the Server
```bash
./start.sh
```
The server defaults to port `5001`.

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
