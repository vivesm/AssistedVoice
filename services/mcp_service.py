"""
MCP Service - Unified interface for Docker MCP servers
Supports Brave Search, Context7, and other MCP tools
"""
import os
import json
import logging
import subprocess
from typing import List, Dict, Optional, Any

logger = logging.getLogger(__name__)


class MCPClient:
    """Generic MCP client for calling Docker MCP servers"""
    
    def __init__(self):
        """Initialize MCP client"""
        self._image_cache: Dict[str, bool] = {}
    
    def _check_image_available(self, image: str) -> bool:
        """Check if a Docker image is available"""
        if image in self._image_cache:
            return self._image_cache[image]
        
        try:
            result = subprocess.run(
                ["docker", "image", "inspect", image],
                capture_output=True,
                timeout=5
            )
            available = result.returncode == 0
            self._image_cache[image] = available
            return available
        except Exception:
            return False
    
    def call_tool(self, image: str, tool_name: str, arguments: dict, 
                  env_vars: Optional[Dict[str, str]] = None) -> Optional[dict]:
        """
        Call an MCP tool on a Docker container
        
        Args:
            image: Docker image name (e.g., 'mcp/brave-search')
            tool_name: Name of the MCP tool
            arguments: Tool arguments
            env_vars: Optional environment variables to pass
            
        Returns:
            Tool result or None on error
        """
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
            # Build Docker command with env vars
            env_parts = ""
            if env_vars:
                for key, value in env_vars.items():
                    env_parts += f" -e {key}={value}"
            
            # Use shell with echo pipe for Docker stdin
            request_json = json.dumps(request).replace("'", "'\\''")
            cmd = f"echo '{request_json}' | docker run -i --rm{env_parts} {image}"
            
            result = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=60  # Longer timeout for docs fetching
            )
            
            if result.returncode != 0:
                logger.error(f"MCP Docker error ({image}): {result.stderr}")
                return None
            
            if not result.stdout.strip():
                logger.error(f"MCP returned empty response ({image})")
                return None
            
            # Parse JSON-RPC response
            response = json.loads(result.stdout)
            if "result" in response:
                return response["result"]
            elif "error" in response:
                logger.error(f"MCP error ({image}): {response['error']}")
                return None
                
        except subprocess.TimeoutExpired:
            logger.error(f"MCP Docker request timed out ({image})")
            return None
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse MCP response ({image}): {e}")
            return None
        except Exception as e:
            logger.error(f"MCP call failed ({image}): {e}")
            return None
        
        return None
    
    def get_text_content(self, result: dict) -> str:
        """Extract text content from MCP result"""
        content = result.get("content", [])
        texts = []
        for item in content:
            if item.get("type") == "text":
                texts.append(item.get("text", ""))
        return "\n".join(texts)


class BraveSearchService:
    """Brave Search MCP service"""
    
    IMAGE = "mcp/brave-search"
    
    def __init__(self, client: MCPClient, api_key: Optional[str] = None):
        self.client = client
        self.api_key = api_key or os.getenv("BRAVE_API_KEY")
    
    def is_available(self) -> bool:
        return self.client._check_image_available(self.IMAGE) and bool(self.api_key)
    
    def search(self, query: str, count: int = 5) -> List[Dict]:
        """Perform web search"""
        result = self.client.call_tool(
            self.IMAGE,
            "brave_web_search",
            {"query": query, "count": min(count, 20)},
            env_vars={"BRAVE_API_KEY": self.api_key}
        )
        
        if not result:
            return []
        
        try:
            content = result.get("content", [])
            results = []
            for item in content[:count]:
                if item.get("type") == "text":
                    data = json.loads(item.get("text", ""))
                    results.append({
                        "title": data.get("title", ""),
                        "url": data.get("url", ""),
                        "description": data.get("description", "")
                    })
            logger.info(f"Brave search for '{query}' returned {len(results)} results")
            return results
        except Exception as e:
            logger.error(f"Failed to parse search results: {e}")
            return []
    
    def search_formatted(self, query: str, count: int = 5) -> str:
        """Search and return formatted text for LLM context"""
        results = self.search(query, count)
        if not results:
            return f"No search results found for: {query}"
        
        formatted = [f"Web search results for: {query}\n"]
        for i, r in enumerate(results, 1):
            formatted.append(f"{i}. {r['title']}")
            formatted.append(f"   {r['description']}")
            formatted.append(f"   Source: {r['url']}\n")
        return "\n".join(formatted)


