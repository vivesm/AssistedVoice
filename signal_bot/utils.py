import re
import subprocess
import logging
import json
from typing import Tuple, List, Dict, Any
from config import CONFIG

def detect_mode(text: str) -> str:
    """
    Detects mode from text if not explicitly tagged.
    Priority: Questions → Actions → Planning → Default ASK
    """
    text_lower = text.lower()

    # Check for explicit mode tags first
    if text_lower.startswith('[agent]'):
        return 'agent'
    if text_lower.startswith('[plan]'):
        return 'plan'
    if text_lower.startswith('[ask]'):
        return 'ask'

    # PRIORITY 1: Detect questions (ASK mode)
    question_starters = ['what', 'why', 'how', 'when', 'where', 'who', 'which', 'whose']

    # Check if starts with question word
    first_word = text_lower.split()[0] if text_lower.split() else ''
    if first_word in question_starters or text_lower.endswith('?'):
        return 'ask'

    # Check for common question patterns
    question_patterns = ['what is', 'what are', 'why is', 'why are', 'how does', 'tell me']
    if any(pattern in text_lower for pattern in question_patterns):
        return 'ask'

    # PRIORITY 2: Detect action requests (AGENT mode)
    agent_triggers = ['check', 'show', 'get', 'list', 'run', 'execute',
                      'restart', 'stop', 'start', 'kill', 'monitor', 'transcribe']
    if any(trigger in text_lower for trigger in agent_triggers):
        return 'agent'

    # PRIORITY 3: Detect planning requests (PLAN mode)
    plan_triggers = ['plan', 'how do i', 'how can i', 'setup', 'configure',
                     'strategy', 'approach', 'best way to']
    if any(trigger in text_lower for trigger in plan_triggers):
        return 'plan'

    # DEFAULT: ASK mode
    return 'ask'

def parse_mode(text: str) -> Tuple[str, str]:
    """
    Parse mode and strip mode tag if present.
    Returns (mode, clean_text)
    """
    match = re.match(r'^\[(\w+)\]\s*(.*)$', text, re.DOTALL)
    if match:
        mode = match.group(1).lower()
        content = match.group(2).strip()
        if mode in ["ask", "plan", "agent"]:
            return mode, content

    mode = detect_mode(text)
    return mode, text

def run_command_on_host(cmd: str, timeout: int = 30) -> str:
    """
    Executes a command on the host via SSH using keys mounted in the container.

    Args:
        cmd: Command to execute
        timeout: Timeout in seconds (default 30)
    """
    # Use standard ssh with explicit key path
    ssh_cmd = [
        "ssh",
        "-i", "/root/.ssh/id_rsa",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        f"{CONFIG['HOST_USER']}@{CONFIG['HOST_ADDR']}",
        cmd
    ]

    try:
        logging.info(f"SSH Executing: {cmd}")
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )

        if result.returncode != 0:
            return f"Error (Exit {result.returncode}): {result.stderr.strip()}"

        return result.stdout.strip()

    except subprocess.TimeoutExpired:
        return f"Error: Command timed out ({timeout}s). Try a simpler question or break it into parts."
    except Exception as e:
        return f"Error: SSH execution failed - {str(e)}"

def classify_operation(cmd: str) -> str:
    """
    Classify command as read-only, write, or dangerous.

    Returns: "read", "write", or "dangerous"
    """
    # Dangerous operations
    dangerous_patterns = [
        r'\brm\s+-rf\s+/',     # rm -rf /
        r'\bdd\s+if=',          # dd if=
        r'\bmkfs\.',            # mkfs
        r'>\s*/dev/sd',         # > /dev/sd
        r':\(\)\s*\{',          # Fork bomb
        r'\bsudo\s+rm\b',       # sudo rm
        r'docker\s+rm\b',       # docker rm
        r'systemctl\s+stop\b',  # systemctl stop
    ]

    for pattern in dangerous_patterns:
        if re.search(pattern, cmd):
            return "dangerous"

    # Read-only operations (safe)
    read_only_commands = [
        'ls', 'cat', 'grep', 'find', 'head', 'tail',
        'docker ps', 'docker logs', 'docker inspect',
        'systemctl status', 'journalctl',
        'curl -X GET', 'curl http',  # GET requests only
        'git log', 'git status', 'git diff',
        'ps', 'top', 'df', 'du', 'free',
        'whoami', 'pwd', 'which', 'echo',
    ]

    cmd_lower = cmd.lower().strip()
    for safe_cmd in read_only_commands:
        if cmd_lower.startswith(safe_cmd):
            return "read"

    # Default: treat as write operation
    return "write"

