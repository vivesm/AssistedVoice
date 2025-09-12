"""
Terminal UI module using Rich
"""
import time
from datetime import datetime
from typing import Optional, Generator
from rich.console import Console
from rich.panel import Panel
from rich.text import Text
from rich.layout import Layout
from rich.live import Live
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.markdown import Markdown
from rich.syntax import Syntax
import logging

logger = logging.getLogger(__name__)


class TerminalUI:
    """Rich terminal UI for the assistant"""
    
    def __init__(self, config: dict):
        self.config = config
        self.console = Console()
        self.conversation_history = []
        self.status = "Ready"
        self.model_info = ""
        self.mode = config['ui'].get('mode', 'text')
        
        # Clear terminal on start if configured
        if config['ui'].get('clear_on_start', True):
            self.console.clear()
    
    def display_banner(self):
        """Display welcome banner"""
        banner = """
╔═══════════════════════════════════════════════════════════╗
║            AssistedVoice - Local AI Assistant            ║
╚═══════════════════════════════════════════════════════════╝
        """
        self.console.print(banner, style="bold cyan")
        
        # Display configuration
        config_table = Table(show_header=False, box=None)
        config_table.add_column("Key", style="dim")
        config_table.add_column("Value", style="cyan")
        
        config_table.add_row("Model:", self.config['ollama']['model'])
        config_table.add_row("Mode:", self.mode.capitalize())
        config_table.add_row("Whisper:", self.config['whisper']['model'])
        
        if self.mode == 'voice':
            config_table.add_row("TTS:", self.config['tts']['engine'])
            config_table.add_row("Voice:", self.config['tts'].get('voice', 'Default'))
        
        self.console.print(config_table)
        self.console.print()
    
    def display_help(self):
        """Display help information"""
        help_text = """
[bold]Controls:[/bold]
• [cyan]SPACE[/cyan] - Push-to-talk (hold to record)
• [cyan]ENTER[/cyan] - Start/stop recording (VAD mode)
• [cyan]M[/cyan]     - Toggle between text/voice mode
• [cyan]C[/cyan]     - Clear conversation history
• [cyan]H[/cyan]     - Show this help
• [cyan]Q[/cyan]     - Quit application

[bold]Status Indicators:[/bold]
• 🎤 - Listening/Recording
• 💭 - Processing
• 💬 - Speaking (voice mode)
• ✨ - Ready
        """
        panel = Panel(help_text, title="Help", border_style="blue")
        self.console.print(panel)
    
    def update_status(self, status: str, style: str = "yellow"):
        """Update status display"""
        self.status = status
        status_icons = {
            "listening": "🎤",
            "recording": "🔴",
            "processing": "💭",
            "speaking": "💬",
            "ready": "✨",
            "error": "❌"
        }
        
        icon = status_icons.get(status.lower().split()[0], "")
        status_text = f"{icon} {status}" if icon else status
        
        self.console.print(f"\n[{style}]{status_text}[/{style}]", end="")
    
    def display_user_input(self, text: str):
        """Display user input"""
        timestamp = datetime.now().strftime("%H:%M:%S") if self.config['ui'].get('show_timestamps') else ""
        
        user_panel = Panel(
            Text(text, style="green"),
            title=f"[green]You {timestamp}[/green]",
            border_style="green",
            padding=(0, 1)
        )
        
        self.console.print(user_panel)
        self.conversation_history.append(("user", text, timestamp))
    
    def display_assistant_response(self, response: str, latency: Optional[float] = None):
        """Display assistant response"""
        timestamp = datetime.now().strftime("%H:%M:%S") if self.config['ui'].get('show_timestamps') else ""
        
        # Add latency info if available
        title = f"[cyan]Assistant {timestamp}[/cyan]"
        if latency and self.config['ui'].get('show_latency'):
            title += f" [dim]({latency:.2f}s)[/dim]"
        
        # Create response panel
        response_panel = Panel(
            Text(response, style="cyan"),
            title=title,
            border_style="cyan",
            padding=(0, 1)
        )
        
        self.console.print(response_panel)
        self.conversation_history.append(("assistant", response, timestamp))
    
    def display_streaming_response(self, response_generator: Generator[str, None, None]):
        """Display streaming response with live update"""
        timestamp = datetime.now().strftime("%H:%M:%S") if self.config['ui'].get('show_timestamps') else ""
        start_time = time.time()
        
        response_text = ""
        
        with Live(console=self.console, refresh_per_second=10, transient=True) as live:
            for chunk in response_generator:
                response_text += chunk
                
                # Update panel
                elapsed = time.time() - start_time
                title = f"[cyan]Assistant {timestamp}[/cyan]"
                if self.config['ui'].get('show_latency'):
                    title += f" [dim]({elapsed:.1f}s)[/dim]"
                
                panel = Panel(
                    Text(response_text + "▌", style="cyan"),  # Add cursor
                    title=title,
                    border_style="cyan",
                    padding=(0, 1)
                )
                live.update(panel)
            
        
        # After Live exits (transient=True removes the streaming display)
        # Show the final response
        elapsed = time.time() - start_time
        title = f"[cyan]Assistant {timestamp}[/cyan]"
        if self.config['ui'].get('show_latency'):
            title += f" [dim]({elapsed:.2f}s)[/dim]"
        
        final_panel = Panel(
            Text(response_text, style="cyan"),
            title=title,
            border_style="cyan",
            padding=(0, 1)
        )
        self.console.print(final_panel)
        
        # Save to history
        self.conversation_history.append(("assistant", response_text, timestamp))
    
    def display_error(self, error: str):
        """Display error message"""
        error_panel = Panel(
            Text(error, style="red"),
            title="[red]Error[/red]",
            border_style="red",
            padding=(0, 1)
        )
        self.console.print(error_panel)
    
    def display_info(self, message: str):
        """Display info message"""
        self.console.print(f"[dim]{message}[/dim]")
    
    def clear_screen(self):
        """Clear the terminal screen"""
        self.console.clear()
        self.display_banner()
    
    def show_loading(self, message: str = "Processing..."):
        """Show loading spinner"""
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=self.console,
            transient=True
        ) as progress:
            task = progress.add_task(message, total=None)
            while not progress.finished:
                time.sleep(0.1)


