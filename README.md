# AssistedVoice 🎤

A powerful local AI voice assistant that runs entirely on your Mac, combining Whisper speech recognition with Ollama language models for completely private, offline AI conversations. Features a modern web interface with push-to-talk functionality.

## 🆕 Recent Updates

### January 2025
- **Request/Response Logging**: Comprehensive WebSocket logging system for debugging
  - ISO-timestamped logs for all requests, responses, and connection state changes
  - Visual connection state indicators (connecting, connected, disconnected, error)
  - Toggle-able logging via REQUEST_LOG_ENABLED flag
  - Browser console output with color-coded prefixes for easy debugging
- **Quick Mute Button**: New mute button in input bar for instant voice output toggle
  - One-click access to mute/unmute TTS without opening settings
  - Visual state indication with red accent when muted
  - Remembers previous TTS engine when unmuting
  - Syncs with settings panel voice selector
- **UI Improvements**: 
  - Removed distracting "Assistant • model" label from typing indicator
  - Fixed duplicate speaker buttons appearing on reload
  - Fixed chat deletion requiring two clicks (now works with single click)
- **AI Model Settings**: Advanced controls for fine-tuning AI behavior
  - Temperature slider (0.0-1.0) for response creativity control
  - Max tokens setting (50-2000) for response length management
  - System prompt customization with 5 preset templates
  - All settings persist across sessions and apply in real-time
- **Modern UI Redesign**: Clean, minimalist interface with glassmorphism effects
- **SVG Icons**: Replaced emojis with professional SVG icons throughout
- **Enhanced TTS Controls**: Voice engine selector (Edge TTS, macOS, or Text-only mode)
- **Message Replay**: Speaker button on assistant messages for instant TTS replay
- **Recording Visual Feedback**: Animated recording indicator with border glow
- **Improved Button Layout**: Voice button repositioned for better ergonomics
- **Flask Template Auto-reload**: Development mode with automatic template updates
- **Fixed TTS for Voice Input**: Proper TTS response for both voice and text messages
- **Code Cleanup**: Removed dead code, commented debug logs for production readiness

### December 2024
- **Performance Metrics**: Real-time display of response time, first token latency, and tokens/second
- **Enhanced Visual Feedback**: Typing dots animation, blinking cursor during streaming
- **Improved Project Structure**: Organized test suite and cleaner file naming
- **Better Loading States**: Progress bars and overlays for model switching

## Features

### 🎯 Core Capabilities
- **100% Local & Private**: All processing happens on your device
- **Modern Web Interface**: Clean, responsive UI with glassmorphism design
- **Push-to-Talk**: Click the microphone button to record with visual feedback
- **Text Input**: Type messages when you prefer not to speak
- **Performance Metrics**: Real-time display of response time, first token time, and tokens/second
- **Model Selection**: Switch between Ollama models on the fly with automatic fallback
- **Whisper Model Selection**: Choose from tiny, base, small, medium, large, or turbo models
- **Real-time Processing**: Fast responses with streaming support
- **AI Model Customization**:
  - Temperature control for response creativity (0.0 = focused, 1.0 = creative)
  - Max tokens setting for response length (50-2000 tokens)
  - Custom system prompts with preset templates (Default, Technical, Creative, Tutor, Concise)
- **Multiple TTS Options**: 
  - Edge TTS: Microsoft neural voices for natural speech
  - macOS: System voices for offline TTS
  - Text-only: Disable voice output entirely
- **TTS Replay**: Speaker button on each assistant message for instant replay
- **Visual Feedback**: Recording animations, typing indicators, and loading states
- **Conversation Persistence**: Chat history with metadata survives browser refreshes
- **Model Identification**: Each response shows which model generated it

### 🚀 Optimized for Apple Silicon
- Metal Performance Shaders acceleration
- Whisper models for accurate transcription
- Multiple Ollama models available
- Fast response times with local processing

## Quick Start

### Prerequisites
- macOS (optimized for Apple Silicon)
- Python 3.8+
- 8GB+ RAM (16GB+ recommended)
- Homebrew installed

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/vivesm/AssistedVoice.git
cd AssistedVoice

# 2. Install Ollama (if not already installed)
curl -fsSL https://ollama.com/install.sh | sh

# 3. Pull an Ollama model
ollama pull llama3.2:3b  # Fast, lightweight
# or
ollama pull deepseek-r1:8b  # Better quality
# or
ollama pull mistral:7b  # Good balance

# 4. Run the setup script
./setup.sh

# This will:
# - Create a Python virtual environment
# - Install all dependencies
# - Download Whisper model
```

### Usage

#### Start the Application

```bash
# 1. Start Ollama (if not already running)
ollama serve

# 2. Start AssistedVoice
./start.sh