def extract_actions_from_response(response: str) -> List[Dict[str, Any]]:
    """
    Extract actions from AI response.
    Supports:
    - JSON code blocks (```json ... ```)
    - Shell code blocks (```bash ... ```)
    - Backtick commands (`command`)
    - "running:" patterns
    
    Returns: List of action dictionaries
    """
    actions = []

    # 1. JSON Code Blocks
    json_blocks = re.findall(r'```json\s*\n(.*?)\n```', response, re.DOTALL)
    for block in json_blocks:
        try:
            data = json.loads(block)
            if isinstance(data, dict) and "action" in data:
                actions.append(data)
            elif isinstance(data, list):
                for item in data:
                    if isinstance(item, dict) and "action" in item:
                        actions.append(item)
        except:
            continue

    # 2. Pattern: "running:" pattern
    # This might be followed by a shell command OR a JSON action
    running_match = re.search(r'running:\s*\n\s*(.+)', response)
    if running_match:
        content = running_match.group(1).strip()
        # Check if content looks like JSON
        if content.startswith('{') and content.endswith('}'):
            try:
                data = json.loads(content)
                if isinstance(data, dict) and "action" in data:
                    actions.append(data)
                else:
                    # Not an action JSON, treat as shell
                    actions.append({"action": "shell_exec", "params": {"cmd": content}})
            except:
                # Invalid JSON, treat as shell
                actions.append({"action": "shell_exec", "params": {"cmd": content}})
        else:
            actions.append({"action": "shell_exec", "params": {"cmd": content}})

    # 3. New: Standalone JSON pattern { "action": ... }
    # This catches actions not inside code blocks but formatted as JSON
    potential_json = re.findall(r'(\{.+\})', response, re.DOTALL)
    for block in potential_json:
        try:
            data = json.loads(block)
            if isinstance(data, dict) and "action" in data:
                # Avoid duplicates
                if not any(json.dumps(a, sort_keys=True) == json.dumps(data, sort_keys=True) for a in actions):
                    actions.append(data)
        except:
            continue

    # 4. Code blocks (shell)
    code_blocks = re.findall(r'```(?:bash|sh|shell)?\s*\n(.+?)\n```', response, re.DOTALL)
    for block in code_blocks:
        cmd = block.strip()
        # Check if it's actually a JSON action
        if cmd.startswith('{') and '"action"' in cmd:
            try:
                data = json.loads(cmd)
                if isinstance(data, dict) and "action" in data:
                    if not any(json.dumps(a, sort_keys=True) == json.dumps(data, sort_keys=True) for a in actions):
                        actions.append(data)
                    continue
            except:
                pass
                
        # Avoid duplicate if already extracted as JSON action
        if not any(a.get("params", {}).get("cmd") == cmd for a in actions):
            actions.append({"action": "shell_exec", "params": {"cmd": cmd}})

    # 5. Backticks
    backtick_cmds = re.findall(r'`([^`]+)`', response)
    for cmd in backtick_cmds:
        cmd_strip = cmd.strip()
        if len(cmd_strip.split()) >= 2:
            # Check if it's actually a JSON action
            if cmd_strip.startswith('{') and '"action"' in cmd_strip:
                try:
                    data = json.loads(cmd_strip)
                    if isinstance(data, dict) and "action" in data:
                        if not any(json.dumps(a, sort_keys=True) == json.dumps(data, sort_keys=True) for a in actions):
                            actions.append(data)
                        continue
                except:
                    pass

            if not any(a.get("params", {}).get("cmd") == cmd_strip for a in actions):
                actions.append({"action": "shell_exec", "params": {"cmd": cmd_strip}})

    # Deduplicate and filter empty
    seen = set()
    unique_actions = []
    for a in actions:
        s = json.dumps(a, sort_keys=True)
        if s not in seen:
            seen.add(s)
            unique_actions.append(a)

    return unique_actions
