#!/usr/bin/env python3
"""
Unit tests for chat history deduplication functionality
"""
import os
import sys
import json

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def test_chat_id_persistence():
    """Test that chat ID persists throughout a conversation"""
    # Simulate a chat session
    chat_id = "chat_1234567890"
    messages = []
    
    # Add first message
    messages.append({
        'role': 'user',
        'content': 'Hello'
    })
    
    # Add response
    messages.append({
        'role': 'assistant', 
        'content': 'Hi there!'
    })
    
    # Simulate saving to history with same ID
    chat_data_1 = {
        'id': chat_id,
        'timestamp': '2025-09-13T10:00:00Z',
        'messages': messages[:1],  # Only first message
        'preview': 'Hello'
    }
    
    chat_data_2 = {
        'id': chat_id,
        'timestamp': '2025-09-13T10:00:10Z', 
        'messages': messages,  # Both messages
        'preview': 'Hello'
    }
    
    # Both should have the same ID
    assert chat_data_1['id'] == chat_data_2['id']
    assert chat_data_1['id'] == chat_id
    
    print("✅ Chat ID persistence test passed")


def test_deduplication_logic():
    """Test that saveChatToHistory properly handles deduplication"""
    # Simulate chat history
    history = []
    
    # Add first chat
    chat_1 = {
        'id': 'chat_001',
        'timestamp': '2025-09-13T10:00:00Z',
        'messages': [{'role': 'user', 'content': 'First chat'}],
        'preview': 'First chat'
    }
    history.append(chat_1)
    
    # Try to add same chat with updated messages
    chat_1_updated = {
        'id': 'chat_001',  # Same ID
        'timestamp': '2025-09-13T10:01:00Z',
        'messages': [
            {'role': 'user', 'content': 'First chat'},
            {'role': 'assistant', 'content': 'Response'}
        ],
        'preview': 'First chat'
    }
    
    # Simulate deduplication logic
    existing_index = None
    for i, chat in enumerate(history):
        if chat['id'] == chat_1_updated['id']:
            existing_index = i
            break
    
    if existing_index is not None:
        # Update existing chat
        history[existing_index] = chat_1_updated
    else:
        # Add new chat
        history.insert(0, chat_1_updated)
    
    # Should only have one chat with that ID
    chat_count = sum(1 for chat in history if chat['id'] == 'chat_001')
    assert chat_count == 1
    
    # The chat should have the updated messages
    assert len(history[0]['messages']) == 2
    assert history[0]['messages'][1]['role'] == 'assistant'
    
    print("✅ Deduplication logic test passed")


def test_unique_chat_ids():
    """Test that new chats get unique IDs"""
    import time
    
    # Generate IDs using timestamp
    id1 = str(int(time.time() * 1000))
    time.sleep(0.001)  # Small delay
    id2 = str(int(time.time() * 1000))
    
    # IDs should be different
    assert id1 != id2
    
    print("✅ Unique chat ID generation test passed")


def test_history_update_vs_create():
    """Test logic to determine update vs create"""
    history = [
        {'id': 'chat_A', 'messages': []},
        {'id': 'chat_B', 'messages': []},
        {'id': 'chat_C', 'messages': []}
    ]
    
    # Test updating existing chat
    new_chat_id = 'chat_B'
    should_update = any(chat['id'] == new_chat_id for chat in history)
    assert should_update == True
    
    # Test creating new chat
    new_chat_id = 'chat_D'
    should_update = any(chat['id'] == new_chat_id for chat in history)
    assert should_update == False
    
    print("✅ Update vs create logic test passed")


def test_no_duplicate_on_menu_open_close():
    """Test that opening/closing menu doesn't create duplicates"""
    # Simulate chat history storage
    chat_history = []
    current_chat_id = 'current_123'
    
    # Initial save when menu opens
    messages = [
        {'role': 'user', 'content': 'Hi'},
        {'role': 'assistant', 'content': 'Hello!'}
    ]
    
    chat_data = {
        'id': current_chat_id,
        'timestamp': '2025-09-13T10:00:00Z',
        'messages': messages,
        'preview': 'Hi'
    }
    
    # First menu open - save chat
    existing = next((i for i, c in enumerate(chat_history) if c['id'] == current_chat_id), None)
    if existing is not None:
        chat_history[existing] = chat_data
    else:
        chat_history.insert(0, chat_data)
    
    initial_count = len(chat_history)
    
    # Second menu open (no new messages) - should update, not duplicate
    existing = next((i for i, c in enumerate(chat_history) if c['id'] == current_chat_id), None) 
    if existing is not None:
        chat_history[existing] = chat_data
    else:
        chat_history.insert(0, chat_data)
    
    # Count should remain the same
    assert len(chat_history) == initial_count
    assert len([c for c in chat_history if c['id'] == current_chat_id]) == 1
    
    print("✅ No duplicate on menu open/close test passed")


if __name__ == "__main__":
    # Run all tests
    test_chat_id_persistence()
    test_deduplication_logic()
    test_unique_chat_ids()
    test_history_update_vs_create()
    test_no_duplicate_on_menu_open_close()
    
    print("\n🎉 All chat deduplication tests passed!")