class InteractiveUI(TerminalUI):
    """Interactive terminal UI with real-time updates"""
    
    def __init__(self, config: dict):
        super().__init__(config)
        self.layout = self._create_layout()
    
    def _create_layout(self) -> Layout:
        """Create terminal layout"""
        layout = Layout()
        
        layout.split(
            Layout(name="header", size=3),
            Layout(name="body"),
            Layout(name="footer", size=3)
        )
        
        # Header
        layout["header"].update(
            Panel("AssistedVoice - Local AI Assistant", style="bold cyan")
        )
        
        # Footer with status
        layout["footer"].update(
            Panel(f"Mode: {self.mode} | Model: {self.config['ollama']['model']} | Status: {self.status}")
        )
        
        return layout
    
    def update_layout(self):
        """Update layout with current state"""
        # Update footer
        status_text = f"Mode: {self.mode} | Model: {self.config['ollama']['model']} | Status: {self.status}"
        self.layout["footer"].update(Panel(status_text))
        
        # Update body with conversation
        if self.conversation_history:
            conv_text = ""
            for role, text, timestamp in self.conversation_history[-5:]:  # Show last 5 messages
                if role == "user":
                    conv_text += f"[green]You:[/green] {text}\n"
                else:
                    conv_text += f"[cyan]Assistant:[/cyan] {text}\n"
                conv_text += "\n"
            
            self.layout["body"].update(Panel(conv_text, title="Conversation"))
        
        self.console.print(self.layout)


class MinimalUI:
    """Minimal UI for simple text output"""
    
    def __init__(self, config: dict):
        self.config = config
        self.show_timestamps = config['ui'].get('show_timestamps', False)
    
    def display_user_input(self, text: str):
        """Display user input"""
        timestamp = f"[{datetime.now().strftime('%H:%M:%S')}] " if self.show_timestamps else ""
        print(f"{timestamp}You: {text}")
    
    def display_assistant_response(self, response: str, latency: Optional[float] = None):
        """Display assistant response"""
        timestamp = f"[{datetime.now().strftime('%H:%M:%S')}] " if self.show_timestamps else ""
        latency_str = f" ({latency:.2f}s)" if latency else ""
        print(f"{timestamp}Assistant: {response}{latency_str}")
    
    def display_streaming_response(self, response_generator: Generator[str, None, None]):
        """Display streaming response"""
        timestamp = f"[{datetime.now().strftime('%H:%M:%S')}] " if self.show_timestamps else ""
        print(f"{timestamp}Assistant: ", end="", flush=True)
        
        for chunk in response_generator:
            print(chunk, end="", flush=True)
        
        print()  # New line at end
    
    def display_error(self, error: str):
        """Display error"""
        print(f"Error: {error}")
    
    def display_info(self, message: str):
        """Display info"""
        print(f"Info: {message}")
    
    def update_status(self, status: str, style: str = ""):
        """Update status"""
        print(f"Status: {status}")