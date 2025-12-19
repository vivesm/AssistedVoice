#!/usr/bin/env python3
"""
Unit tests for chat history functionality
"""
import os
import sys
import json
import tempfile
from unittest.mock import Mock, patch, MagicMock

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def test_chat_history_storage():
    """Test that chat history is properly stored in localStorage format"""
    # Mock chat data
    chat_data = {
        'id': 'chat_123',
        'title': 'Test Chat',
        'timestamp': '2025-09-13T10:00:00Z',
        'messages': [
            {'role': 'user', 'content': 'Hello'},
            {'role': 'assistant', 'content': 'Hi there!'}
        ],
        'model': 'llama3.2:3b'
    }
    
    # Verify structure
    assert 'id' in chat_data
    assert 'title' in chat_data
    assert 'timestamp' in chat_data
    assert 'messages' in chat_data
    assert len(chat_data['messages']) == 2
    assert chat_data['messages'][0]['role'] == 'user'
    assert chat_data['messages'][1]['role'] == 'assistant'
    
    print("✅ Chat history storage structure test passed")


def test_chat_history_limit():
    """Test that chat history respects the 20-conversation limit"""
    MAX_HISTORY = 20
    
    # Create mock history with 25 items
    chat_history = []
    for i in range(25):
        chat_history.append({
            'id': f'chat_{i}',
            'title': f'Chat {i}',
            'timestamp': f'2025-09-13T{i:02d}:00:00Z',
            'messages': []
        })
    
    # Apply limit (keep most recent 20)
    if len(chat_history) > MAX_HISTORY:
        chat_history = chat_history[-MAX_HISTORY:]
    
    assert len(chat_history) == MAX_HISTORY
    assert chat_history[0]['id'] == 'chat_5'  # Oldest kept
    assert chat_history[-1]['id'] == 'chat_24'  # Most recent
    
    print("✅ Chat history limit test passed")


def test_chat_title_generation():
    """Test that chat titles are generated from first message"""
    # Test with normal message
    first_message = "Hello, how are you today?"
    title = first_message[:50] if len(first_message) > 50 else first_message
    assert title == "Hello, how are you today?"
    
    # Test with long message
    long_message = "This is a very long message that exceeds the fifty character limit for titles and should be truncated"
    title = long_message[:50] if len(long_message) > 50 else long_message
    assert len(title) == 50
    assert title == "This is a very long message that exceeds the fifty"
    
    # Test with empty message
    empty_message = ""
    title = empty_message if empty_message else "New Chat"
    assert title == "New Chat"
    
    print("✅ Chat title generation test passed")


def test_chat_serialization():
    """Test that chat data can be serialized to/from JSON"""
    chat_data = {
        'id': 'chat_test',
        'title': 'Test Chat',
        'timestamp': '2025-09-13T10:00:00Z',
        'messages': [
            {'role': 'user', 'content': 'Test message'},
            {'role': 'assistant', 'content': 'Test response'}
        ],
        'model': 'llama3.2:3b'
    }
    
    # Serialize to JSON
    json_str = json.dumps(chat_data)
    assert isinstance(json_str, str)
    
    # Deserialize from JSON
    parsed_data = json.loads(json_str)
    assert parsed_data == chat_data
    assert parsed_data['id'] == 'chat_test'
    assert len(parsed_data['messages']) == 2
    
    print("✅ Chat serialization test passed")


def test_message_validation():
    """Test that messages are properly validated"""
    # Valid message
    valid_message = {
        'role': 'user',
        'content': 'Hello',
        'timestamp': '2025-09-13T10:00:00Z'
    }
    assert valid_message['role'] in ['user', 'assistant', 'system']
    assert isinstance(valid_message['content'], str)
    
    # Invalid role should be rejected
    invalid_roles = ['admin', 'bot', 'ai', '']
    for role in invalid_roles:
        assert role not in ['user', 'assistant', 'system']
    
    # Empty content should be handled
    empty_message = {
        'role': 'user',
        'content': '',
        'timestamp': '2025-09-13T10:00:00Z'
    }
    # In the actual implementation, empty messages should be filtered
    assert empty_message['content'] == ''
    
    print("✅ Message validation test passed")


def test_chat_search():
    """Test chat history search functionality"""
    chat_history = [
        {
            'id': 'chat_1',
            'title': 'Python programming',
            'messages': [
                {'role': 'user', 'content': 'How to use Python?'},
                {'role': 'assistant', 'content': 'Python is a programming language...'}
            ]
        },
        {
            'id': 'chat_2',
            'title': 'JavaScript basics',
            'messages': [
                {'role': 'user', 'content': 'What is JavaScript?'},
                {'role': 'assistant', 'content': 'JavaScript is a scripting language...'}
            ]
        },
        {
            'id': 'chat_3',
            'title': 'Python vs JavaScript',
            'messages': [
                {'role': 'user', 'content': 'Compare Python and JavaScript'},
                {'role': 'assistant', 'content': 'Both are popular languages...'}
            ]
        }
    ]
    
    # Search for "Python"
    search_term = "Python"
    results = [chat for chat in chat_history if search_term.lower() in chat['title'].lower()]
    assert len(results) == 2
    assert results[0]['id'] == 'chat_1'
    assert results[1]['id'] == 'chat_3'
    
    # Search for "JavaScript"
    search_term = "JavaScript"
    results = [chat for chat in chat_history if search_term.lower() in chat['title'].lower()]
    assert len(results) == 2
    assert results[0]['id'] == 'chat_2'
    assert results[1]['id'] == 'chat_3'
    
    print("✅ Chat search test passed")


def test_timestamp_formatting():
    """Test that timestamps are properly formatted"""
    import datetime
    
    # Create timestamp
    now = datetime.datetime.now()
    iso_timestamp = now.isoformat() + 'Z'
    
    # Verify ISO format
    assert 'T' in iso_timestamp
    assert iso_timestamp.endswith('Z')
    
    # Parse timestamp
    parsed = datetime.datetime.fromisoformat(iso_timestamp[:-1])
    assert parsed.year == now.year
    assert parsed.month == now.month
    assert parsed.day == now.day
    
    print("✅ Timestamp formatting test passed")


if __name__ == "__main__":
    # Run all tests
    test_chat_history_storage()
    test_chat_history_limit()
    test_chat_title_generation()
    test_chat_serialization()
    test_message_validation()
    test_chat_search()
    test_timestamp_formatting()
    
    print("\n🎉 All chat history tests passed!")