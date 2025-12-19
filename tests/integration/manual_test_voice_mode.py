#!/usr/bin/env python3
"""
Test voice mode without keyboard module
Press Enter to start/stop recording
"""
import sys
import os
import yaml
import time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from modules.stt import WhisperSTT
from modules.llm import OllamaLLM
from modules.tts import create_tts_engine


def main():
    # Load config
    with open('config.yaml', 'r') as f:
        config = yaml.safe_load(f)
    
    print("Initializing voice components...")
    stt = WhisperSTT(config)
    llm = OllamaLLM(config)
    tts = create_tts_engine(config)

    
    print("\n" + "="*60)
    print("Voice Mode Test - No keyboard module required")
    print("="*60)
    print("\nControls:")
    print("  - Press ENTER to start recording")
    print("  - Speak your message")
    print("  - Press ENTER again to stop recording")
    print("  - Type 'quit' to exit")
    print("  - Type 'text' to type a message instead")
    print("\n" + "="*60)
    
    while True:
        try:
            command = input("\n[Press ENTER to record, 'text' to type, or 'quit' to exit]: ").strip()
            
            if command.lower() == 'quit':
                print("\nGoodbye!")
                break
            
            if command.lower() == 'text':
                # Text input mode
                user_input = input("Type your message: ").strip()
                if not user_input:
                    continue
            else:
                # Voice input mode
                print("\n🎤 Recording... (speak now, press ENTER when done)")
                
                # Start recording in background
                import threading
                import queue
                
                audio_queue = queue.Queue()
                stop_recording = threading.Event()
                
                def record_worker():
                    audio = stt.record_audio(duration=30.0, use_vad=False)  # Max 30 seconds
                    audio_queue.put(audio)
                
                record_thread = threading.Thread(target=record_worker)
                record_thread.daemon = True
                record_thread.start()
                
                # Wait for Enter to stop
                input()
                stop_recording.set()
                
                print("⏸️  Stopped recording. Processing...")
                
                # Get the audio (wait max 1 second)
                try:
                    audio = audio_queue.get(timeout=1.0)
                    user_input = stt.transcribe(audio)
                    
                    if not user_input:
                        print("❌ No speech detected. Try again.")
                        continue
                    
                    print(f"\n📝 You said: {user_input}")
                except:
                    print("❌ Recording failed. Try again.")
                    continue
            
            # Generate response
            print("\n💭 Thinking...")
            response = ""
            for chunk in llm.generate(user_input, stream=True):
                response += chunk
            
            print(f"\n🤖 Assistant: {response}")
            
            # Speak the response
            if config['tts']['engine'] != 'none':
                print("🔊 Speaking...")
                tts.speak(response)
            
        except KeyboardInterrupt:
            print("\n\nGoodbye!")
            break
        except Exception as e:
            print(f"\n❌ Error: {e}")
            continue

if __name__ == "__main__":
    main()