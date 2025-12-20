import os
import sys
import base64
import asyncio

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from modules.tts import EdgeTTS

def test_edge_tts_generates_mp3():
    """Test that Edge TTS generates MP3 audio"""
    config = {
        'tts': {
            'edge_voice': 'en-US-JennyNeural',
            'rate': '+0%',
            'volume': '+0%',
            'pitch': '+0Hz'
        }
    }
    
    print("Initializing EdgeTTS...")
    tts = EdgeTTS(config)
    
    # Test text
    text = "This is a test of the Edge TTS system."
    
    print(f"Generating audio for text: '{text}'")
    # Generate audio
    result = tts.generate_audio_base64(text)
    
    if result is None:
        print("ERROR: Result is None")
        return

    # Validate result
    if not result.startswith("data:audio/mp3;base64,"):
        print(f"ERROR: Incorrect format. Start: {result[:30]}")
        return
    
    # Decode and check 
    b64_data = result.split(',')[1]
    audio_data = base64.b64decode(b64_data)
    
    print(f"Successfully generated MP3 audio. Size: {len(audio_data)} bytes")
    
    # Optional: Save to file to manual check
    with open("test_edge_output.mp3", "wb") as f:
        f.write(audio_data)
    print("Saved to test_edge_output.mp3")

if __name__ == "__main__":
    test_edge_tts_generates_mp3()
