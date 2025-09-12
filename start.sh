#!/bin/bash

# Start AssistedVoice - Simple Push to Talk

echo "Starting AssistedVoice..."

# Activate virtual environment
source venv/bin/activate

# Start the simple push-to-talk server
python3 web_assistant_simple.py