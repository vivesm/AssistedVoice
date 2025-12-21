import logging
import json
from typing import Dict, Any
from .utils import run_command_on_host, classify_operation
from .ha_client import HAClient

ha = HAClient()

def execute_action(action_data: Dict[str, Any]) -> str:
    """Executes an action returned by Claude in AGENT mode."""
    action = action_data.get("action")
    params = action_data.get("params", {})
    
    if action == "shell_exec":
        cmd = params.get("cmd")
        if not cmd:
            return "Error: No command specified."
            
        if classify_operation(cmd) == "dangerous":
            return "⚠️ Blocked: Potentially destructive command. Use caution."
            
        logging.info(f"AGENT MODE: Executing command: {cmd}")
        result = run_command_on_host(cmd)
        
        if len(result) > 1000:
            result = result[:1000] + "\n...(truncated)"
            
        return f"Output:\n```\n{result}\n```"

    if action == "transcribe_video":
        url = params.get("url")
        if not url:
            return "Error: No URL provided for transcription."
            
        logging.info(f"AGENT MODE: Transcribing video: {url}")
        
        # Call the helper script on the host
        # We assume the path is fixed as we just created it
        helper_path = "/home/melvin/server/onlinevideodownloader/transcribe_and_share.py"
        cmd = f"python3 {helper_path} '{url}'"
        
        # This might take a while, we should increase timeout (1200 seconds = 20 mins)
        raw_result = run_command_on_host(cmd, timeout=1200) 
        
        try:
            # The result should be JSON from our helper
            data = json.loads(raw_result)
            if data.get("success"):
                return f"✅ Transcription complete!\n\nView it here: {data.get('shortUrl')}"
            else:
                return f"❌ Transcription failed: {data.get('error')}\nDetails: {data.get('details', 'N/A')}"
        except json.JSONDecodeError:
            return f"❌ Error: Unexpected response from transcription helper:\n```\n{raw_result}\n```"

    if action == "homeassistant_action":
        domain = params.get("domain")
        service = params.get("service")
        entity_id = params.get("entity_id")
        data = params.get("data", {})
        
        if entity_id:
            data["entity_id"] = entity_id
            
        if not domain or not service:
            return "Error: Domain and Service are required for Home Assistant actions."
            
        logging.info(f"HA ACTION: {domain}.{service} on {entity_id}")
        result = ha.call_service(domain, service, data)
        
        if isinstance(result, dict) and "error" in result:
             return f"HA Error: {result['error']}"
             
        return f"HA Success: Executed {domain}.{service}"

    return f"Error: Unknown action '{action}'"