class Context7Service:
    """Context7 MCP service for code documentation"""
    
    IMAGE = "mcp/context7"
    
    def __init__(self, client: MCPClient):
        self.client = client
    
    def is_available(self) -> bool:
        return self.client._check_image_available(self.IMAGE)
    
    def resolve_library(self, library_name: str) -> Optional[str]:
        """
        Resolve a library name to a Context7-compatible ID
        
        Args:
            library_name: Library name (e.g., 'react', 'fastapi')
            
        Returns:
            Context7 library ID or None
        """
        result = self.client.call_tool(
            self.IMAGE,
            "resolve-library-id",
            {"libraryName": library_name}
        )
        
        if not result:
            return None
        
        # Parse the response to extract library ID
        text = self.client.get_text_content(result)
        # Look for library ID pattern like /org/project
        import re
        match = re.search(r'(/[\w-]+/[\w.-]+)', text)
        if match:
            return match.group(1)
        return None
    
    def get_docs(self, library_id: str, topic: Optional[str] = None, 
                 tokens: int = 5000) -> str:
        """
        Get documentation for a library
        
        Args:
            library_id: Context7 library ID (e.g., '/vercel/next.js')
            topic: Optional topic to focus on
            tokens: Max tokens to retrieve
            
        Returns:
            Documentation text
        """
        args = {
            "context7CompatibleLibraryID": library_id,
            "tokens": tokens
        }
        if topic:
            args["topic"] = topic
        
        result = self.client.call_tool(self.IMAGE, "get-library-docs", args)
        
        if not result:
            return ""
        
        return self.client.get_text_content(result)
    
    def lookup_docs(self, library_name: str, topic: Optional[str] = None) -> str:
        """
        Convenience method: resolve library and get docs in one call
        
        Args:
            library_name: Human-readable library name
            topic: Optional topic to focus on
            
        Returns:
            Documentation text or error message
        """
        library_id = self.resolve_library(library_name)
        if not library_id:
            return f"Could not find library: {library_name}"
        
        logger.info(f"Resolved '{library_name}' to '{library_id}'")
        docs = self.get_docs(library_id, topic=topic)
        
        if not docs:
            return f"No documentation found for {library_name}"
        
        return docs


class PlaywrightService:
    """Playwright MCP service for browser automation"""
    
    IMAGE = "mcp/playwright"
    
    def __init__(self, client: MCPClient):
        self.client = client
    
    def is_available(self) -> bool:
        return self.client._check_image_available(self.IMAGE)
    
    def navigate(self, url: str) -> str:
        """Navigate to a URL"""
        result = self.client.call_tool(self.IMAGE, "browser_navigate", {"url": url})
        if result:
            return self.client.get_text_content(result)
        return f"Failed to navigate to {url}"
    
    def snapshot(self) -> str:
        """Get accessibility snapshot of current page"""
        result = self.client.call_tool(self.IMAGE, "browser_snapshot", {})
        if result:
            return self.client.get_text_content(result)
        return "Failed to get page snapshot"
    
    def screenshot(self, filename: Optional[str] = None, full_page: bool = False) -> str:
        """Take a screenshot of the current page"""
        args = {"fullPage": full_page}
        if filename:
            args["filename"] = filename
        result = self.client.call_tool(self.IMAGE, "browser_take_screenshot", args)
        if result:
            return self.client.get_text_content(result)
        return "Failed to take screenshot"
    
    def click(self, element: str, ref: str) -> str:
        """Click on an element"""
        result = self.client.call_tool(self.IMAGE, "browser_click", {
            "element": element,
            "ref": ref
        })
        if result:
            return self.client.get_text_content(result)
        return f"Failed to click {element}"
    
    def type_text(self, element: str, ref: str, text: str, submit: bool = False) -> str:
        """Type text into an element"""
        result = self.client.call_tool(self.IMAGE, "browser_type", {
            "element": element,
            "ref": ref,
            "text": text,
            "submit": submit
        })
        if result:
            return self.client.get_text_content(result)
        return f"Failed to type into {element}"
    
    def get_page_content(self, url: str) -> str:
        """Navigate to URL and get page snapshot - convenience method"""
        self.navigate(url)
        return self.snapshot()
    
    def close(self) -> str:
        """Close the browser"""
        result = self.client.call_tool(self.IMAGE, "browser_close", {})
        if result:
            return self.client.get_text_content(result)
        return "Browser closed"


# Global instances
_mcp_client: Optional[MCPClient] = None
_brave_search: Optional[BraveSearchService] = None
_context7: Optional[Context7Service] = None
_playwright: Optional[PlaywrightService] = None


def get_mcp_client() -> MCPClient:
    """Get or create the global MCP client"""
    global _mcp_client
    if _mcp_client is None:
        _mcp_client = MCPClient()
    return _mcp_client


def get_brave_search() -> BraveSearchService:
    """Get or create the Brave Search service"""
    global _brave_search
    if _brave_search is None:
        _brave_search = BraveSearchService(get_mcp_client())
    return _brave_search


def get_context7() -> Context7Service:
    """Get or create the Context7 service"""
    global _context7
    if _context7 is None:
        _context7 = Context7Service(get_mcp_client())
    return _context7


def get_playwright() -> PlaywrightService:
    """Get or create the Playwright service"""
    global _playwright
    if _playwright is None:
        _playwright = PlaywrightService(get_mcp_client())
    return _playwright


# Backwards compatibility
def get_search_service() -> BraveSearchService:
    """Backwards compatible alias for get_brave_search"""
    return get_brave_search()


# Alias for old imports
MCPSearchService = BraveSearchService
SearchService = BraveSearchService
