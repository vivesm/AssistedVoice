# AssistedVoice Agent Instructions

Welcome to the AssistedVoice project. As an AI agent working on this codebase, you must adhere to the following rules and architectural standards.

## 🏁 Project Core
- **Primary Tech Stack**: FastAPI (Backend), Socket.IO (Real-time), SQLite (Persistence), Vanilla JS/CSS (Frontend).
- **Orchestration**: Docker Compose is the source of truth for the runtime environment.

## 🐳 Docker & Development Workflow
1. **Docker-First**: Always verify changes within the Docker containers.
2. **Local Development**:
   - The project uses **volume mounts** for `modules/`, `routers/`, `services/`, `web_assistant.py`, `static/`, and `templates/`.
   - **Hot Reload**: Uvicorn reloads automatically inside the container when host files are edited.
3. **Rebuilding**: Run `docker compose up -d --build` ONLY when `requirements.txt` or `Dockerfile` changes.
4. **Networking**: 
   - Internal core services: `http://assistedvoice:5001`.
   - Signal API: `http://signal-api:8080` (must run in `json-rpc` mode).
   - Ollama (Host): Use `host.docker.internal:11434`.

## 🤖 Signal Bot Rules
- **WebSocket Connectivity**: Signal WebSocket connections require URL-encoded phone numbers (e.g., `+` -> `%2B`).
- **Data Persistence**: `signal_data/` must be persisted via volume mounts and **strictly ignored** in Git.
- **Mode Encoding**: The Signal API container (`signal-api`) must use `MODE=json-rpc` to support WebSockets.

## 🧠 AI & LLM Logic
- **Vision Awareness**: Maintain vision-aware routing in `services/chat_service.py`. Automatically detect and route image attachments to vision-capable models (e.g., Qwen-VL).
- **Model Switching**: Use the `/api/models/switch` and `/api/backend/switch` endpoints for management.
- **MCP Integration**: Ensure the 7 Docker-based MCP servers (Search, Docs, Playwright, Docker, Desktop, Memory, Thinking) remain functional.

## 📂 Git & Repository Standards
1. **Host-Only Git**: Perform all Git operations (add, commit, push) on the host machine, never from inside a container.
2. **Protection**: Never commit `.env` files, `signal_data/`, `logs/`, or `models/`.
3. **Branching**: Use feature branches (e.g., `feat/` or `fix/`) for non-trivial changes.

## 🎨 UI/UX Standards
- Maintain the **Modern Glassmorphism** aesthetic.
- Ensure all frontend assets in `static/` use the unified design tokens.
- Real-time feedback for PTT (Push-to-Talk) and model switching must be maintained.
