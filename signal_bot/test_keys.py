import os
import sys
import logging

# Add bot directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from config import CONFIG
from ai import get_openai_client, configure_gemini

logging.basicConfig(level=logging.INFO)

def test_config():
    print("--- Testing Config ---")
    openai_key = CONFIG.get("OPENAI_API_KEY")
    gemini_key = CONFIG.get("GEMINI_API_KEY")
    
    print(f"OPENAI_API_KEY set: {'Yes' if openai_key and 'your_' not in openai_key else 'No (or placeholder)'}")
    print(f"GEMINI_API_KEY set: {'Yes' if gemini_key and 'your_' not in gemini_key else 'No (or placeholder)'}")

def test_clients():
    print("\n--- Testing Clients ---")
    
    print("Testing OpenAI client initialization...")
    try:
        client = get_openai_client()
        if client:
            print("✅ OpenAI client initialized successfully.")
        else:
            print("❌ OpenAI client failed to initialize (missing key).")
    except Exception as e:
        print(f"❌ OpenAI client initialization error: {e}")

    print("\nTesting Gemini configuration...")
    try:
        if configure_gemini():
            print("✅ Gemini configured successfully.")
        else:
            print("❌ Gemini configuration failed (missing key).")
    except Exception as e:
        print(f"❌ Gemini configuration error: {e}")

if __name__ == "__main__":
    test_config()
    test_clients()
