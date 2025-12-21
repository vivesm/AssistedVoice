import requests
import logging
from typing import Dict, Any, Optional, List
from .config import CONFIG

class HAClient:
    """Home Assistant REST API Client."""
    
    def __init__(self):
        self.url = CONFIG.get("HA_URL", "http://homeassistant:8123").rstrip("/")
        self.token = CONFIG.get("HA_TOKEN", "")
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def _make_request(self, method: str, path: str, data: Optional[Dict[str, Any]] = None) -> Any:
        """Internal helper to make requests to HA API."""
        url = f"{self.url}/api/{path}"
        try:
            logging.info(f"HA API {method}: {path}")
            if method == "GET":
                response = requests.get(url, headers=self.headers, timeout=10)
            elif method == "POST":
                response = requests.post(url, headers=self.headers, json=data, timeout=10)
            else:
                return {"error": f"Unsupported method {method}"}

            response.raise_for_status()
            return response.json()
        except requests.exceptions.HTTPError as e:
            logging.error(f"HA API Error: {response.status_code} - {response.text}")
            return {"error": f"HTTP Error {response.status_code}: {response.text}"}
        except Exception as e:
            logging.error(f"HA API Generic Error: {str(e)}")
            return {"error": str(e)}

    def get_states(self) -> List[Dict[str, Any]]:
        """Fetch all entity states."""
        return self._make_request("GET", "states")

    def get_state(self, entity_id: str) -> Dict[str, Any]:
        """Fetch state for a specific entity."""
        return self._make_request("GET", f"states/{entity_id}")

    def call_service(self, domain: str, service: str, service_data: Optional[Dict[str, Any]] = None) -> Any:
        """Call a Home Assistant service."""
        return self._make_request("POST", f"services/{domain}/{service}", data=service_data)

    def check_api(self) -> bool:
        """Verify API connectivity."""
        resp = self._make_request("GET", "")
        return resp.get("message") == "API running."
