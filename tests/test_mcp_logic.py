
import asyncio
import unittest
from unittest.mock import MagicMock, AsyncMock
from services.chat_service import ChatService

class TestMCPIntegration(unittest.TestCase):
    def test_intent_detection(self):
        # Mock LLM and MCP services
        mock_llm = MagicMock()
        mock_services = {
            'search': MagicMock(),
            'docker': MagicMock(),
            'thinking': MagicMock()
        }
        
        chat_service = ChatService(mock_llm, mcp_services=mock_services)
        
        # Test search intent
        tool, query = chat_service._detect_intent("search for latest news about space")
        self.assertEqual(tool, "search")
        self.assertEqual(query, "for latest news about space")
        
        # Test docker intent
        tool, query = chat_service._detect_intent("docker logs container_123")
        self.assertEqual(tool, "docker")
        
        # Test thinking intent
        tool, query = chat_service._detect_intent("let's think about how to solve this bug")
        self.assertEqual(tool, "thinking")

    def test_augmentation_calls(self):
        mock_llm = MagicMock()
        mock_search = MagicMock()
        mock_search.search.return_value = "Search Results"
        
        mock_services = {'search': mock_search}
        chat_service = ChatService(mock_llm, mcp_services=mock_services)
        
        # Set tools enabled
        chat_service._tools_enabled = True
        
        # Mock _augment_with_search to verify it's called
        chat_service._augment_with_search = MagicMock(return_value="Augmented Prompt")
        
        # Trigger response generation (simulated)
        prompt = "search for weather"
        gen = chat_service.generate_response(prompt)
        # Advance generator to trigger logic
        try:
            next(gen)
        except StopIteration:
            pass
            
        chat_service._augment_with_search.assert_called_once()

if __name__ == '__main__':
    unittest.main()
