#!/usr/bin/env python3
"""
Simple microphone test
"""
import sounddevice as sd
import numpy as np
import time

def test_microphone():
    print("Microphone Test")
    print("="*40)
    
    # List audio devices
    print("\nAvailable audio devices:")
    devices = sd.query_devices()
    for i, device in enumerate(devices):
        if device['max_input_channels'] > 0:
            default = " (DEFAULT)" if i == sd.default.device[0] else ""
            print(f"  [{i}] {device['name']} - {device['max_input_channels']} channels{default}")
    
    print("\nTesting default microphone...")
    print("Speak now for 3 seconds...")
    
    # Record 3 seconds
    sample_rate = 16000
    duration = 3
    recording = sd.rec(int(duration * sample_rate), 
                      samplerate=sample_rate, 
                      channels=1, 
                      dtype='float32')
    
    # Show level meter while recording
    for i in range(duration):
        time.sleep(1)
        print(f"  Recording... {i+1}/{duration} seconds")
    
    sd.wait()
    
    # Check if we got audio
    max_amplitude = np.max(np.abs(recording))
    avg_amplitude = np.mean(np.abs(recording))
    
    print(f"\nRecording complete!")
    print(f"  Max amplitude: {max_amplitude:.4f}")
    print(f"  Avg amplitude: {avg_amplitude:.6f}")
    
    if max_amplitude < 0.001:
        print("\n❌ No audio detected! Check your microphone:")
        print("  - Is it connected?")
        print("  - Is it selected as default input?")
        print("  - Check System Settings > Sound > Input")
        print("  - You may need to grant Terminal microphone permission")
    elif max_amplitude < 0.01:
        print("\n⚠️  Very low audio level detected")
        print("  - Try speaking louder")
        print("  - Check microphone volume in System Settings")
    else:
        print("\n✅ Microphone is working!")
        print(f"  Detected audio with good levels")
    
    # Play back the recording
    if max_amplitude > 0.001:
        # Skip interactive part if running in pytest
        import sys
        if 'pytest' in sys.modules:
            print("\nSkipping playback (running in test mode)")
            return

        response = input("\nPlay back the recording? (y/n): ")
        if response.lower() == 'y':
            print("Playing back...")
            sd.play(recording, sample_rate)
            sd.wait()
            print("Playback complete")

if __name__ == "__main__":
    test_microphone()