# 3. Open your browser to:
http://localhost:5001
```

#### Using the Web Interface

1. **Voice Input**: Click and hold the microphone button, speak, then release
2. **Text Input**: Type in the text box and press Enter or click Send
3. **Model Selection**: Choose your preferred Ollama model from the dropdown (if available)
4. **Clear Chat**: Click the Clear Chat button to start fresh

## Web Interface Controls

| Control | Action |
|---------|--------|
| **Microphone Button** | Click and hold to record voice |
| **Mute Button** | Toggle voice output on/off instantly |
| **Text Input** | Type messages directly |
| **Send Button** | Send typed message |
| **Clear Button** | Clear conversation history |
| **Speaker Button (🔊)** | Replay any assistant message with TTS |
| **Model Selector** | Switch between Ollama models with automatic fallback |
| **Whisper Selector** | Choose speech recognition model (tiny to turbo) |
| **Voice Engine** | Select TTS engine: Neural (Edge), Classic (macOS), or Text Only |
| **Voice Selector** | Choose specific voice for selected TTS engine |

## Configuration

Edit `config.yaml` to customize:

### Language Models
```yaml
ollama:
  model: "llama3.2:3b"        # Primary model (change to any installed model)
  fallback_model: "mistral:7b"  # Fallback if primary fails
  temperature: 0.7             # Response creativity (0.0-1.0)
```

### Speech Recognition
```yaml
whisper:
  model: "turbo"              # Options: tiny, base, small, medium, large, turbo
  language: "en"              # Language code
```

### Text-to-Speech
```yaml
tts:
  engine: "edge-tts"          # Options: edge-tts, macos, pyttsx3, none
  
  # Edge TTS voices (realistic neural voices)
  edge_voice: "en-US-JennyNeural"  # Female US voice
  # Other options:
  # - en-US-GuyNeural (Male US)
  # - en-US-AriaNeural (Female US, younger)
  # - en-GB-SoniaNeural (Female British)
  # - en-GB-RyanNeural (Male British)
  # Run: edge-tts --list-voices for full list
  
  # macOS voices
  voice: "Samantha"           # macOS voice name
  rate: 180                   # Words per minute
```

## Models

### Recommended Models by Hardware

#### 8GB RAM
| Component | Model | Notes |
|-----------|-------|-------|
| **LLM** | llama3.2:3b | Fast and lightweight |
| **Speech** | Whisper base/small | Good balance |
| **TTS** | None (text-only) | Saves resources |

#### 16GB+ RAM
| Component | Model | Notes |
|-----------|-------|-------|
| **LLM** | deepseek-r1:8b or mistral:7b | Better quality |
| **Speech** | Whisper turbo/large | Best accuracy |
| **TTS** | macOS voices | Native and fast |

### Alternative Models

#### For Faster Response:
- **LLM**: Llama 3.2 3B or TinyLlama 1.1B
- **Speech**: Whisper base or small

#### For Better Quality:
- **LLM**: DeepSeek R1 32B (needs 20GB VRAM)
- **Speech**: Whisper large-v3

## Architecture

```
AssistedVoice/
├── web_assistant.py       # Main Flask application
├── config.yaml           # Configuration
├── modules/
│   ├── stt.py           # Speech recognition (Whisper)
│   ├── llm.py           # Language model (Ollama)
│   ├── tts.py           # Text-to-speech engines
│   └── ui.py            # Terminal UI (legacy)
├── static/              # Frontend assets
│   ├── app.js          # JavaScript with performance tracking
│   └── style.css       # Enhanced styling with metrics
├── templates/          # HTML templates
│   └── index.html      # Main web UI
├── tests/              # Test suite
│   ├── unit/          # Unit tests
│   └── integration/   # Integration tests
├── archive/           # Legacy versions
├── models/            # Downloaded Whisper models
└── logs/              # Conversation logs
```

## Performance Optimization

### For Apple Silicon (M1/M2/M3)
The system automatically detects and uses Metal Performance Shaders for acceleration.

### Memory Usage
- **Minimum**: 8GB RAM (with small models)
- **Recommended**: 16GB RAM
- **Optimal**: 32GB+ RAM (for larger models)

### Model Download Times
- Whisper Turbo: ~2-3 minutes
- DeepSeek R1 8B: ~5-10 minutes
- Llama 3.2 3B: ~2-3 minutes

## Troubleshooting

### Ollama Not Running
```bash
# Start Ollama service
ollama serve

# Check available models
ollama list
```

### Audio Issues on macOS
```bash
# Install PortAudio for Apple Silicon
brew install portaudio

