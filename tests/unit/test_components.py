#!/usr/bin/env python3
"""
Comprehensive test script for AssistedVoice
Tests all critical components and dependencies
"""
import sys
import os
import traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def test_imports():
    """Test all required imports"""
    print("="*60)
    print("Testing imports...")
    print("="*60)
    
    results = []
    
    # Test core dependencies
    imports_to_test = [
        ("faster_whisper", "from faster_whisper import WhisperModel"),
        ("ollama", "import ollama"),
        ("rich", "from rich.console import Console"),
        ("sounddevice", "import sounddevice"),
        ("numpy", "import numpy"),
        ("pyaudio", "import pyaudio"),
        ("webrtcvad", "import webrtcvad"),
        ("yaml", "import yaml"),
        ("keyboard", "import keyboard"),
        ("pyttsx3", "import pyttsx3"),
    ]
    
    for name, import_stmt in imports_to_test:
        try:
            exec(import_stmt)
            print(f"✓ {name} imported successfully")
            results.append((name, True, None))
        except Exception as e:
            print(f"✗ {name} import failed: {e}")
            results.append((name, False, str(e)))
    
    # Test local modules
    print("\nTesting local modules...")
    local_modules = [
        ("modules.stt", "WhisperSTT"),
        ("modules.llm", "OllamaLLM"),
        ("modules.tts", "create_tts_engine"),
        ("modules.ui", "TerminalUI, MinimalUI"),
    ]
    
    for module_path, classes in local_modules:
        try:
            exec(f"from {module_path} import {classes}")
            print(f"✓ {module_path} imported ({classes})")
            results.append((module_path, True, None))
        except Exception as e:
            print(f"✗ {module_path} import failed: {e}")
            results.append((module_path, False, str(e)))
    
    # Check for critical failures
    critical_failures = [r for r in results if not r[1] and r[0] in [
        "faster_whisper", "ollama", "modules.stt", "modules.llm"
    ]]
    
    if critical_failures:
        print(f"\n⚠️  Critical import failures detected: {[f[0] for f in critical_failures]}")
        return False
    
    return all(r[1] for r in results)

def test_whisper():
    """Test Whisper/faster-whisper setup"""
    print("\n" + "="*60)
    print("Testing Whisper speech recognition...")
    print("="*60)
    
    try:
        from faster_whisper import WhisperModel
        
        # Try to load a small model
        print("Loading Whisper model (this may download on first run)...")
        # Use int8 for Apple Silicon
        model = WhisperModel("tiny", device="auto", compute_type="int8")
        
        # Test with dummy audio (silence)
        import numpy as np
        dummy_audio = np.zeros(16000, dtype=np.float32)  # 1 second of silence
        
        print("Testing transcription on dummy audio...")
        segments, info = model.transcribe(dummy_audio, language="en")
        
        # Convert generator to list to test
        segment_list = list(segments)
        
        print(f"✓ Whisper model loaded and tested successfully")
        print(f"  Model can process audio (got {len(segment_list)} segments)")
        return True
        
    except Exception as e:
        print(f"✗ Whisper test failed: {e}")
        traceback.print_exc()
        return False

def test_ollama():
    """Test Ollama connection and models"""
    print("\n" + "="*60)
    print("Testing Ollama connection...")
    print("="*60)
    
    try:
        import ollama
        client = ollama.Client()
        
        # Test connection
        models = client.list()
        
        # Handle different response formats
        if hasattr(models, 'models'):
            model_list = [getattr(m, 'name', getattr(m, 'model', str(m))) for m in models.models]
        else:
            model_list = []
        
        print(f"✓ Connected to Ollama")
        print(f"  Available models: {model_list[:5]}")
        
        if not model_list:
            print("⚠️  No models found. Please run 'ollama pull llama3.2:3b'")
            return False
        
        # Test if required models are available
        required_models = ["llama3.2:3b", "mistral:latest", "deepseek-r1:8b"]
        available_required = [m for m in required_models if any(m in str(model) for model in model_list)]
        
        if available_required:
            print(f"✓ Found required models: {available_required}")
        else:
            print(f"⚠️  None of the recommended models found. Available: {model_list[:3]}")
            print(f"   Recommended: {required_models}")
        
        return len(model_list) > 0
        
    except Exception as e:
        print(f"✗ Ollama connection failed: {e}")
        print("  Make sure Ollama is running: 'ollama serve'")
        return False

def test_llm_query():
    """Test actual LLM query"""
    print("\n" + "="*60)
    print("Testing LLM query...")
    print("="*60)
    
    try:
        from modules.llm import OllamaLLM
        from modules.ui import MinimalUI
        
        config = {
            'ollama': {
                'model': 'llama3.2:3b',
                'fallback_model': 'mistral:latest',
                'temperature': 0.7,
                'max_tokens': 100,
                'system_prompt': 'You are a helpful assistant. Keep responses very brief.'
            },
            'ui': {'show_timestamps': False}
        }
        
        llm = OllamaLLM(config)
        ui = MinimalUI(config)
        
        test_prompt = "Say hello in exactly 5 words."
        print(f"Prompt: {test_prompt}")
        print("Response: ", end="")
        
        response = ""
        for chunk in llm.generate(test_prompt, stream=True):
            response += chunk
            print(chunk, end="", flush=True)
        
        print()
        print(f"✓ LLM query successful (got {len(response.split())} words)")
        return True
        
    except Exception as e:
        print(f"✗ LLM query failed: {e}")
        traceback.print_exc()
        return False

