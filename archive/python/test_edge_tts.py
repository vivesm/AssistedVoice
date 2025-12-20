#!/usr/bin/env python3
"""Test Edge TTS functionality"""
import asyncio
import edge_tts

async def test_edge_tts():
    """Test basic Edge TTS generation"""
    print("Testing Edge TTS...")

    # Test with simple text
    text = "Hello, this is a test"
    output_file = "/tmp/test_edge_tts.mp3"

    try:
        print(f"Generating audio for: '{text}'")
        print(f"Voice: en-US-JennyNeural")

        communicate = edge_tts.Communicate(
            text,
            "en-US-JennyNeural",
            rate="+0%",
            volume="+40%",
            pitch="+0Hz"
        )

        await communicate.save(output_file)

        print(f"✓ Success! Audio saved to {output_file}")

        # Check file size
        import os
        file_size = os.path.getsize(output_file)
        print(f"File size: {file_size} bytes")

    except Exception as e:
        print(f"✗ Error: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_edge_tts())
