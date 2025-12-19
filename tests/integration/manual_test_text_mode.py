#!/usr/bin/env python3
"""
Simple text-mode test for AssistedVoice without keyboard module
"""
import sys
import os
import yaml
import time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from modules.llm import OllamaLLM


def main():
    # Load config
    with open('config.yaml', 'r') as f:
        config = yaml.safe_load(f)
    
    # Force text mode
    config['ui']['mode'] = 'text'
    
    # Initialize components
    print("Initializing components...")
    llm = OllamaLLM(config)

    
    print("AssistedVoice - Text Mode")
    print(f"Model: {config['ollama']['model']}")
    
    print("\nText-only mode active. Type your messages (or 'quit' to exit):")
    print("-" * 60)
    
    while True:
        try:
            # Get user input
            user_input = input("\nYou: ").strip()
            
            if user_input.lower() in ['quit', 'exit', 'q']:
                print("\nGoodbye!")
                break
            
            if not user_input:
                continue
            
            # Generate response
            print("\nAssistant: ", end="", flush=True)
            
            response = ""
            for chunk in llm.generate(user_input, stream=True):
                print(chunk, end="", flush=True)
                response += chunk
            
            print()  # New line after response
            
        except KeyboardInterrupt:
            print("\n\nGoodbye!")
            break
        except Exception as e:
            print(f"\nError: {e}")
            continue

if __name__ == "__main__":
    main()