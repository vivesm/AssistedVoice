"""
SQLite Database Service for Chat Conversations
Provides persistent storage for conversations and messages
"""
import sqlite3
import json
import os
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from pathlib import Path

logger = logging.getLogger(__name__)


class DatabaseService:
    """SQLite database service for conversation storage"""
    
    def __init__(self, db_path: str = "data/conversations.db"):
        """Initialize database service
        
        Args:
            db_path: Path to SQLite database file
        """
        self.db_path = db_path
        self._ensure_data_dir()
        self._init_db()
    
    def _ensure_data_dir(self):
        """Ensure the data directory exists"""
        data_dir = Path(self.db_path).parent
        data_dir.mkdir(parents=True, exist_ok=True)
    
    def _get_connection(self) -> sqlite3.Connection:
        """Get a database connection with row factory"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    def _init_db(self):
        """Initialize database tables"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            
            # Create conversations table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    model TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            
            # Create messages table with model info
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    model TEXT,
                    metadata TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
                )
            """)
            
            # Create settings table for user preferences
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            
            # Create index for faster message lookups
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_messages_conversation 
                ON messages(conversation_id)
            """)
            
            # Enable foreign key support
            cursor.execute("PRAGMA foreign_keys = ON")
            
            # Migration: Add model column to existing messages table if missing
            cursor.execute("PRAGMA table_info(messages)")
            columns = [col[1] for col in cursor.fetchall()]
            if 'model' not in columns:
                cursor.execute("ALTER TABLE messages ADD COLUMN model TEXT")
                logger.info("Migrated messages table: added model column")
            
            conn.commit()
            logger.info(f"Database initialized at {self.db_path}")
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            raise
        finally:
            conn.close()
    
    def create_conversation(
        self, 
        conversation_id: str, 
        title: str = "New Chat",
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create a new conversation
        
        Args:
            conversation_id: Unique conversation ID
            title: Conversation title
            model: LLM model used
            
        Returns:
            Created conversation dict
        """
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO conversations (id, title, model, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
            """, (conversation_id, title, model, now, now))
            conn.commit()
            
            return {
                "id": conversation_id,
                "title": title,
                "model": model,
                "created_at": now,
                "updated_at": now,
                "messages": []
            }
        except sqlite3.IntegrityError:
            # Conversation already exists, return existing
            return self.get_conversation(conversation_id)
        finally:
            conn.close()
    
    def get_conversation(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        """Get a conversation with all its messages
        
        Args:
            conversation_id: Conversation ID to retrieve
            
        Returns:
            Conversation dict with messages, or None if not found
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            
            # Get conversation
            cursor.execute(
                "SELECT * FROM conversations WHERE id = ?", 
                (conversation_id,)
            )
            row = cursor.fetchone()
            
            if not row:
                return None
            
            conversation = dict(row)
            
            # Get messages
            cursor.execute("""
                SELECT role, content, model, metadata, created_at 
                FROM messages 
                WHERE conversation_id = ? 
                ORDER BY id ASC
            """, (conversation_id,))
            
            messages = []
            for msg_row in cursor.fetchall():
                msg = {
                    "role": msg_row["role"],
                    "content": msg_row["content"],
                    "created_at": msg_row["created_at"]
                }
                if msg_row["model"]:
                    msg["model"] = msg_row["model"]
                if msg_row["metadata"]:
                    try:
                        msg["metadata"] = json.loads(msg_row["metadata"])
                    except json.JSONDecodeError:
                        pass
                messages.append(msg)
            
            conversation["messages"] = messages
            return conversation
        finally:
            conn.close()
    
    def get_all_conversations(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get all conversations (without full messages)
        
        Args:
            limit: Maximum number of conversations to return
            
        Returns:
            List of conversation dicts with message count
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 
                    c.*,
                    COUNT(m.id) as message_count,
                    (SELECT content FROM messages 
                     WHERE conversation_id = c.id AND role = 'user' 
                     ORDER BY id ASC LIMIT 1) as preview
                FROM conversations c
                LEFT JOIN messages m ON c.id = m.conversation_id
                GROUP BY c.id
                ORDER BY c.updated_at DESC
                LIMIT ?
            """, (limit,))
            
            conversations = []
            for row in cursor.fetchall():
                conv = {
                    "id": row["id"],
                    "title": row["title"],
                    "model": row["model"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                    "message_count": row["message_count"],
                    "preview": row["preview"][:60] if row["preview"] else None
                }
                conversations.append(conv)
            
            return conversations
        finally:
            conn.close()
    
    def update_conversation(
        self, 
        conversation_id: str, 
        title: Optional[str] = None,
        model: Optional[str] = None
    ) -> bool:
        """Update conversation metadata
        
        Args:
            conversation_id: Conversation ID to update
            title: New title (optional)
            model: New model (optional)
            
        Returns:
            True if updated, False if not found
        """
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            
            updates = ["updated_at = ?"]
            params = [now]
            
            if title is not None:
                updates.append("title = ?")
                params.append(title)
            if model is not None:
                updates.append("model = ?")
                params.append(model)
            
            params.append(conversation_id)
            
            cursor.execute(f"""
                UPDATE conversations 
                SET {', '.join(updates)}
                WHERE id = ?
            """, params)
            
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()
    
    def delete_conversation(self, conversation_id: str) -> bool:
        """Delete a conversation and all its messages
        
        Args:
            conversation_id: Conversation ID to delete
            
        Returns:
            True if deleted, False if not found
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            
            # Delete messages first (in case FK not working)
            cursor.execute(
                "DELETE FROM messages WHERE conversation_id = ?",
                (conversation_id,)
            )
            
            # Delete conversation
            cursor.execute(
                "DELETE FROM conversations WHERE id = ?",
                (conversation_id,)
            )
            
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()
    
    def add_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        model: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Add a message to a conversation
        
        Args:
            conversation_id: Conversation ID
            role: Message role (user, assistant, system)
            content: Message content
            model: LLM model used for this message (for assistant messages)
            metadata: Optional metadata dict (can include settings, timing, etc.)
            
        Returns:
            Created message dict
        """
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        metadata_json = json.dumps(metadata) if metadata else None
        
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            
            # Ensure conversation exists
            cursor.execute(
                "SELECT id FROM conversations WHERE id = ?",
                (conversation_id,)
            )
            if not cursor.fetchone():
                # Auto-create conversation
                self.create_conversation(conversation_id, model=model)
            
            # Insert message with model info
            cursor.execute("""
                INSERT INTO messages (conversation_id, role, content, model, metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (conversation_id, role, content, model, metadata_json, now))
            
            # Update conversation timestamp and model
            if model:
                cursor.execute("""
                    UPDATE conversations SET updated_at = ?, model = ? WHERE id = ?
                """, (now, model, conversation_id))
            else:
                cursor.execute("""
                    UPDATE conversations SET updated_at = ? WHERE id = ?
                """, (now, conversation_id))
            
            # Update title if this is first user message
            cursor.execute("""
                SELECT COUNT(*) FROM messages 
                WHERE conversation_id = ? AND role = 'user'
            """, (conversation_id,))
            user_msg_count = cursor.fetchone()[0]
            
            if user_msg_count == 1 and role == 'user':
                title = content[:50] if len(content) > 50 else content
                cursor.execute("""
                    UPDATE conversations SET title = ? WHERE id = ?
                """, (title, conversation_id))
            
            conn.commit()
            
            return {
                "id": cursor.lastrowid,
                "conversation_id": conversation_id,
                "role": role,
                "content": content,
                "model": model,
                "metadata": metadata,
                "created_at": now
            }
        finally:
            conn.close()
    
    def save_full_conversation(
        self,
        conversation_id: str,
        messages: List[Dict[str, Any]],
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """Save or update a full conversation with messages
        
        Args:
            conversation_id: Conversation ID
            messages: List of message dicts with role and content
            model: LLM model used
            
        Returns:
            Saved conversation dict
        """
        # Get title from first user message
        title = "New Chat"
        for msg in messages:
            if msg.get("role") == "user" and msg.get("content"):
                title = msg["content"][:50]
                break
        
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            
            # Upsert conversation
            cursor.execute("""
                INSERT INTO conversations (id, title, model, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET 
                    title = excluded.title,
                    model = excluded.model,
                    updated_at = excluded.updated_at
            """, (conversation_id, title, model, now, now))
            
            # Delete existing messages
            cursor.execute(
                "DELETE FROM messages WHERE conversation_id = ?",
                (conversation_id,)
            )
            
            # Insert all messages with model info
            for msg in messages:
                metadata_json = json.dumps(msg.get("metadata")) if msg.get("metadata") else None
                msg_model = msg.get("model", model) if msg.get("role") == "assistant" else None
                cursor.execute("""
                    INSERT INTO messages (conversation_id, role, content, model, metadata, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    conversation_id,
                    msg.get("role", "user"),
                    msg.get("content", ""),
                    msg_model,
                    metadata_json,
                    msg.get("created_at", now)
                ))
            
            conn.commit()
            
            return self.get_conversation(conversation_id)
        finally:
            conn.close()
    
    # ========== Settings Methods ==========
    
    def get_setting(self, key: str) -> Optional[Any]:
        """Get a setting value
        
        Args:
            key: Setting key
            
        Returns:
            Setting value (JSON decoded) or None if not found
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM settings WHERE key = ?", (key,))
            row = cursor.fetchone()
            if row:
                try:
                    return json.loads(row["value"])
                except json.JSONDecodeError:
                    return row["value"]
            return None
        finally:
            conn.close()
    
    def set_setting(self, key: str, value: Any) -> bool:
        """Set a setting value
        
        Args:
            key: Setting key
            value: Setting value (will be JSON encoded)
            
        Returns:
            True if successful
        """
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        value_json = json.dumps(value)
        
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET 
                    value = excluded.value,
                    updated_at = excluded.updated_at
            """, (key, value_json, now))
            conn.commit()
            return True
        except Exception as e:
            logger.error(f"Failed to set setting {key}: {e}")
            return False
        finally:
            conn.close()
    
    def get_all_settings(self) -> Dict[str, Any]:
        """Get all settings
        
        Returns:
            Dict of all settings
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT key, value FROM settings")
            settings = {}
            for row in cursor.fetchall():
                try:
                    settings[row["key"]] = json.loads(row["value"])
                except json.JSONDecodeError:
                    settings[row["key"]] = row["value"]
            return settings
        finally:
            conn.close()
    
    def delete_setting(self, key: str) -> bool:
        """Delete a setting
        
        Args:
            key: Setting key to delete
            
        Returns:
            True if deleted, False if not found
        """
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM settings WHERE key = ?", (key,))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()

