# AssistedVoice 🎤

A powerful local AI voice assistant that runs entirely on your Mac, featuring state-of-the-art speech recognition, language models, and text-to-speech capabilities.

## Features

### 🎯 Core Capabilities
- **100% Local & Private**: All processing happens on your device
- **Dual Mode Operation**: Text-only (silent) or voice interaction
- **Real-time Streaming**: See and hear responses as they generate
- **Push-to-Talk**: Hold SPACE to record, release to process
- **Voice Activity Detection**: Automatic speech detection

### 🚀 Optimized for Apple Silicon
- Metal Performance Shaders acceleration
- Whisper Turbo for fast transcription
- DeepSeek R1 8B for intelligent responses
- Sub-200ms first response latency

## Quick Start

### Prerequisites
- macOS (optimized for Apple Silicon)
- Python 3.8+
- 8GB+ RAM (16GB+ recommended)
- Homebrew installed

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/AssistedVoice.git
cd AssistedVoice

# 2. Run the setup script
./setup.sh

# This will:
# - Create a Python virtual environment
# - Install all dependencies
# - Download Whisper Turbo model
# - Pull DeepSeek R1 8B from Ollama
```

### Usage

#### Text-Only Mode (Silent)
Perfect for quiet environments or when you prefer text interaction:

```bash
./run.sh --mode text
```

#### Voice Mode
Full voice interaction with speech synthesis:

```bash
./run.sh --mode voice
```

#### Default Mode
Uses the mode specified in config.yaml:

```bash
./run.sh
```

## Controls

| Key | Action |
|-----|--------|
| **SPACE** | Hold to record (Push-to-Talk) |
| **M** | Toggle between text/voice mode |
| **C** | Clear conversation history |
| **H** | Show help |
| **Q** | Quit application |

## Configuration

Edit `config.yaml` to customize:

### Language Models
```yaml
ollama:
  model: "deepseek-r1:8b"     # Primary model
  fallback_model: "llama3.2:3b"  # Faster alternative
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
  engine: "macos"             # Options: macos, pyttsx3, none
  voice: "Samantha"           # macOS voice name
  rate: 180                   # Words per minute
```

## Models

### Recommended Setup (M1 Max with 64GB RAM)

| Component | Model | Performance |
|-----------|-------|------------|
| **LLM** | DeepSeek R1 8B | 68.5 tokens/sec, 145ms latency |
| **Speech** | Whisper Turbo | 5-8x faster than large models |
| **TTS** | macOS Samantha | Instant, zero latency |

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
├── assistant.py          # Main application
├── config.yaml          # Configuration
├── modules/
│   ├── stt.py          # Speech recognition (Whisper)
│   ├── llm.py          # Language model (Ollama)
│   ├── tts.py          # Text-to-speech engines
│   └── ui.py           # Terminal UI (Rich)
├── models/             # Downloaded Whisper models
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
ollama pull deepseek-r1:8b
ollama pull llama3.2:3b
```

### Permission Issues
```bash
# Grant terminal microphone access
System Preferences → Security & Privacy → Microphone → Terminal
```

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

### Running in Debug Mode
```bash
./run.sh --debug
```

### Using Different Models
```bash
./run.sh --model mistral:7b
```

### Minimal UI Mode
For a simpler interface without Rich formatting:

```bash
python3 assistant.py --config config.yaml
```

## Privacy & Security

- **No Internet Required**: Works completely offline
- **No Data Collection**: Your conversations stay on your device
- **No Cloud Services**: All processing is local
- **Open Source**: Fully auditable code

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