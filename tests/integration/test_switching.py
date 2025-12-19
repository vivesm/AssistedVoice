#!/usr/bin/env python3
"""
Test script for model and TTS switching
"""
import socketio
import time
import sys

def test_model_switching():
    """Test switching between different Ollama models"""
    sio = socketio.Client()
    results = []
    
    @sio.on('connect')
    def on_connect():
        print("✓ Connected to server")
    
    @sio.on('model_changed')
    def on_model_changed(data):
        print(f"✓ Model changed to: {data['model']}")
        results.append(('success', data['model']))
    
    @sio.on('error')
    def on_error(data):
        print(f"✗ Error: {data['message']}")
        results.append(('error', data['message']))
    
    @sio.on('tts_changed')
    def on_tts_changed(data):
        print(f"✓ TTS changed - Engine: {data.get('engine')}, Voice: {data.get('voice')}")
        results.append(('tts_success', data))
    
    try:
        # Connect to server
        print("\n=== Testing Model and TTS Switching ===\n")
        sio.connect('http://localhost:5001')
        time.sleep(1)
        
        # Test 1: Switch to mistral:latest
        print("\n1. Testing switch to mistral:latest...")
        sio.emit('change_model', {'model': 'mistral:latest'})
        time.sleep(2)
        
        # Test 2: Switch to model with version tag
        print("\n2. Testing switch to mistral:7b...")
        sio.emit('change_model', {'model': 'mistral:7b'})
        time.sleep(2)
        
        # Test 3: Switch to llama2
        print("\n3. Testing switch to llama2...")
        sio.emit('change_model', {'model': 'llama2'})
        time.sleep(2)
        
        # Test 4: Try non-existent model
        print("\n4. Testing error handling with non-existent model...")
        sio.emit('change_model', {'model': 'nonexistent:model'})
        time.sleep(2)
        
        # Test 5: Switch back to llama3.2:3b
        print("\n5. Testing switch back to llama3.2:3b...")
        sio.emit('change_model', {'model': 'llama3.2:3b'})
        time.sleep(2)
        
        # Test TTS Engine switching
        print("\n=== Testing TTS Engine Switching ===\n")
        
        # Test 6: Switch to Classic (macOS)
        print("\n6. Testing switch to Classic voice...")
        sio.emit('change_tts', {'engine': 'macos', 'voice': 'Samantha'})
        time.sleep(1)
        
        # Test 7: Switch to Neural (Edge TTS)
        print("\n7. Testing switch to Neural voice...")
        sio.emit('change_tts', {'engine': 'edge-tts', 'voice': 'en-US-JennyNeural'})
        time.sleep(1)
        
        # Test 8: Switch to Text Only
        print("\n8. Testing switch to Text Only mode...")
        sio.emit('change_tts', {'engine': 'none', 'voice': ''})
        time.sleep(1)
        
        # Print summary
        print("\n=== Test Summary ===")
        success_count = sum(1 for r in results if r[0] in ['success', 'tts_success'])
        error_count = sum(1 for r in results if r[0] == 'error')
        print(f"✓ Successful switches: {success_count}")
        print(f"✗ Errors: {error_count}")
        
        # Disconnect
        sio.disconnect()
        print("\n✓ Test completed")
        
    except Exception as e:
        print(f"✗ Test failed: {e}")
        sys.exit(1)

if __name__ == '__main__':
    test_model_switching()