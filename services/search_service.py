"""
Web Search Service using Brave Search API
Provides web search capabilities for the AI assistant
"""
import os
import logging
import requests
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"


class SearchService:
    """Web search service using Brave Search API"""

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize search service
        
        Args:
            api_key: Brave Search API key. If not provided, reads from BRAVE_API_KEY env var
        """
        self.api_key = api_key or os.getenv("BRAVE_API_KEY")
        if not self.api_key:
            logger.warning("No Brave API key configured. Web search will be unavailable.")
    
    def is_available(self) -> bool:
        """Check if search service is configured"""
        return bool(self.api_key)
    
    def search(self, query: str, count: int = 5) -> List[Dict]:
        """
        Perform a web search
        
        Args:
            query: Search query string
            count: Number of results to return (max 20)
        
        Returns:
            List of search results with title, url, and description
        """
        if not self.api_key:
            logger.error("Brave API key not configured")
            return []
        
        headers = {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": self.api_key
        }
        
        params = {
            "q": query,
            "count": min(count, 20),
            "text_decorations": False,
            "search_lang": "en"
        }
        
        try:
            response = requests.get(
                BRAVE_SEARCH_URL,
                headers=headers,
                params=params,
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            results = []
            web_results = data.get("web", {}).get("results", [])
            
            for item in web_results[:count]:
                results.append({
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "description": item.get("description", "")
                })
            
            logger.info(f"Search for '{query}' returned {len(results)} results")
            return results
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Search request failed: {e}")
            return []
        except Exception as e:
            logger.error(f"Search error: {e}")
            return []
    
    def search_formatted(self, query: str, count: int = 5) -> str:
        """
        Search and return formatted text suitable for LLM context
        
        Args:
            query: Search query string
            count: Number of results
        
        Returns:
            Formatted string with search results
        """
        results = self.search(query, count)
        
        if not results:
            return f"No search results found for: {query}"
        
        formatted = [f"Web search results for: {query}\n"]
        for i, r in enumerate(results, 1):
            formatted.append(f"{i}. {r['title']}")
            formatted.append(f"   {r['description']}")
            formatted.append(f"   Source: {r['url']}\n")
        
        return "\n".join(formatted)


# Global instance (lazy initialization)
_search_service: Optional[SearchService] = None


def get_search_service() -> SearchService:
    """Get or create the global search service instance"""
    global _search_service
    if _search_service is None:
        _search_service = SearchService()
    return _search_service