# Reinstall PyAudio
pip uninstall pyaudio
pip install --no-cache-dir pyaudio
```

### Model Not Found
```bash
# Pull the model manually
ollama pull llama3.2:3b
ollama pull mistral:7b
ollama pull deepseek-r1:8b
```

### Permission Issues
```bash
# Grant terminal microphone access
System Preferences → Security & Privacy → Microphone → Terminal
```

## Enhanced User Experience

### Performance Metrics
Each assistant response displays real-time performance metrics:
- **Total Response Time**: Complete time from question to answer (e.g., "2.14s total")
- **First Token Time**: Latency to first response chunk (e.g., "0.31s first")
- **Tokens Per Second**: Generation speed (e.g., "18.5 tokens/s")

Metrics appear as subtle blue badges below each message, helping you understand model performance and identify any latency issues.

### Developer Tools & Debugging

**Request/Response Logging**
The application includes comprehensive logging for debugging and observability:
- All WebSocket requests and responses are logged with ISO timestamps
- Connection state changes are tracked and logged (connecting, connected, disconnected, error)
- Enable/disable logging via `REQUEST_LOG_ENABLED` flag in `static/app.js`
- Logs appear in browser console with color-coded prefixes:
  - `[REQUEST]` - Outgoing WebSocket events
  - `[RESPONSE]` - Incoming WebSocket events
  - `[CONNECTION]` - Connection state changes

**Example Console Output:**
```
[CONNECTION] 2025-01-22T19:30:00.123Z - State: connecting Initializing WebSocket connection
[CONNECTION] 2025-01-22T19:30:01.456Z - State: connected Successfully connected to server
[REQUEST] 2025-01-22T19:30:15.789Z - process_text {textLength: 21, enable_tts: true}
[RESPONSE] 2025-01-22T19:30:16.012Z - response_chunk {model: "llama3.2:3b", length: 42}
```

This logging system helps diagnose:
- WebSocket connection issues
- Request/response timing
- Model selection problems
- TTS and audio processing issues

### Visual Feedback
- **Typing Dots Animation**: Animated dots appear while the assistant is generating a response
- **Blinking Cursor**: Visual indicator during streaming responses
- **Loading Overlays**: Full-screen loading indicators with progress bars for model operations
- **Status Indicators**: Real-time status updates (Ready, Recording, Processing, Speaking)
- **Model Identification**: Each assistant response shows which model generated it
- **Speaker Buttons**: Click the 🔊 button on any assistant message to replay it with TTS
- **Conversation Persistence**: Chat history automatically saves and restores on page refresh

### Performance Optimizations
- **Model Fallback**: Automatic fallback to working models when problematic models are selected
- **Fast Model Switching**: Instant switching between available Ollama models
- **Optimized Whisper**: Direct turbo model support for fastest speech recognition
- **Streaming Responses**: Real-time response generation with visual indicators

## Advanced Features

### Custom System Prompts
Edit the `system_prompt` in config.yaml to customize the assistant's personality:

```yaml
ollama:
  system_prompt: |
    You are a helpful coding assistant specializing in Python.
    Provide concise, accurate responses with code examples.
```

### Conversation History
Conversations are automatically saved to `logs/` directory with timestamps.

### Response Caching
Common responses are cached for instant replies. Configure in:

```yaml
performance:
  cache_responses: true
  max_cache_size: 100
```

## Development

### Running in Development Mode
```bash
# Make sure Ollama Server is running
ollama serve

# Activate virtual environment
source venv/bin/activate

# Run the web server
python web_assistant.py
```

### Using Different Ports
```bash
# Edit web_assistant.py and change:
app.run(host='0.0.0.0', port=5001)  # Change 5001 to your preferred port
```

## Privacy & Security

### Privacy Features
- **No Internet Required**: Works completely offline
- **No Data Collection**: Your conversations stay on your device
- **No Cloud Services**: All processing is local
- **Open Source**: Fully auditable code

### Production Security Best Practices

When deploying AssistedVoice, follow these security recommendations:

#### 1. Environment Configuration
```bash
# Copy the example environment file
cp .env.example .env

# Generate a secure SECRET_KEY
python3 -c "import secrets; print(secrets.token_hex(32))"

# Add it to .env
echo "SECRET_KEY=your-generated-key-here" >> .env
```

#### 2. CORS Configuration
In production, restrict CORS to specific origins:
```bash
# In .env file
CORS_ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

#### 3. Debug Mode
Disable debug mode in production for better performance and security:
```bash
# In .env file
FLASK_DEBUG=False
```

#### 4. Network Binding
For localhost-only access, bind to 127.0.0.1:
```bash
# In .env file
HOST=127.0.0.1
```

#### 5. File Permissions
Ensure `.env` file is not readable by others:
```bash
chmod 600 .env
```

**Note**: The `.env` file is automatically ignored by git to prevent accidentally committing secrets.

## Contributing

Contributions are welcome! Please feel free to submit pull requests.

## License

MIT License - See LICENSE file for details

## Acknowledgments

- OpenAI Whisper for speech recognition
- Ollama for local LLM hosting
- DeepSeek for the R1 model
- Rich for beautiful terminal UI

---

**Enjoy your private, local AI assistant!** 🚀

For issues or questions, please open a GitHub issue.