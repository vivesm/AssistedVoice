import logging
import os
from typing import Tuple, List, Dict, Any
from config import CONFIG, SHARED_PROMPTS, CONTEXT_WINDOW_SIZE
from utils import run_command_on_host

# For direct API calls
from openai import OpenAI
import google.generativeai as genai

# Initialize clients (will be lazy-loaded in functions if needed)
_openai_client = None
_gemini_configured = False

def get_openai_client():
    global _openai_client
    if _openai_client is None:
        api_key = CONFIG.get("OPENAI_API_KEY")
        if not api_key:
            logging.error("OPENAI_API_KEY not found in config")
            return None
        _openai_client = OpenAI(api_key=api_key)
    return _openai_client

def configure_gemini():
    global _gemini_configured
    if not _gemini_configured:
        api_key = CONFIG.get("GEMINI_API_KEY")
        if not api_key:
            logging.error("GEMINI_API_KEY not found in config")
            return False
        genai.configure(api_key=api_key)
        _gemini_configured = True
    return True

def call_claude(user_text: str, mode: str, history: list = None) -> str:
    """Call Claude CLI via SSH with conversation history (remains for now)."""

    # Use shared prompts (enhanced with Signal chatbot context)
    system_prompt = SHARED_PROMPTS.get(mode, SHARED_PROMPTS["ask"])

    # Build prompt with history
    if history and len(history) > 0:
        history_context = "\n".join([
            f"{'User' if msg['role'] == 'user' else 'Assistant'}: {msg['content']}"
            for msg in history[-CONTEXT_WINDOW_SIZE:]
        ])
        full_prompt = f"{system_prompt}\n\nPrevious conversation:\n{history_context}\n\nCurrent question: {user_text}"
    else:
        full_prompt = f"{system_prompt}\n\nUser question: {user_text}"

    full_prompt_escaped = full_prompt.replace("'", "'\"'\"'")
    cmd = f"/home/melvin/.npm-global/bin/claude --dangerously-skip-permissions -p '{full_prompt_escaped}'"

    try:
        result = run_command_on_host(cmd, timeout=120)
        return result
    except Exception as e:
        logging.error(f"Claude CLI error: {e}")
        return f"[Mode: {mode.upper()}]\nError: {str(e)}"

def call_openai(user_text: str, mode: str, history: list = None) -> str:
    """Call OpenAI API directly."""
    client = get_openai_client()
    if not client:
        return f"[Mode: {mode.upper()}]\nError: OpenAI API key not configured."

    system_prompt = SHARED_PROMPTS.get(mode, SHARED_PROMPTS["ask"])
    
    messages = [{"role": "system", "content": system_prompt}]
    
    if history:
        for msg in history[-CONTEXT_WINDOW_SIZE:]:
            role = "user" if msg["role"] == "user" else "assistant"
            messages.append({"role": role, "content": msg["content"]})
    
    messages.append({"role": "user", "content": user_text})

    try:
        response = client.chat.completions.create(
            model="gpt-4o",  # Defaulting to gpt-4o
            messages=messages,
            max_tokens=1000
        )
        return response.choices[0].message.content
    except Exception as e:
        logging.error(f"OpenAI API error: {e}")
        return f"[Mode: {mode.upper()}]\nOpenAI Error: {str(e)}"

def call_gemini(user_text: str, mode: str, history: list = None) -> str:
    """Call Google Gemini API directly."""
    if not configure_gemini():
        return f"[Mode: {mode.upper()}]\nError: Gemini API key not configured."

    system_prompt = SHARED_PROMPTS.get(mode, SHARED_PROMPTS["ask"])
    
    try:
        model = genai.GenerativeModel('gemini-1.5-flash') # Defaulting to flash for speed/cost
        
        chat_history = []
        if history:
            for msg in history[-CONTEXT_WINDOW_SIZE:]:
                role = "user" if msg["role"] == "user" else "model"
                chat_history.append({"role": role, "parts": [msg["content"]]})
        
        chat = model.start_chat(history=chat_history)
        
        # Combine system prompt with user text for now as Gemini 1.5-flash 
        # handling of system instructions varies by sdk version.
        full_user_text = f"{system_prompt}\n\nUser: {user_text}"
        
        response = chat.send_message(full_user_text)
        return response.text

    except Exception as e:
        logging.error(f"Gemini API error: {e}")
        if "quota" in str(e).lower():
            return f"[Mode: {mode.upper()}]\n⚠️ Gemini API Quota Exceeded"
        return f"[Mode: {mode.upper()}]\nGemini Error: {str(e)}"

def call_ai_with_fallback(user_text: str, mode: str, model_preference: str = "auto", history: list = None) -> Tuple[str, str]:
    """Call AI based on user's model preference with conversation history."""

    # PREFERENCE: CLAUDE
    if model_preference == "claude":
        result = call_claude(user_text, mode, history)
        return (result, "claude")

    # PREFERENCE: OPENAI
    elif model_preference == "openai":
        result = call_openai(user_text, mode, history)
        return (result, "openai")

    # PREFERENCE: GEMINI
    elif model_preference == "gemini":
        result = call_gemini(user_text, mode, history)
        return (result, "gemini")

    # AUTO MODE (Fallback: Claude -> OpenAI -> Gemini)
    else:
        logging.info("Auto mode - trying Claude with fallback")
        claude_result = call_claude(user_text, mode, history)

        claude_failed = (
            claude_result.startswith("[Mode: ") and "Error" in claude_result or
            "EROFS" in claude_result or "timed out" in claude_result or
            "Limit reached" in claude_result or "resets" in claude_result
        )

        if not claude_failed:
            return (claude_result, "claude")

        logging.warning("Claude failed, trying OpenAI")
        openai_result = call_openai(user_text, mode, history)
        
        if not (openai_result.startswith("[Mode: ") and "Error" in openai_result):
            return (openai_result, "openai")

        logging.warning("OpenAI failed, falling back to Gemini")
        gemini_result = call_gemini(user_text, mode, history)
        return (gemini_result, "gemini")
