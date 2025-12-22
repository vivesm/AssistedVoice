import asyncio
import logging
import sys
import os

# Add parent directory to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.sharing_service import SharingService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_sharing():
    config = {
        'sharing': {
            'base_url': 'http://192.168.7.223:3002',
            'public_domain': 'https://share.vives.io'
        }
    }
    
    service = SharingService(config)
    
    test_text = "This is a test message for the Signal Bot Textshare integration. " * 50
    logger.info(f"Test text length: {len(test_text)}")
    
    logger.info("Attempting async share...")
    url = await service.share_text(test_text)
    if url:
        logger.info(f"SUCCESS: Share URL is {url}")
    else:
        logger.error("FAILED to share text via async method")
        
    logger.info("Attempting sync share...")
    url_sync = service.share_text_sync(test_text)
    if url_sync:
        logger.info(f"SUCCESS: Sync share URL is {url_sync}")
    else:
        logger.error("FAILED to share text via sync method")

if __name__ == "__main__":
    asyncio.run(test_sharing())
