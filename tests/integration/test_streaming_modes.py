#!/usr/bin/env python3
"""
Test script for AssistedVoice streaming modes
Tests all three conversation modes
"""

import time
import base64
import socketio
import pytest
import sys
from pathlib import Path

# Create a Socket.IO client
sio = socketio.Client()

# Connection events
@sio.event
def connect():
    print("✓ Connected to server")

@sio.event
def disconnect():
    print("× Disconnected from server")

@sio.on('connected')
def on_connected(data):
    print(f"Server says: {data['status']}")

@sio.on('status')
def on_status(data):
    print(f"Status: {data['message']} ({data['type']})")

@sio.on('partial_transcription')
def on_partial(data):
    print(f"Partial: {data['text']}")

@sio.on('transcription')
def on_transcription(data):
    print(f"Final: {data['text']}")

@sio.on('response_chunk')
def on_response_chunk(data):
    print(f"AI: {data['text']}", end='')

@sio.on('response_complete')
def on_response_complete(data):
    print(f"\nAI Complete: {data['text'][:50]}...")

@sio.on('error')
def on_error(data):
    print(f"Error: {data['message']}")

@pytest.fixture(scope="module", autouse=True)
def setup_connection():
    try:
        print("Connecting to AssistedVoice streaming server...")
        sio.connect('http://localhost:5001', wait_timeout=10)
        time.sleep(1)
        yield
    except Exception as e:
        pytest.fail(f"Failed to connect to server: {e}")
    finally:
        if sio.connected:
            sio.disconnect()

def test_text_mode():
    """Test basic text input"""
    print("\n=== Testing Text Mode ===")
    sio.emit('process_text', {'text': 'Hello, this is a test message'})
    time.sleep(5)

def test_ptt_mode():
    """Test Push-to-Talk mode"""
    print("\n=== Testing Push-to-Talk Mode ===")
    # Simulate audio data (normally from microphone)
    dummy_audio = base64.b64encode(b'dummy_audio_data').decode()
    sio.emit('process_audio', {'audio': f'data:audio/webm;base64,{dummy_audio}'})
    time.sleep(3)

def test_continuous_mode():
    """Test Continuous mode"""
    print("\n=== Testing Continuous Mode ===")
    sio.emit('start_continuous_mode', {})
    time.sleep(1)
    
    # Simulate streaming audio chunks
    for i in range(5):
        dummy_audio = base64.b64encode(f'chunk_{i}'.encode()).decode()
        sio.emit('audio_stream_continuous', {
            'audio': f'data:audio/webm;base64,{dummy_audio}',
            'timestamp': time.time()
        })
        time.sleep(0.1)
    
    time.sleep(2)
    sio.emit('stop_continuous_mode', {})

def test_smart_mode():
    """Test Smart Pause mode"""
    print("\n=== Testing Smart Pause Mode ===")
    sio.emit('start_smart_mode', {'settings': {'pauseDuration': 1500}})
    time.sleep(1)
    
    # Simulate audio with pauses
    for i in range(3):
        dummy_audio = base64.b64encode(f'smart_chunk_{i}'.encode()).decode()
        sio.emit('audio_stream_smart', {
            'audio': f'data:audio/webm;base64,{dummy_audio}',
            'timestamp': time.time()
        })
        time.sleep(0.5)
    
    time.sleep(2)
    sio.emit('stop_smart_mode', {})

if __name__ == '__main__':
    # For manual running
    try:
        print("Connecting to AssistedVoice streaming server...")
        sio.connect('http://localhost:5001')
        time.sleep(1)
        
        test_text_mode()
        test_ptt_mode()
        test_continuous_mode()
        test_smart_mode()
        
        print("\n=== Clearing Conversation ===")
        sio.emit('clear_conversation', {})
        time.sleep(1)
        
        print("\n✓ All tests completed")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        if sio.connected:
            sio.disconnect()