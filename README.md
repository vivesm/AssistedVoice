# AssistedVoice: Unified High-Performance AI Backend

AssistedVoice is an intelligent AI bridge and execution engine designed to provide high-performance LLM, transcription, and vision capabilities to remote clients like [ChatLink](https://github.com/vives/ChatLink).

## Core Capabilities

### 🧠 Unified LLM Orchestration
- **Engine Agnostic**: Switch seamlessly between **Ollama** (Local), **OpenAI** (Cloud), and **Gemini** (Cloud).
- **Persistent Memory**: Conversation history is maintained even when switching between different models or engines.
- **Optimized Caching**: Response caching for common local queries to minimize latency.

### 👁️ Multimodal Intelligence
- **Vision-Aware Routing**: Automatically detects image attachments and routes them to vision-capable models (e.g., `qwen3-vl:8b`) regardless of the currently active text model.
- **Smart Transcription**: Integrated Whisper service with base64 support for instant voice-to-text processing.

### ⚡ REST & Socket Integration
- **Unified Chat API**: `/api/chat` handles text and multimodal (images) payloads in a single request.
- **External Control**: `/api/backend/switch` and `/api/models/switch` allow remote clients to reconfigure the server's AI engine on the fly.
- **WebSocket Streaming**: Real-time response streaming for ultra-fast user feedback.

## Setup

1. **Environment Configuration**:
   Create a `.env` file with your cloud API keys:
   ```env
   OPENAI_API_KEY=your_key
   GEMINI_API_KEY=your_key
   ```

2. **Installation**:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. **Running the Server**:
   ```bash
   python web_assistant.py
   ```
   The server defaults to port `5001`.

## Remote Client Integration (ChatLink)

AssistedVoice is specifically optimized to work with the ChatLink Signal bot. 

- **Voice Notes**: ChatLink sends voice attachments to Sagan. Sagan transcribes them and processes the query.
- **Model Switching**: ChatLink can change Sagan's active model remotely using Signal commands like `/ollama` or `/openai`.

## Privacy & Security
- **Local Priority**: Prefers local Ollama models unless specifically instructed to use cloud backends.
- **Secure Provisioning**: Keeps API keys on the server (Sagan), so clients (Atom) only need to communicate with the local bridge.

---
**Powering your remote intelligence.** 🚀
