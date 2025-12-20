#!/bin/bash

# AssistedVoice Setup Script
# Sets up the environment and downloads required models

set -e

echo "════════════════════════════════════════════════════════════"
echo "           AssistedVoice - Setup Script                    "
echo "════════════════════════════════════════════════════════════"
echo

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Python version
echo "Checking Python version..."
python_version=$(python3 --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
required_version="3.8"

if [ "$(printf '%s\n' "$required_version" "$python_version" | sort -V | head -n1)" = "$required_version" ]; then 
    echo -e "${GREEN}✓${NC} Python $python_version is installed"
else
    echo -e "${RED}✗${NC} Python $python_version is too old. Please install Python 3.8 or newer."
    exit 1
fi

# Create virtual environment
echo
echo "Creating Python virtual environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
    echo -e "${GREEN}✓${NC} Virtual environment created"
else
    echo -e "${YELLOW}!${NC} Virtual environment already exists"
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo
echo "Upgrading pip..."
pip install --upgrade pip --quiet

# Install Python dependencies
echo
echo "Installing Python dependencies..."
pip install -r requirements.txt

echo -e "${GREEN}✓${NC} Python dependencies installed"

# Check if Ollama is installed
echo
echo "Checking Ollama installation..."
if command -v ollama &> /dev/null; then
    echo -e "${GREEN}✓${NC} Ollama is installed"
    
    # Check if Ollama is running
    if ollama list &> /dev/null; then
        echo -e "${GREEN}✓${NC} Ollama service is running"
    else
        echo -e "${YELLOW}!${NC} Starting Ollama service..."
        ollama serve &
        sleep 3
    fi
else
    echo -e "${RED}✗${NC} Ollama is not installed"
    echo "Please install Ollama from: https://ollama.ai"
    echo "Run: curl -fsSL https://ollama.ai/install.sh | sh"
    exit 1
fi

# Download recommended models
echo
echo "════════════════════════════════════════════════════════════"
echo "                    Model Installation                      "
echo "════════════════════════════════════════════════════════════"
echo

echo "Checking/downloading recommended LLM models..."
echo

# Function to check and pull model
check_and_pull_model() {
    local model=$1
    local description=$2
    
    echo "Checking $model ($description)..."
    if ollama list | grep -q "$model"; then
        echo -e "${GREEN}✓${NC} $model is already installed"
    else
        echo -e "${YELLOW}→${NC} Downloading $model..."
        if ollama pull "$model"; then
            echo -e "${GREEN}✓${NC} $model downloaded successfully"
        else
            echo -e "${YELLOW}!${NC} Failed to download $model (will continue)"
        fi
    fi
    echo
}

# Download primary model
check_and_pull_model "deepseek-r1:8b" "Primary model - Best reasoning"

# Download fallback models
echo "Optional models (you can skip these):"
check_and_pull_model "llama3.2:3b" "Fast fallback model"
check_and_pull_model "mistral:7b" "Alternative model"

# Download Whisper model
echo
echo "Setting up Whisper speech recognition..."
python3 -c "
from faster_whisper import WhisperModel
import os

model_name = 'base'
print(f'Downloading Whisper {model_name} model...')
try:
    # This will download the model if not already cached
    model = WhisperModel(model_name, device='auto', compute_type='float16', download_root='./models')
    print('✓ Whisper model downloaded successfully')
except Exception as e:
    print(f'! Could not download Whisper model: {e}')
    print('  The model will be downloaded on first use.')
"

# Create run script
echo
echo "Creating run script..."
cat > run.sh << 'EOF'
#!/bin/bash
# AssistedVoice Run Script

# Activate virtual environment
source venv/bin/activate

# Check if Ollama is running
if ! ollama list &> /dev/null; then
    echo "Starting Ollama service..."
    ollama serve &
    sleep 3
fi

# Run the assistant
python3 assistant.py "$@"
EOF

chmod +x run.sh
echo -e "${GREEN}✓${NC} Run script created"

# Final instructions
echo
echo "════════════════════════════════════════════════════════════"
echo "                    Setup Complete!                         "
echo "════════════════════════════════════════════════════════════"
echo
echo "To start the assistant:"
echo
echo "  1. Text-only mode (silent):"
echo "     ${GREEN}./run.sh --mode text${NC}"
echo
echo "  2. Voice mode (with speech):"
echo "     ${GREEN}./run.sh --mode voice${NC}"
echo
echo "  3. Default mode (from config):"
echo "     ${GREEN}./run.sh${NC}"
echo
echo "Controls:"
echo "  • Hold SPACE to record (push-to-talk)"
echo "  • Press M to toggle text/voice mode"
echo "  • Press C to clear conversation"
echo "  • Press Q to quit"
echo
echo "Enjoy your local AI assistant! 🎤"