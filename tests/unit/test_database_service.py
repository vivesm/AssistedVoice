#!/usr/bin/env python3
"""
Unit tests for DatabaseService
"""
import os
import sys
import tempfile
import pytest

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from services.database_service import DatabaseService


class TestDatabaseService:
    """Tests for DatabaseService"""

    @pytest.fixture
    def db(self):
        """Create a temporary database for testing"""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test.db")
            service = DatabaseService(db_path=db_path)
            yield service

    def test_init_creates_tables(self, db):
        """Test that initialization creates the required tables"""
        import sqlite3
        conn = sqlite3.connect(db.db_path)
        cursor = conn.cursor()
        
        # Check conversations table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'")
        assert cursor.fetchone() is not None
        
        # Check messages table exists
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
        assert cursor.fetchone() is not None
        
        conn.close()

    def test_create_conversation(self, db):
        """Test creating a new conversation"""
        conv = db.create_conversation("test-123", "Test Chat", "llama3")
        
        assert conv["id"] == "test-123"
        assert conv["title"] == "Test Chat"
        assert conv["model"] == "llama3"
        assert "created_at" in conv
        assert "messages" in conv

    def test_add_message(self, db):
        """Test adding a message to a conversation"""
        db.create_conversation("conv-1", "My Chat")
        
        msg = db.add_message("conv-1", "user", "Hello, world!")
        
        assert msg["role"] == "user"
        assert msg["content"] == "Hello, world!"
        assert msg["conversation_id"] == "conv-1"

    def test_get_conversation_with_messages(self, db):
        """Test getting a conversation with all its messages"""
        db.create_conversation("conv-2", "Chat with Messages")
        db.add_message("conv-2", "user", "First message")
        db.add_message("conv-2", "assistant", "Second message")
        
        conv = db.get_conversation("conv-2")
        
        assert conv is not None
        assert len(conv["messages"]) == 2
        assert conv["messages"][0]["role"] == "user"
        assert conv["messages"][1]["role"] == "assistant"

    def test_get_all_conversations(self, db):
        """Test listing all conversations"""
        db.create_conversation("conv-a", "First")
        db.create_conversation("conv-b", "Second")
        db.create_conversation("conv-c", "Third")
        
        convs = db.get_all_conversations()
        
        assert len(convs) == 3

    def test_delete_conversation(self, db):
        """Test deleting a conversation"""
        db.create_conversation("del-conv", "To Delete")
        db.add_message("del-conv", "user", "This will be deleted")
        
        result = db.delete_conversation("del-conv")
        
        assert result is True
        assert db.get_conversation("del-conv") is None

    def test_save_full_conversation(self, db):
        """Test saving a full conversation with messages"""
        messages = [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there!"},
            {"role": "user", "content": "How are you?"}
        ]
        
        conv = db.save_full_conversation("full-conv", messages, "gpt-4")
        
        assert conv["id"] == "full-conv"
        assert len(conv["messages"]) == 3

    def test_auto_create_conversation_on_message(self, db):
        """Test that adding a message auto-creates conversation if needed"""
        msg = db.add_message("auto-conv", "user", "Auto-created!")
        
        assert msg is not None
        conv = db.get_conversation("auto-conv")
        assert conv is not None

    def test_title_auto_update(self, db):
        """Test that title updates from first user message"""
        db.create_conversation("title-test", "New Chat")
        db.add_message("title-test", "user", "My actual question about Python")
        
        conv = db.get_conversation("title-test")
        assert "Python" in conv["title"] or conv["title"] == "My actual question about Python"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
