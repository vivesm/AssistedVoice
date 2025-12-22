"""
Sharing Service
Interacts with the existing textshare platform on atom.local
"""
import logging
import httpx
import os
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

class SharingService:
    """Service for sharing long text content via textshare platform"""
    
    def __init__(self, config: dict):
        """
        Initialize sharing service
        
        Args:
            config: Application configuration
        """
        self.config = config
        # Default to atom.local IP if not configured
        self.base_url = config.get('sharing', {}).get('base_url', 'http://192.168.7.223:3002')
        self.api_url = f"{self.base_url}/api/create"
        self.timeout = config.get('sharing', {}).get('timeout', 10)
        self.public_domain = config.get('sharing', {}).get('public_domain', 'https://share.vives.io')

    async def share_text(self, text: str, retention: str = 'short') -> Optional[str]:
        """
        Share text content and return the share URL
        
        Args:
            text: Content to share
            retention: Retention policy ('short', 'standard', 'long', 'forever')
            
        Returns:
            Public share URL or None on failure
        """
        if not text:
            return None
            
        try:
            logger.info(f"Sharing text content ({len(text)} chars) to {self.api_url}")
            
            payload = {
                "text": text,
                "retention": retention,
                "editable": False
            }
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(self.api_url, json=payload)
                
                if response.status_code == 200:
                    data = response.json()
                    share_id = data.get('id')
                    if share_id:
                        # Construct public URL using the public domain
                        public_url = f"{self.public_domain}/{share_id}"
                        logger.info(f"Successfully shared content: {public_url}")
                        return public_url
                    else:
                        logger.error("API response missing 'id'")
                else:
                    logger.error(f"Failed to share text: HTTP {response.status_code} - {response.text}")
                    
        except Exception as e:
            logger.error(f"Error sharing text: {e}")
            
        return None

    def share_text_sync(self, text: str, retention: str = 'short') -> Optional[str]:
        """
        Synchronous version of share_text for use in non-async contexts
        """
        import asyncio
        try:
            # Check if there is a running loop
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # This is tricky in a running loop, but for Signal bot threads it might be okay 
                # if they aren't using the main event loop
                logger.warning("Event loop is running, sync share_text might block")
                
            # Use httpx sync client
            payload = {
                "text": text,
                "retention": retention,
                "editable": False
            }
            
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(self.api_url, json=payload)
                if response.status_code == 200:
                    data = response.json()
                    share_id = data.get('id')
                    if share_id:
                        return f"{self.public_domain}/{share_id}"
            
        except Exception as e:
            logger.error(f"Error sharing text (sync): {e}")
            
        return None
