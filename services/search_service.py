"""
Web Search Service using Brave MCP Server (Docker)
Communicates with the Brave Search MCP server for web search capabilities
"""
import os
import json
import logging
import subprocess
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)


class MCPSearchService:
    """Web search service using Brave MCP Server via Docker"""

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize MCP search service
        
        Args:
            api_key: Brave API key. Falls back to BRAVE_API_KEY env var.
        """
        self.api_key = api_key or os.getenv("BRAVE_API_KEY")
        self._docker_available = self._check_docker_available()
    
    def _check_docker_available(self) -> bool:
        """Check if Docker and MCP image are available"""
        try:
            result = subprocess.run(
                ["docker", "image", "inspect", "mcp/brave-search"],
                capture_output=True,
                timeout=5
            )
            return result.returncode == 0
        except Exception:
            return False
    
    def is_available(self) -> bool:
        """Check if search service is available"""
        return self._docker_available and bool(self.api_key)
    
    def _call_mcp_tool(self, tool_name: str, arguments: dict) -> Optional[dict]:
        """
        Call an MCP tool via Docker
        
        Args:
            tool_name: Name of the MCP tool (e.g., 'brave_web_search')
            arguments: Tool arguments
            
        Returns:
            Tool result or None on error
        """
        if not self.api_key:
            logger.error("Brave API key not configured")
            return None
            
        # JSON-RPC request for MCP
        request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            }
        }
        
        try:
            # Use shell with echo pipe - workaround for Docker stdin handling
            request_json = json.dumps(request).replace("'", "'\\''")  # Escape single quotes
            cmd = f"echo '{request_json}' | docker run -i --rm -e BRAVE_API_KEY={self.api_key} mcp/brave-search"
            
            result = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=30
            )
            
            if result.returncode != 0:
                logger.error(f"MCP Docker error: {result.stderr}")
                return None
            
            if not result.stdout.strip():
                logger.error("MCP returned empty response")
                return None
            
            # Parse JSON-RPC response
            response = json.loads(result.stdout)
            if "result" in response:
                return response["result"]
            elif "error" in response:
                logger.error(f"MCP error: {response['error']}")
                return None
                
        except subprocess.TimeoutExpired:
            logger.error("MCP Docker request timed out")
            return None
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse MCP response: {e}")
            return None
        except Exception as e:
            logger.error(f"MCP call failed: {e}")
            return None
        
        return None
    
    def search(self, query: str, count: int = 5) -> List[Dict]:
        """
        Perform a web search using brave_web_search MCP tool
        
        Args:
            query: Search query string
            count: Number of results to return (max 20)
        
        Returns:
            List of search results with title, url, and description
        """
        result = self._call_mcp_tool("brave_web_search", {
            "query": query,
            "count": min(count, 20)
        })
        
        if not result:
            return []
        
        # Parse MCP result content - each item in content is a separate search result
        try:
            content = result.get("content", [])
            results = []
            
            for item in content[:count]:
                if item.get("type") == "text":
                    text = item.get("text", "")
                    data = json.loads(text)
                    results.append({
                        "title": data.get("title", ""),
                        "url": data.get("url", ""),
                        "description": data.get("description", "")
                    })
            
            logger.info(f"MCP search for '{query}' returned {len(results)} results")
            return results
        except Exception as e:
            logger.error(f"Failed to parse MCP search results: {e}")
        
        return []
    
    def search_news(self, query: str, count: int = 5) -> List[Dict]:
        """Search for news articles using brave_news_search"""
        result = self._call_mcp_tool("brave_news_search", {
            "query": query,
            "count": min(count, 20)
        })
        
        if not result:
            return []
        
        try:
            content = result.get("content", [])
            if content and len(content) > 0:
                text_content = content[0].get("text", "")
                data = json.loads(text_content)
                
                results = []
                for item in data.get("results", [])[:count]:
                    results.append({
                        "title": item.get("title", ""),
                        "url": item.get("url", ""),
                        "description": item.get("description", ""),
                        "age": item.get("age", "")
                    })
                return results
        except Exception as e:
            logger.error(f"Failed to parse MCP news results: {e}")
        
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


# Backwards compatibility alias
SearchService = MCPSearchService

# Global instance (lazy initialization)
_search_service: Optional[MCPSearchService] = None


def get_search_service() -> MCPSearchService:
    """Get or create the global search service instance"""
    global _search_service
    if _search_service is None:
        _search_service = MCPSearchService()
    return _search_service