def test_audio():
    """Test audio setup"""
    print("\n" + "="*60)
    print("Testing audio setup...")
    print("="*60)
    
    try:
        import sounddevice as sd
        import pyaudio
        
        # Test sounddevice
        devices = sd.query_devices()
        print(f"✓ Sounddevice working ({len(devices)} devices found)")
        
        # Test PyAudio
        p = pyaudio.PyAudio()
        device_count = p.get_device_count()
        p.terminate()
        print(f"✓ PyAudio working ({device_count} devices found)")
        
        # Test VAD
        import webrtcvad
        vad = webrtcvad.Vad(2)
        print(f"✓ WebRTC VAD initialized")
        
        return True
        
    except Exception as e:
        print(f"✗ Audio test failed: {e}")
        return False

def test_config():
    """Test configuration loading"""
    print("\n" + "="*60)
    print("Testing configuration...")
    print("="*60)
    
    try:
        import yaml
        
        if not os.path.exists('config.yaml'):
            print("✗ config.yaml not found")
            return False
        
        with open('config.yaml', 'r') as f:
            config = yaml.safe_load(f)
        
        # Check required sections
        required_sections = ['whisper', 'ollama', 'ui', 'audio', 'tts']
        missing = [s for s in required_sections if s not in config]
        
        if missing:
            print(f"✗ Missing config sections: {missing}")
            return False
        
        print(f"✓ Configuration loaded successfully")
        print(f"  Model: {config['ollama']['model']}")
        print(f"  UI mode: {config['ui']['mode']}")
        print(f"  TTS engine: {config['tts']['engine']}")
        
        return True
        
    except Exception as e:
        print(f"✗ Config test failed: {e}")
        return False

def test_end_to_end():
    """Test complete end-to-end flow in text mode"""
    print("\n" + "="*60)
    print("Testing end-to-end text mode...")
    print("="*60)
    
    try:
        import subprocess
        
        # Test with a simple query
        test_input = "What is 2+2?\nquit\n"
        
        print("Running assistant in text mode with test query: 'What is 2+2?'")
        
        # Run the test script
        result = subprocess.run(
            ['python3', 'test_text_mode.py'],
            input=test_input,
            capture_output=True,
            text=True,
            timeout=10
        )
        
        # Check if it ran successfully
        if result.returncode == 0:
            # Check if we got a response about 4
            if '4' in result.stdout or 'four' in result.stdout.lower():
                print("✓ End-to-end test passed - got expected response")
                print(f"  Response contained answer to 2+2")
                return True
            else:
                print("✗ End-to-end test failed - unexpected response")
                print(f"  Output: {result.stdout[:200]}...")
                return False
        else:
            print(f"✗ End-to-end test failed with return code {result.returncode}")
            if result.stderr:
                print(f"  Error: {result.stderr[:200]}")
            return False
            
    except subprocess.TimeoutExpired:
        print("✗ End-to-end test timed out")
        return False
    except Exception as e:
        print(f"✗ End-to-end test failed: {e}")
        return False

def main():
    """Run all tests"""
    print("\n" + "="*60)
    print("      AssistedVoice Comprehensive Test Suite")
    print("="*60)
    
    tests = [
        ("Import Test", test_imports),
        ("Configuration Test", test_config),
        ("Whisper Test", test_whisper),
        ("Ollama Test", test_ollama),
        ("LLM Query Test", test_llm_query),
        ("Audio Test", test_audio),
        ("End-to-End Test", test_end_to_end),
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            passed = test_func()
            results.append((test_name, passed))
        except Exception as e:
            print(f"\n✗ {test_name} crashed: {e}")
            traceback.print_exc()
            results.append((test_name, False))
    
    # Summary
    print("\n" + "="*60)
    print("Test Summary")
    print("="*60)
    
    for test_name, passed in results:
        status = "✓ PASSED" if passed else "✗ FAILED"
        print(f"{test_name:.<40} {status}")
    
    passed_count = sum(1 for _, p in results if p)
    total_count = len(results)
    
    print(f"\nTotal: {passed_count}/{total_count} tests passed")
    
    if passed_count == total_count:
        print("\n🎉 All tests passed! AssistedVoice is ready to use.")
        print("\nRun with:")
        print("  python assistant.py --mode text")
        return 0
    else:
        failed = [name for name, passed in results if not passed]
        print(f"\n⚠️  Some tests failed: {failed}")
        print("\nPlease fix the issues above before running the assistant.")
        return 1

if __name__ == "__main__":
    sys.exit(main())