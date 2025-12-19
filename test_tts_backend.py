
import asyncio
import edge_tts
import os

async def test():
    text = "Hello, this is a test of the Microsoft Neural voice."
    voice = "en-US-JennyNeural"
    output = "test_output.mp3"
    
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output)
    
    if os.path.exists(output) and os.path.getsize(output) > 0:
        print(f"SUCCESS: Generated {output} ({os.path.getsize(output)} bytes)")
        # Clean up
        os.remove(output)
    else:
        print("FAILURE: Could not generate audio file")

if __name__ == "__main__":
    asyncio.run(test())
