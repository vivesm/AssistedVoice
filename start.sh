#!/bin/bash

# Start AssistedVoice - Simple Push to Talk

echo "Starting AssistedVoice..."

# Activate virtual environment
source venv/bin/activate

# Start the web assistant server
python3 web_assistant.py