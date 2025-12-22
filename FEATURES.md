# AssistedVoice Features Reference

Complete catalog of all features, commands, and capabilities in AssistedVoice.

## Table of Contents

- [Signal Bot](#signal-bot)
  - [Commands](#commands)
  - [Mode System](#mode-system)
  - [Action Types](#action-types)
  - [Attachment Handling](#attachment-handling)
  - [Features](#signal-bot-features)
  - [Configuration](#signal-bot-configuration)
- [Web Interface](#web-interface)
  - [UI Components](#ui-components)
  - [Live Assistant Mode](#live-assistant-mode)
  - [Reading Mode](#reading-mode)
  - [Advanced Features](#advanced-features)
- [REST API](#rest-api)
  - [Configuration Endpoints](#configuration-endpoints)
  - [Model Management](#model-management-api)
  - [Chat & Inference](#chat--inference)
  - [Conversation Management](#conversation-management-api)
  - [Text-to-Speech](#text-to-speech-api)
- [WebSocket Events](#websocket-events)
  - [Connection Events](#connection-events)
  - [Audio & Chat Processing](#audio--chat-processing)
  - [Model & Settings](#model--settings)
  - [TTS Control](#tts-control)
  - [Live Assistant](#live-assistant-events)
  - [Reading Mode Events](#reading-mode-events)
- [MCP Tools](#mcp-tools)
- [Multimodal Support](#multimodal-support)
- [Configuration Reference](#configuration-reference)

---

## Signal Bot

The Signal bot provides full-featured AI assistant capabilities via Signal messaging app, with voice transcription, image analysis, and smart home control.

### Commands

#### Basic Commands

| Command | Usage | Description | Example |
|---------|-------|-------------|---------|
| `ping` | `ping` | Test bot connectivity | Bot replies "Pong! 🏓" |
| `/help` | `/help` or `help` | Show comprehensive help menu | Displays all commands and features |
| `/reset` | `/reset` | Clear conversation history | Deletes your LLM session and context |
| `/model <name>` | `/model mistral:7b` | Switch active LLM model | Switches to specified model on backend |
| `/gemini` | `/gemini` | Quick switch to Gemini 1.5 Flash | Convenience command for Gemini model |

#### Confirmation Commands

| Command | Usage | Description |
|---------|-------|-------------|
| `yes` | `yes` | Confirm and execute pending action |
| `confirm` | `confirm` | Confirm and execute pending action |
| `y` | `y` | Confirm and execute pending action |

### Mode System

The bot operates in three permission modes that determine what it can do and when confirmation is required.

#### ASK Mode (Default)

**Permission Level**: Read-only with mandatory confirmation

**Auto-detection Triggers**:
- Starts with question words: `what`, `why`, `how`, `when`, `where`, `who`, `which`, `whose`
- Ends with `?`
- Contains patterns: `what is`, `what are`, `why is`, `how does`, `tell me`

**Behavior**: Bot suggests actions but requires user confirmation before execution

**Example**:
```
User: "How much disk space is free?"
Bot: "I can check your disk space using the df command. Reply 'yes' to proceed."
User: "yes"
Bot: [Executes command and shows results]
```

#### AGENT Mode

**Activation**: Use `[agent]` prefix

**Permission Level**: Full control with mandatory confirmation

**Auto-detection Triggers**:
- Contains action verbs: `check`, `show`, `get`, `list`, `run`, `execute`, `restart`, `stop`, `start`, `kill`, `monitor`, `transcribe`

**Behavior**: Bot can suggest ANY operation (read or write) but still requires confirmation

**Safety**: Dangerous operations are automatically blocked (see below)

**Example**:
```
User: "[agent] list all running containers"
Bot: "I can show running containers using:
```json
{
  "action": "shell_exec",
  "params": {"cmd": "docker ps"}
}
```
Reply 'yes' to execute."
User: "yes"
Bot: [Shows container list]
```

#### PLAN Mode

**Activation**: Use `[plan]` prefix

**Permission Level**: Planning only, no execution

**Auto-detection Triggers**:
- Contains: `plan`, `how do i`, `how can i`, `setup`, `configure`, `strategy`, `approach`, `best way to`

**Behavior**: Bot creates strategies and step-by-step plans without executing anything

**Example**:
```
User: "[plan] how should I backup my data"
Bot: "Here's a recommended approach:
1. Identify critical data locations
2. Choose backup destination (local/cloud)
3. Set up automated backup schedule
4. Test restore process
..." (planning only, no execution)
```

### Action Types

Actions are JSON-formatted commands that the bot extracts from LLM responses and executes with user confirmation.

#### shell_exec

Execute shell commands via SSH on the configured host.

**Format**:
```json
{
  "action": "shell_exec",
  "params": {
    "cmd": "command to execute"
  }
}
```

**Safe Commands** (read-only, allowed in ASK mode):
- File operations: `ls`, `cat`, `grep`, `find`, `head`, `tail`
- Docker: `docker ps`, `docker logs`, `docker inspect`
- System: `systemctl status`, `journalctl`, `ps`, `top`, `df`, `du`, `free`
- Git: `git log`, `git status`, `git diff`
- Network: `curl -X GET`, `curl http` (GET requests only)
- Misc: `whoami`, `pwd`, `which`, `echo`

**Dangerous Patterns** (automatically blocked):
- `rm -rf /` - Recursive deletion of root
- `dd if=` - Disk destruction
- `mkfs.` - Filesystem formatting
- `> /dev/sd*` - Direct device writes
- `:() { :| : & }` - Fork bomb
- `sudo rm` - Privileged deletion
- `docker rm` - Container deletion
- `systemctl stop` - Service stopping

**Example**:
```json
{
  "action": "shell_exec",
  "params": {
    "cmd": "docker ps -a"
  }
}
```

#### transcribe_video

Transcribe video content from YouTube and other platforms.

**Format**:
```json
{
  "action": "transcribe_video",
  "params": {
    "url": "https://youtube.com/watch?v=..."
  }
}
```

**Features**:
- Supports YouTube, YouTube Shorts, and other video URLs
- Returns short URL to transcribed content
- Timeout: 20 minutes (for long videos)
- Uses external helper script (configurable path)

**Example**:
```json
{
  "action": "transcribe_video",
  "params": {
    "url": "https://youtube.com/watch?v=dQw4w9WgXcQ"
  }
}
```

#### homeassistant_action

Control smart home devices via Home Assistant.

**Format**:
```json
{
  "action": "homeassistant_action",
  "params": {
    "domain": "light",
    "service": "turn_on",
    "entity_id": "light.living_room",
    "data": {
      "brightness": 255
    }
  }
}
```

**Common Services**:
- **Light**: `turn_on`, `turn_off`, `toggle`, `brightness`
- **Switch**: `turn_on`, `turn_off`, `toggle`
- **Climate**: `set_temperature`, `set_hvac_mode`
- **Media Player**: `play`, `pause`, `volume_set`

**Example** (Turn on lights):
```json
{
  "action": "homeassistant_action",
  "params": {
    "domain": "light",
    "service": "turn_on",
    "entity_id": "light.kitchen"
  }
}
```

**Example** (Set thermostat):
```json
{
  "action": "homeassistant_action",
  "params": {
    "domain": "climate",
    "service": "set_temperature",
    "entity_id": "climate.living_room",
    "data": {
      "temperature": 72
    }
  }
}
```

### Attachment Handling

#### Voice Messages

**Processing Flow**:
1. Audio extracted from Signal message
2. Converted to base64
3. Transcribed using Whisper STT service
4. Prepended to user message as `[Voice Message]: <transcription>`

**Example**:
```
User: [sends voice message saying "what's the weather"]
Bot sees: "[Voice Message]: what's the weather"
Bot: "I can search for the current weather..."
```

#### Image Analysis

**Processing Flow**:
1. Image extracted from Signal message
2. Converted to base64
3. Passed to vision-capable LLM model
4. Automatic model switching to vision models (ministral-3:8b, qwen2-vl, etc.)

**Auto-Prompt**: If only image sent (no text), bot uses "Describe this image." as prompt

**Example**:
```
User: [sends photo of a dog with text "what breed?"]
Bot: [Analyzes image using vision model]
Bot: "This appears to be a Golden Retriever..."
```

**Storage**: Attachments stored in `/Users/Shared/Server/AssistedVoice/signal_data/attachments/`

### Signal Bot Features

#### Real-time Communication
- **Typing Indicators**: Bot shows typing while processing
- **Reactions**:
  - 👀 while processing
  - ✅ on success
  - ❌ on error
- **Graceful Degradation**: Continues working even if reactions fail

#### Conversation Management
- **Per-User Sessions**: Each user gets their own LLM instance
- **History Persistence**: Context maintained across messages
- **Context Window**: Default 20 messages (configurable via `CONTEXT_WINDOW_SIZE`)
- **Clear Command**: `/reset` to start fresh

#### Multi-Modal Capabilities
- **Vision Support**: Automatic image analysis with vision models
- **Audio Support**: Voice message transcription with Whisper
- **Smart Routing**: Auto-switches to vision models when images detected

#### Model Management
- **Dynamic Switching**: Change models on-the-fly with `/model`
- **Gemini Integration**: Quick access with `/gemini`
- **Backend API**: Calls AssistedVoice REST API for switching
- **Fallback**: Auto-fallback if selected model fails

#### Security & Access Control
- **Whitelist**: Only authorized phone numbers can use bot
- **Silent Rejection**: Unauthorized messages logged but ignored
- **Configuration**: Set via `ALLOWED_USERS` environment variable

#### Smart Home Integration
- **Home Assistant**: Full integration with HA REST API
- **Service Calls**: Execute any HA service
- **Entity Control**: Direct device control via entity IDs

### Signal Bot Configuration

#### Required Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SIGNAL_NUMBER` | Bot's phone number | `+13475332155` |
| `SIGNAL_API_URL` | Signal API endpoint | `http://signal-api:8080` |
| `ALLOWED_USERS` | Comma-separated authorized numbers | Bot's number |

#### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MAX_MSG_LEN` | Max message length to process | `4000` |
| `HOST_USER` | SSH user for remote execution | `root` |
| `HOST_ADDR` | SSH host for remote execution | `host.docker.internal` |
| `HA_URL` | Home Assistant URL | `http://homeassistant:8123` |
| `HA_TOKEN` | Home Assistant API token | (empty) |
| `SIGNAL_DATA_PATH` | Attachments storage path | (configurable) |
| `BACKEND_URL` | AssistedVoice API endpoint | `http://localhost:5001` |
| `VIDEO_TRANSCRIBE_HELPER` | Video transcription script path | `/home/melvin/server/...` |
| `CONTEXT_WINDOW_SIZE` | Messages to retain for context | `20` |

#### Distributed Setup Example

**On Backend Server (sagan)**:
```bash
# Start AssistedVoice backend
python web_assistant.py  # Runs on http://sagan.local:5001
```

**On Client Machine (atom)**:
```bash
# Configure .env
BACKEND_URL=http://sagan.local:5001
SIGNAL_NUMBER=+13475332155
ALLOWED_USERS=+13475332155,+15551234567

# Update config.yaml
whisper:
  mode: remote
  remote_url: "http://sagan.local:5001/transcribe"

# Start bot
python run_bot.py
```

---

## Web Interface

Modern web-based interface with push-to-talk recording, live transcription, reading mode, and advanced settings.

### UI Components

#### Header & Navigation
- **Menu Button**: Open/close conversation sidebar
- **Settings Button**: Access settings panel
- **Search Button**: Search conversation history (Ctrl+F)
- **Reading Mode Button**: Switch to reading mode for long-form content
- **Back Button**: Return from reading mode to chat
- **Title Display**: App title or "Reading Mode" indicator

#### Chat Interface
- **Welcome Screen**: Shows available models on startup
- **Messages Display**: Chat history with user/assistant roles
- **Markdown Rendering**: Full markdown support with syntax highlighting
- **Code Block Actions**: Copy buttons on all code blocks
- **Search Highlighting**: Highlight and navigate search results
- **Message Replay**: Speaker buttons to replay individual message audio

#### Input & Controls
- **Text Input Area**: Auto-expanding textarea
  - **Enter**: Send message
  - **Shift+Enter**: New line
- **Send Button**: Submit text message
- **Voice Button (PTT)**: Push-to-talk recording
  - Visual feedback with animated border
  - Recording indicator
  - Audio visualizer with frequency display
- **Image Upload Button**: Attach images for multimodal processing
  - Supports multiple images
  - Preview with remove buttons
- **Live Mode Button**: Toggle continuous audio streaming
- **Mute Button**: Quick toggle for TTS audio

#### Status & Indicators
- **Status Text**: Real-time status updates
  - Ready, Recording, Transcribing, Generating, Speaking
- **Model Indicator**: Currently selected model display
- **Quick Model Selector**: Dropdown to switch models
- **Performance Metrics**:
  - Response time
  - First token latency
  - Tokens per second
- **VAD Status**: Voice Activity Detection indicator

#### Settings Panel

**Theme**:
- Light/Dark mode toggle

**Model Selection**:
- List of available models
- Quick switch functionality
- Model info display

**Whisper Configuration**:
- Model selection: tiny, base, small, medium, large
- Language selection
- Device selection (auto/CPU/GPU)

**LLM Configuration**:
- Temperature slider (0.0-1.0)
- Max tokens slider (50-2000)
- System prompt editor
- System prompt templates

**TTS Configuration**:
- Engine selection: Edge TTS, macOS, None
- Voice selector with preview
- Pitch adjustment (Edge TTS only)
- Speech rate adjustment
- Volume control

**Server Configuration**:
- Backend type selection (Ollama/LM Studio/OpenAI/Gemini)
- Server host/port settings
- Connection test button

**VAD Settings**:
- Enable/disable toggle
- Detection mode (0-3)
- Speech timeout
- Min speech duration

**Advanced Settings**:
- Response caching toggle
- Response streaming toggle
- Tool integration enable/disable
- Export conversation (JSON/TXT)
- Import conversation

### Live Assistant Mode

Continuous audio streaming with real-time transcription and AI insights.

**Features**:
- **Live Transcript Panel**: Real-time speech-to-text with timestamps
- **AI Insights Panel**:
  - Main topic being discussed
  - Key points and talking points
  - Updated every ~15 seconds (3 audio chunks)
- **Listening Indicator**: Animated pulse during active listening
- **Word Overlap Stitching**: Removes duplicate words from adjacent chunks
- **Silence Detection**: Skips silent audio to reduce CPU

**Controls**:
- **Live Button**: Start/stop continuous listening
- **Clear Button**: Clear current transcript
- **Mute Button**: Disable TTS responses

**Audio Processing**:
- PCM audio format via AudioWorklet
- Low-latency streaming
- RMS volume monitoring
- Automatic normalization

### Reading Mode

Long-form content reader with TTS playback and progress tracking.

**Input Options**:
1. **Text Input Tab**: Paste text directly (up to 200,000 characters)
2. **Share Code Tab**: Load from share.vives.io with code

**Features**:
- **Character Counter**: Real-time character count
- **Chunk Preview**: Shows current segment with formatting
- **Progress Bar**: Visual progress indicator with percentage
- **Chunk Counter**: "Chunk X of Y" display
- **Auto-advance**: Automatically play next chunk after TTS completes

**Playback Controls**:
- ⏮️ **Previous**: Go back to previous chunk
- ▶️/⏸️ **Play/Pause**: Start/pause playback
- ⏹️ **Stop**: Reset to beginning
- ⏭️ **Next**: Skip to next chunk

**Configuration**:
- Chunk size: 500 characters (default)
- TTS engine selection
- Voice selection
- Speed/pitch adjustments

### Advanced Features

#### Markdown Support
- Headers, bold, italic, lists
- Code blocks with syntax highlighting
- Links (clickable and safe)
- Blockquotes, tables
- Automatic copy buttons on code blocks

#### Keyboard Shortcuts
- **Ctrl+F**: Search conversation
- **Enter**: Send message
- **Shift+Enter**: New line
- **Esc**: Close modals
- **?**: Show shortcuts help

#### Conversation Management
- **Auto-save**: Messages saved as sent/received
- **Conversation List**: Side menu with past chats
- **Load Previous**: Resume any conversation
- **Clear Chat**: Reset current conversation
- **Persistence**: Saved to local storage and database

#### Export/Import
- **Export Formats**: JSON, Plain Text
- **Import**: Load conversations from JSON
- **Metadata Preserved**: Timestamps, model info, roles

---

## REST API

RESTful HTTP endpoints for programmatic access to all features.

### Configuration Endpoints

#### Get Configuration

```http
GET /config
```

**Response**:
```json
{
  "whisper": {...},
  "ollama": {...},
  "lm_studio": {...},
  "tts": {...},
  "server": {...},
  "ui": {...},
  "audio": {...},
  "vad": {...},
  "performance": {...}
}
```

**Description**: Retrieve full application configuration including all settings.

### Model Management API

#### List Available Models

```http
GET /api/models
```

**Response**:
```json
{
  "models": ["llama3.2:latest", "mistral:7b", "gemini-1.5-flash"],
  "current_model": "llama3.2:latest"
}
```

#### Switch LLM Model

```http
POST /api/models/switch
Content-Type: application/json

{
  "model": "mistral:7b"
}
```

**Response**:
```json
{
  "success": true,
  "model": "mistral:7b"
}
```

#### Switch Backend

```http
POST /api/backend/switch
Content-Type: application/json

{
  "backend": "openai",
  "model": "gpt-4" (optional)
}
```

**Response**:
```json
{
  "success": true,
  "backend": "openai",
  "model": "gpt-4"
}
```

### Chat & Inference

#### Text Chat (Non-streaming)

```http
POST /api/chat
Content-Type: application/json

{
  "message": "What is the capital of France?",
  "images": ["base64_encoded_image"] (optional)
}
```

**Response**:
```json
{
  "response": "The capital of France is Paris.",
  "model": "llama3.2:latest",
  "tokens": 42,
  "response_time": 1.23
}
```

#### Transcribe Audio

```http
POST /transcribe
Content-Type: application/json

{
  "audio": "base64_encoded_audio_data"
}
```

**Response**:
```json
{
  "text": "Hello, how are you?"
}
```

**Supported Formats**: WAV, WebM, MP3, M4A

### Conversation Management API

#### List Conversations

```http
GET /api/conversations?limit=50
```

**Response**:
```json
{
  "conversations": [
    {
      "id": "conv_123",
      "title": "Chat about Python",
      "created_at": "2025-12-21T10:30:00Z",
      "model": "llama3.2:latest",
      "message_count": 15
    }
  ]
}
```

#### Get Conversation

```http
GET /api/conversations/conv_123
```

**Response**:
```json
{
  "id": "conv_123",
  "title": "Chat about Python",
  "messages": [
    {
      "role": "user",
      "content": "What is Python?",
      "timestamp": "2025-12-21T10:30:00Z"
    },
    {
      "role": "assistant",
      "content": "Python is a programming language...",
      "timestamp": "2025-12-21T10:30:05Z"
    }
  ]
}
```

#### Create Conversation

```http
POST /api/conversations
Content-Type: application/json

{
  "title": "New Chat",
  "model": "llama3.2:latest",
  "messages": [] (optional)
}
```

**Response**:
```json
{
  "id": "conv_124",
  "title": "New Chat",
  "created_at": "2025-12-21T11:00:00Z"
}
```

#### Update Conversation

```http
PUT /api/conversations/conv_123
Content-Type: application/json

{
  "title": "Updated Title",
  "messages": [...] (optional - full message history)
}
```

#### Delete Conversation

```http
DELETE /api/conversations/conv_123
```

**Response**:
```json
{
  "success": true
}
```

#### Add Message to Conversation

```http
POST /api/conversations/conv_123/messages
Content-Type: application/json

{
  "role": "user",
  "content": "Tell me more"
}
```

### Text-to-Speech API

#### Set TTS Engine

```http
POST /api/tts/engine
Content-Type: application/json

{
  "engine": "edge-tts",
  "voice": "en-US-JennyNeural" (optional)
}
```

**Engines**: `edge-tts`, `macos`, `none`

#### Test Connection

```http
POST /api/test-connection
```

**Response**:
```json
{
  "connected": true,
  "backend": "ollama",
  "models": ["llama3.2:latest", "mistral:7b"]
}
```

---

## WebSocket Events

Real-time bidirectional communication via Socket.IO for streaming responses and live features.

### Connection Events

#### Client → Server

**`connect`**: Client connection initiated

**`connected`**: Server acknowledges connection

**Response** (Server → Client):
```json
{
  "status": "connected",
  "session_id": "session_abc123"
}
```

#### Server → Client

**`disconnect`**: Client disconnected

**`error`**: Error message
```json
{
  "error": "Model not found"
}
```

**`connect_error`**: Connection error
```json
{
  "error": "WebSocket connection failed"
}
```

### Audio & Chat Processing

#### Client → Server

**`process_audio`**: Send base64 audio from push-to-talk
```json
{
  "audio": "base64_encoded_audio"
}
```

**`process_text`**: Send text with optional images
```json
{
  "text": "Describe this image",
  "images": ["base64_image1", "base64_image2"]
}
```

#### Server → Client

**`status`**: Processing status updates
```json
{
  "status": "transcribing" | "generating" | "speaking" | "ready"
}
```

**`transcription`**: Transcribed text from audio
```json
{
  "text": "Hello, how are you?"
}
```

**`response_chunk`**: Streaming response text
```json
{
  "chunk": "This is part of the "
}
```

**`response_complete`**: Complete response with metadata
```json
{
  "response": "Full response text",
  "model": "llama3.2:latest",
  "tokens": 42,
  "response_time": 1.23,
  "tokens_per_second": 34.1
}
```

**`audio_data`**: Base64 TTS audio for playback
```json
{
  "audio": "base64_encoded_audio"
}
```

**`tts_complete`**: TTS generation finished

### Model & Settings

#### Client → Server

**`change_model`**: Switch LLM model
```json
{
  "model": "mistral:7b"
}
```

**`change_whisper_model`**: Switch STT model
```json
{
  "model": "medium"
}
```

**`update_temperature`**: Adjust LLM temperature
```json
{
  "temperature": 0.7
}
```

**`update_max_tokens`**: Set max response tokens
```json
{
  "max_tokens": 500
}
```

**`update_system_prompt`**: Update system prompt
```json
{
  "prompt": "You are a helpful assistant..."
}
```

#### Server → Client

**`model_changed`**: Model switch confirmed
```json
{
  "model": "mistral:7b"
}
```

**`whisper_model_changed`**: STT model changed
```json
{
  "model": "medium"
}
```

### TTS Control

#### Client → Server

**`change_tts`**: Switch TTS engine/voice
```json
{
  "engine": "edge-tts",
  "voice": "en-US-JennyNeural"
}
```

**`update_voice`**: Change TTS voice
```json
{
  "voice": "en-GB-SoniaNeural"
}
```

**`update_voice_pitch`**: Update pitch (Edge TTS)
```json
{
  "pitch": "+5Hz"
}
```

**`update_speech_rate`**: Update speech rate
```json
{
  "rate": "+10%"
}
```

**`update_voice_volume`**: Update volume
```json
{
  "volume": "+10%"
}
```

**`preview_voice`**: Preview voice before selection
```json
{
  "voice": "en-US-AriaNeural"
}
```

#### Server → Client

**`tts_changed`**: TTS engine/voice changed
```json
{
  "engine": "edge-tts",
  "voice": "en-US-JennyNeural"
}
```

**`voice_preview`**: Audio data for voice preview
```json
{
  "audio": "base64_encoded_audio"
}
```

### Conversation Management

#### Client → Server

**`clear_conversation`**: Clear chat history

**`replay_text`**: Replay message with TTS
```json
{
  "text": "Message to replay"
}
```

#### Server → Client

**`conversation_cleared`**: Confirmation of clear

### Live Assistant Events

#### Client → Server

**`live_audio_chunk`**: WebM audio chunk
```json
{
  "audio": "base64_webm_chunk"
}
```

**`live_pcm_chunk`**: PCM audio chunk (low-latency)
```json
{
  "audio": "base64_pcm_data",
  "rms": 0.34 (volume level)
}
```

**`clear_live_assistant`**: Clear live transcript

#### Server → Client

**`live_transcript`**: Live transcription result
```json
{
  "text": "This is what you said",
  "timestamp": "10:30:45",
  "final": true
}
```

**`ai_insight`**: AI-generated insights
```json
{
  "topic": "Discussion about AI",
  "key_points": [
    "Machine learning basics",
    "Neural network architecture"
  ]
}
```

**`live_assistant_cleared`**: Confirmation of clear

### Reading Mode Events

#### Client → Server

**`start_reading`**: Initialize reading session
```json
{
  "mode": "text" | "share",
  "text": "Long text content..." (if mode=text),
  "share_code": "abc123" (if mode=share)
}
```

**`reading_play`**: Start/resume playback

**`reading_pause`**: Pause at current position

**`reading_stop`**: Stop and reset

**`reading_next`**: Skip to next chunk

**`reading_previous`**: Go to previous chunk

**`reading_seek`**: Jump to specific chunk
```json
{
  "chunk_index": 5
}
```

**`reading_auto_advance`**: Enable/disable auto-advance
```json
{
  "enabled": true
}
```

**`end_reading`**: End reading session

#### Server → Client

**`reading_started`**: Session initialized
```json
{
  "total_chunks": 47,
  "chunk_size": 500,
  "title": "Article Title"
}
```

**`reading_chunk`**: Current chunk text
```json
{
  "chunk": "This is the current segment...",
  "index": 5,
  "total": 47
}
```

**`reading_audio`**: Audio for current chunk
```json
{
  "audio": "base64_encoded_audio"
}
```

**`reading_paused`**: Playback paused

**`reading_stopped`**: Playback stopped

**`reading_progress`**: Progress update
```json
{
  "current_chunk": 5,
  "total_chunks": 47,
  "percentage": 10.6
}
```

**`reading_complete`**: End of content reached

**`reading_ended`**: Session ended

**`reading_error`**: Error occurred
```json
{
  "error": "Failed to load share code"
}
```

### Generation Control

#### Client → Server

**`stop_generation`**: Request to stop LLM response

---

## MCP Tools

7 Docker-based Model Context Protocol services providing external capabilities.

### Available Tools

| Tool | Docker Image | Intent Patterns | Capabilities | Example |
|------|-------------|----------------|--------------|---------|
| **Brave Search** | `mcp/brave-search` | search, look up, find, latest, news, weather, price | Real-time web search results | "search for latest GPT-4 news" |
| **Context7** | `mcp/context7` | docs, documentation, how to use, api for, library | Official library/framework docs | "docs for FastAPI authentication" |
| **Playwright** | `mcp/playwright` | open, go to, navigate, visit, browse | Web page content extraction, screenshots | "browse https://example.com" |
| **Docker** | `mcp/docker` | docker, container, image, ps, logs | Container/image management, logs | "docker logs myapp" |
| **Desktop Commander** | `mcp/desktop-commander` | run, execute, shell, terminal, process, kill | Execute commands, file ops, process mgmt | "run ls -la /home" |
| **Memory** | `mcp/memory` | remember, memory, knowledge graph, entity, relation | Create entities, relations, knowledge graph | "remember Alice works at Acme Corp" |
| **Sequential Thinking** | `mcp/sequential-thinking` | think, analyze, problem solve, step by step | Multi-step analytical thinking | "think about optimizing this code" |

### Setup Requirements

**Prerequisites**:
- Docker Desktop installed and running
- Sufficient disk space (~2GB for all images)

**Installation**:
```bash
# Pull all MCP images
docker pull mcp/brave-search
docker pull mcp/context7
docker pull mcp/playwright
docker pull mcp/docker
docker pull mcp/desktop-commander
docker pull mcp/memory
docker pull mcp/sequential-thinking
```

**Configuration**:
```env
# .env file
BRAVE_API_KEY=your_brave_api_key  # Required for Brave Search
```

### Intent Detection

**Prefix Commands** (explicit):
- `search: your query` → Brave Search
- `docs: library name` → Context7
- `browse: url` → Playwright
- `docker: command` → Docker
- `remember: fact` → Memory

**Pattern Matching** (automatic):
- "What is the latest..." → Brave Search
- "Show me docs for..." → Context7
- "Visit example.com" → Playwright
- "What containers are running" → Docker
- "Think step by step about..." → Sequential Thinking

### Usage Examples

**Brave Search**:
```
User: "What's the current weather in San Francisco?"
→ Triggers Brave Search
→ Returns real-time weather data
```

**Context7**:
```
User: "Show me documentation for FastAPI routing"
→ Triggers Context7
→ Returns official FastAPI docs for routing
```

**Playwright**:
```
User: "Browse github.com/anthropics/claude and summarize"
→ Triggers Playwright
→ Extracts page content and summarizes
```

**Docker**:
```
User: "What containers are currently running?"
→ Triggers Docker tool
→ Executes docker ps and formats output
```

**Memory**:
```
User: "Remember that Sarah is the project manager for Project X"
→ Triggers Memory
→ Creates entities and relations in knowledge graph
```

**Sequential Thinking**:
```
User: "Analyze the trade-offs of microservices vs monoliths"
→ Triggers Sequential Thinking
→ Provides structured multi-step analysis
```

### Disabling Tools

Via WebSocket:
```json
{
  "event": "update_tools_enabled",
  "enabled": false
}
```

Or in configuration:
```yaml
mcp:
  enabled: false
```

---

## Multimodal Support

Full support for vision and audio processing across all interfaces.

### Vision Capabilities

**Image Upload**:
- Supports: JPEG, PNG, WebP, and other standard formats
- Multiple images per message
- Base64 encoding for transmission

**Vision-Aware Routing**:
- Automatically detects images in message
- Switches to vision-capable model if needed
- Models: `ministral-3:8b`, `qwen2-vl:latest`, `gpt-4-vision`, etc.
- Fallback to text-only model if vision not available

**Auto-Prompt**:
- If only images provided (no text), uses "Describe this image in detail"
- Combines text + images for contextual analysis

**Example Usage**:

Via Web UI:
1. Click image upload button
2. Select one or more images
3. Type question or leave blank for description
4. Send message

Via Signal Bot:
1. Send image attachment
2. Add text question or leave blank
3. Bot analyzes with vision model

Via API:
```http
POST /api/chat
Content-Type: application/json

{
  "message": "What's in this image?",
  "images": ["base64_encoded_image"]
}
```

### Audio Processing

**Input Methods**:

1. **Push-to-Talk (PTT)**:
   - Press voice button to start recording
   - Release to stop and send
   - Visual feedback with animated border
   - Audio visualizer shows frequency

2. **Live Audio Streaming**:
   - Continuous audio capture
   - Real-time transcription
   - PCM format for low latency
   - Automatic silence detection

**Output Methods**:

1. **Edge TTS** (Neural voices):
   - 30+ voices in multiple languages
   - Pitch, rate, volume control
   - High quality neural synthesis

2. **macOS TTS** (System voices):
   - Native macOS voices
   - Fast and lightweight
   - Good for simple TTS

3. **None**:
   - Disable audio output
   - Text-only responses

**Configuration**:
```yaml
# config.yaml
tts:
  engine: edge-tts
  voice: en-US-JennyNeural
  rate: +0%
  volume: +40%
```

**STT Configuration**:
```yaml
whisper:
  model: small  # tiny, base, small, medium, large
  language: en
  device: auto  # auto, cpu, cuda, metal
```

---

## Configuration Reference

### Environment Variables

See `.env.example` for complete list. Key variables:

**Server**:
- `PORT=5001` - Web server port
- `HOST=0.0.0.0` - Server bind address
- `SECRET_KEY=...` - Flask session secret
- `FLASK_DEBUG=True` - Debug mode

**API Keys**:
- `OPENAI_API_KEY` - OpenAI API access
- `GEMINI_API_KEY` - Google Gemini API access
- `BRAVE_API_KEY` - Brave Search API access

**Signal Bot**:
- `SIGNAL_NUMBER` - Bot phone number
- `ALLOWED_USERS` - Comma-separated authorized numbers
- `SIGNAL_API_URL` - signal-cli-rest-api endpoint
- `BACKEND_URL` - AssistedVoice backend URL
- `HA_TOKEN` - Home Assistant access token

### Configuration File (config.yaml)

**Server**:
```yaml
server:
  type: ollama  # ollama, lm-studio, openai, gemini
  host: localhost
  port: 11434
  timeout: 30
```

**LLM**:
```yaml
ollama:
  model: llama3.2:latest
  temperature: 0.7
  max_tokens: 500
  system_prompt: "You are a helpful assistant..."
  vision_model: ministral-3:8b
```

**Whisper**:
```yaml
whisper:
  mode: remote  # local or remote
  remote_url: http://sagan.local:5001/transcribe
  model: small
  language: en
  device: auto
```

**TTS**:
```yaml
tts:
  engine: edge-tts
  voice: en-US-JennyNeural
  rate: +0%
  volume: +40%
```

**Performance**:
```yaml
performance:
  cache_responses: true
  response_streaming: true
  parallel_processing: true
```

---

## Quick Reference

### Common Tasks

**Switch Model** (Web UI):
1. Click settings gear
2. Select Model tab
3. Choose model from list
4. Close settings

**Switch Model** (Signal):
1. Send `/model <model-name>`
2. Bot confirms switch

**Record Audio** (Web UI):
1. Press and hold microphone button
2. Speak your message
3. Release button to send

**Upload Image** (Web UI):
1. Click image icon
2. Select image file(s)
3. Type question
4. Send message

**Enable Live Mode** (Web UI):
1. Click "Live" button
2. Start speaking
3. View real-time transcript and insights

**Start Reading Mode** (Web UI):
1. Click "Reading Mode" button
2. Paste text or enter share code
3. Click "Start Reading"
4. Use playback controls

### Default Ports

- **Web Interface**: `5001`
- **Ollama**: `11434`
- **LM Studio**: `1234`
- **Signal API**: `8080`
- **Home Assistant**: `8123`

---

**Last Updated**: December 21, 2025
**Version**: AssistedVoice 1.0
