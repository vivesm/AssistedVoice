#!/usr/bin/env python3
"""
AssistedVoice - Local AI Voice Assistant
Main application entry point
"""
import os
import sys
import yaml
import logging
import argparse
import time
from typing import Optional
import signal
from pathlib import Path

# Add modules to path
sys.path.insert(0, str(Path(__file__).parent))

from modules.stt import WhisperSTT, PushToTalkSTT
from modules.llm import OptimizedOllamaLLM
from modules.tts import create_tts_engine, StreamingTTS
from modules.ui import TerminalUI, MinimalUI


class VoiceAssistant:
    """Main Voice Assistant Application"""
    
    def __init__(self, config_path: str = "config.yaml", mode: Optional[str] = None):
        self.config = self.load_config(config_path)
        
        # Override mode if specified
        if mode:
            self.config['ui']['mode'] = mode
        
        self.setup_logging()
        self.logger = logging.getLogger(__name__)
        
        # Initialize components
        self.ui = None
        self.stt = None
        self.llm = None
        self.tts = None
        self.streaming_tts = None
        
        self.running = False
        self.mode = self.config['ui']['mode']
        
        self.logger.info("Initializing AssistedVoice...")
        self.setup_components()
    
    def load_config(self, config_path: str) -> dict:
        """Load configuration from YAML file"""
        with open(config_path, 'r') as f:
            return yaml.safe_load(f)
    
    def setup_logging(self):
        """Setup logging configuration"""
        log_config = self.config.get('logging', {})
        log_level = getattr(logging, log_config.get('level', 'INFO'))
        log_file = log_config.get('file', 'logs/assistant.log')
        
        # Create log directory if needed
        os.makedirs(os.path.dirname(log_file), exist_ok=True)
        
        # Configure logging
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler(log_file),
                logging.StreamHandler() if log_level == logging.DEBUG else logging.NullHandler()
            ]
        )
    
    def setup_components(self):
        """Initialize all components"""
        try:
            # UI
            if self.config['ui'].get('minimal', False):
                self.ui = MinimalUI(self.config)
            else:
                self.ui = TerminalUI(self.config)
            
            # Speech Recognition
            self.logger.info("Initializing Speech Recognition...")
            if self.config['hotkeys'].get('push_to_talk'):
                self.stt = PushToTalkSTT(
                    self.config,
                    key=self.config['hotkeys']['push_to_talk']
                )
            else:
                self.stt = WhisperSTT(self.config)
            
            # Language Model
            self.logger.info("Initializing Language Model...")
            self.llm = OptimizedOllamaLLM(self.config)
            
            # Text-to-Speech
            self.logger.info("Initializing Text-to-Speech...")
            self.tts = create_tts_engine(self.config)
            
            # Streaming TTS if enabled
            if self.config['performance'].get('response_streaming') and self.mode == 'voice':
                self.streaming_tts = StreamingTTS(self.tts)
                self.streaming_tts.start()
            
            self.logger.info("All components initialized successfully")
            
        except Exception as e:
            self.logger.error(f"Failed to initialize components: {e}")
            raise
    
    def run(self):
        """Main application loop"""
        self.running = True
        
        # Display banner and help
        self.ui.display_banner()
        self.ui.display_help()
        
        # Start main loop
        try:
            if self.mode == 'text':
                # Text mode - no keyboard handlers needed
                self.run_text_mode()
            else:
                # Voice mode - setup keyboard handlers
                self.setup_keyboard_handlers()
                
                if isinstance(self.stt, PushToTalkSTT):
                    self.run_push_to_talk_mode()
                else:
                    self.run_vad_mode()
        
        except KeyboardInterrupt:
            self.logger.info("Interrupted by user")
        except Exception as e:
            self.logger.error(f"Application error: {e}")
            self.ui.display_error(str(e))
        finally:
            self.cleanup()
    
    def run_vad_mode(self):
        """Run with Voice Activity Detection"""
        self.ui.display_info(f"Voice Activity Detection mode. Press ENTER to start recording.")
        
        while self.running:
            try:
                # Wait for user input
                input_key = input()
                
                if not self.running:
                    break
                
                # Start recording
                self.ui.update_status("Listening... (speak now)", "yellow")
                
                # Record and transcribe
                text = self.stt.record_and_transcribe(use_vad=True)
                
                if text:
                    self.process_input(text)
                else:
                    self.ui.update_status("No speech detected", "dim")
                
                self.ui.update_status("Ready", "green")
                
            except Exception as e:
                self.logger.error(f"Error in VAD mode: {e}")
                self.ui.display_error(str(e))
    
    def run_text_mode(self):
        """Run in text-only mode"""
        self.ui.display_info("Text mode active. Type your messages (or 'quit' to exit):")
        
        while self.running:
            try:
                # Get user input
                user_input = input("\nYou: ").strip()
                
                if user_input.lower() in ['quit', 'exit', 'q']:
                    self.quit()
                    break
                    
                if user_input.lower() in ['clear', 'c']:
                    self.clear_history()
                    continue
                    
                if user_input.lower() in ['help', 'h']:
                    self.ui.display_help()
                    continue
                
                if not user_input:
                    continue
                
                # Process the input
                self.process_input(user_input)
                
            except KeyboardInterrupt:
                self.quit()
                break
            except Exception as e:
                self.logger.error(f"Error in text mode: {e}")
                self.ui.display_error(str(e))
    
    def run_push_to_talk_mode(self):
        """Run with Push-to-Talk"""
        key = self.config['hotkeys']['push_to_talk']
        self.ui.display_info(f"Push-to-Talk mode. Hold [{key.upper()}] to record.")
        
        # Setup PTT callback
        def on_speech(text: str):
            if text:
                self.process_input(text)
        
        self.stt.start_ptt_recording(on_speech)
        
        # Keep running
        while self.running:
            time.sleep(0.1)
    
    def process_input(self, text: str):
        """Process user input"""
        # Display user input
        self.ui.display_user_input(text)
        
        # Check for commands
        if self.handle_command(text):
            return
        
        # Generate response
        self.ui.update_status("Processing...", "yellow")
        
        start_time = time.time()
        
        # Get response from LLM
        if self.config['performance'].get('response_streaming'):
            # Streaming response
            if self.mode == 'text':
                # Text-only mode with streaming display
                self.ui.display_streaming_response(
                    self.llm.generate(text, stream=True)
                )
            else:
                # Voice mode with streaming TTS
                response_text = ""
                for chunk in self.llm.generate(text, stream=True):
                    response_text += chunk
                    if self.streaming_tts:
                        self.streaming_tts.add_text(chunk)
                
                if self.streaming_tts:
                    self.streaming_tts.flush()
                
                # Also display in terminal
                self.ui.display_assistant_response(
                    response_text,
                    time.time() - start_time
                )
        else:
            # Non-streaming response
            response = self.llm.generate_complete(text)
            
            # Display response
            self.ui.display_assistant_response(
                response,
                time.time() - start_time
            )
            
            # Speak if in voice mode
            if self.mode == 'voice':
                self.ui.update_status("Speaking...", "cyan")
                self.tts.speak(response)
        
        self.ui.update_status("Ready", "green")
    
    def handle_command(self, text: str) -> bool:
        """Handle special commands"""
        text_lower = text.lower().strip()
        
        commands = {
            "clear history": self.clear_history,
            "clear conversation": self.clear_history,
            "help": self.show_help,
            "quit": self.quit,
            "exit": self.quit,
            "toggle mode": self.toggle_mode,
            "text mode": lambda: self.set_mode('text'),
            "voice mode": lambda: self.set_mode('voice'),
        }
        
        for cmd, func in commands.items():
            if cmd in text_lower:
                func()
                return True
        
        return False
    
    def setup_keyboard_handlers(self):
        """Setup keyboard shortcuts"""
        # Skip keyboard setup in text mode due to macOS compatibility issues
        if self.mode == 'text':
            self.logger.info("Keyboard shortcuts disabled in text mode (macOS compatibility)")
            return
            
        try:
            import keyboard
            hotkeys = self.config.get('hotkeys', {})
            
            if hotkeys.get('toggle_mode'):
                keyboard.add_hotkey(hotkeys['toggle_mode'], self.toggle_mode)
            
            if hotkeys.get('clear_history'):
                keyboard.add_hotkey(hotkeys['clear_history'], self.clear_history)
            
            if hotkeys.get('exit'):
                keyboard.add_hotkey(hotkeys['exit'], self.quit)
        except ImportError:
            self.logger.warning("Keyboard module not available - hotkeys disabled")
        except Exception as e:
            self.logger.warning(f"Could not set up keyboard shortcuts: {e}")
    
    def toggle_mode(self):
        """Toggle between text and voice mode"""
        self.mode = 'voice' if self.mode == 'text' else 'text'
        self.config['ui']['mode'] = self.mode
        
        # Update TTS
        self.tts = create_tts_engine(self.config)
        
        self.ui.display_info(f"Switched to {self.mode} mode")
        self.logger.info(f"Mode switched to: {self.mode}")
    
    def set_mode(self, mode: str):
        """Set specific mode"""
        self.mode = mode
        self.config['ui']['mode'] = mode
        self.tts = create_tts_engine(self.config)
        self.ui.display_info(f"Mode set to: {mode}")
    
    def clear_history(self):
        """Clear conversation history"""
        self.llm.clear_conversation()
        self.ui.clear_screen()
        self.ui.display_info("Conversation history cleared")
    
    def show_help(self):
        """Show help"""
        self.ui.display_help()
    
    def quit(self):
        """Quit application"""
        self.running = False
        self.ui.display_info("Goodbye!")
    
    def cleanup(self):
        """Cleanup resources"""
        self.logger.info("Cleaning up resources...")
        
        if self.streaming_tts:
            self.streaming_tts.stop()
        
        if self.tts:
            self.tts.stop()
        
        self.logger.info("Cleanup complete")


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="AssistedVoice - Local AI Voice Assistant")
    parser.add_argument(
        '--config',
        default='config.yaml',
        help='Path to configuration file'
    )
    parser.add_argument(
        '--mode',
        choices=['text', 'voice'],
        help='Override UI mode (text-only or with voice)'
    )
    parser.add_argument(
        '--model',
        help='Override LLM model'
    )
    parser.add_argument(
        '--debug',
        action='store_true',
        help='Enable debug logging'
    )
    
    args = parser.parse_args()
    
    # Setup signal handler for clean exit
    def signal_handler(sig, frame):
        print("\nShutting down...")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    
    try:
        # Create and run assistant
        assistant = VoiceAssistant(
            config_path=args.config,
            mode=args.mode
        )
        
        # Override model if specified
        if args.model:
            assistant.config['ollama']['model'] = args.model
            assistant.llm.model = args.model
        
        # Enable debug if specified
        if args.debug:
            logging.getLogger().setLevel(logging.DEBUG)
        
        assistant.run()
        
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()