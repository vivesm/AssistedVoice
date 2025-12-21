"""
Search Service - Backwards compatibility wrapper
Use services.mcp_service for the full MCP integration
"""
from services.mcp_service import (
    MCPSearchService,
    SearchService, 
    get_search_service,
    get_brave_search,
    get_context7,
    get_playwright,
    BraveSearchService,
    Context7Service,
    PlaywrightService,
    MCPClient,
    get_mcp_client
)

__all__ = [
    'MCPSearchService',
    'SearchService',
    'get_search_service',
    'get_brave_search',
    'get_context7',
    'get_playwright',
    'BraveSearchService',
    'Context7Service', 
    'PlaywrightService',
    'MCPClient',
    'get_mcp_client'
]
