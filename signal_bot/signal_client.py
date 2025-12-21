import json
import logging
import time
import requests
import websocket
import threading
from .config import CONFIG

# =================================================================================
# SIGNAL INTERACTION (WebSocket)
# =================================================================================

# WebSocket message queue
ws_message_queue = []

def on_ws_message(ws, message):
    """WebSocket message handler."""
    try:
        msg = json.loads(message)
        logging.info(f"Raw WS Data: {msg}")
        ws_message_queue.append(msg)
    except Exception as e:
        logging.error(f"Error processing WebSocket message: {e}")

def on_ws_error(ws, error):
    logging.error(f"WebSocket Error: {error}")

def on_ws_close(ws, close_status_code, close_msg):
    logging.info("WebSocket Closed")

def on_ws_open(ws):
    logging.info("WebSocket Connection Opened")

def run_signal_receive():
    """Generator for incoming Signal messages via WebSocket."""
    ws_url = CONFIG['SIGNAL_API_URL'].replace("http", "ws")
    ws_url = f"{ws_url}/v1/receive/{CONFIG['SIGNAL_NUMBER']}"

    logging.info(f"Starting Signal WebSocket listener: {ws_url}")

    while True:
        try:
            ws = websocket.WebSocketApp(ws_url,
                                      on_open=on_ws_open,
                                      on_message=on_ws_message,
                                      on_error=on_ws_error,
                                      on_close=on_ws_close)

            # Run in thread to not block
            ws_thread = threading.Thread(target=ws.run_forever)
            ws_thread.daemon = True
            ws_thread.start()

            # Yield messages from queue
            while ws_thread.is_alive():
                while ws_message_queue:
                    yield ws_message_queue.pop(0)
                time.sleep(0.1)

        except Exception as e:
            logging.error(f"WebSocket error: {e}")
            logging.info("Reconnecting in 5s...")
            time.sleep(5)

def send_signal_reply(recipient: str, message: str):
    """Sends a reply via Signal REST API."""
    if len(message) > 2000:
        message = message[:1997] + "..."
    
    url = f"{CONFIG['SIGNAL_API_URL']}/v2/send"
    payload = {
        "message": message,
        "number": CONFIG["SIGNAL_NUMBER"],
        "recipients": [recipient]
    }
    
    try:
        logging.info(f"Sending reply to {recipient}")
        resp = requests.post(url, json=payload, timeout=10)
        if resp.status_code not in [200, 201]:
             logging.error(f"Failed to send: {resp.status_code} - {resp.text}")
    except Exception as e:
        logging.error(f"Failed to send reply: {e}")

def send_typing_indicator(recipient: str, phone_number: str, start: bool = True):
    """Send typing indicator via Signal API."""
    endpoint = f"{CONFIG['SIGNAL_API_URL']}/v1/typing-indicator/{phone_number}"
    payload = {"recipient": recipient}

    try:
        if start:
            resp = requests.put(endpoint, json=payload, timeout=5)
            logging.info(f"Started typing indicator for {recipient} - Status: {resp.status_code} - Response: {resp.text}")
        else:
            resp = requests.delete(endpoint, json=payload, timeout=5)
            logging.info(f"Stopped typing indicator for {recipient} - Status: {resp.status_code} - Response: {resp.text}")
    except Exception as e:
        logging.error(f"Typing indicator error: {e}")

def send_reaction(recipient: str, target_timestamp: int, emoji: str, phone_number: str, remove: bool = False):
    """Send or remove an emoji reaction to a message via Signal API."""
    endpoint = f"{CONFIG['SIGNAL_API_URL']}/v1/reactions/{phone_number}"
    payload = {
        "recipient": recipient,
        "reaction": emoji,
        "target_author": recipient,  # API expects snake_case
        "target_sent_timestamp": target_timestamp,  # API expects snake_case
        "timestamp": target_timestamp,  # Also required
        "remove": remove
    }

    try:
        resp = requests.post(endpoint, json=payload, timeout=5)
        action = "Removed" if remove else "Sent"
        logging.info(f"{action} reaction '{emoji}' to message {target_timestamp} for {recipient} - Status: {resp.status_code}")
    except Exception as e:
        logging.error(f"Reaction error: {e}")
