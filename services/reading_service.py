"""
Reading Mode Service
Handles text chunking, share.vives.io integration, and playback state management
"""
import re
import logging
from typing import List, Optional, Dict, Tuple
import httpx

logger = logging.getLogger(__name__)


class ReadingService:
    """Service for managing reading mode functionality"""
    
    def __init__(self, config: dict):
        """
        Initialize reading service
        
        Args:
            config: Application configuration dictionary
        """
        self.config = config
        self.reading_config = config.get('reading_mode', {})
        self.max_text_length = self.reading_config.get('max_text_length', 200000)
        self.chunk_size = self.reading_config.get('chunk_size', 500)
        self.share_base_url = self.reading_config.get('share_base_url', 'https://share.vives.io')
        self.fetch_timeout = self.reading_config.get('fetch_timeout', 10)
        
        # Session storage: sid -> session data
        self.sessions: Dict[str, Dict] = {}
        
    def chunk_text(self, text: str, max_chunk_size: int = None) -> List[Dict]:
        """
        Split text into manageable chunks for TTS, respecting sentence boundaries
        
        Args:
            text: Text to chunk
            max_chunk_size: Maximum characters per chunk (defaults to config value)
            
        Returns:
            List of dictionaries with 'text', 'start', and 'end' keys
        """
        if max_chunk_size is None:
            max_chunk_size = self.chunk_size
            
        if not text.strip():
            return []
        
        chunks = []
        
        # Split by sentences (periods, exclamation marks, question marks)
        # Using finditer to keep track of indices
        sentence_pattern = re.compile(r'(.*?[.!?])(?:\s+|$)', re.DOTALL)
        matches = list(sentence_pattern.finditer(text))
        
        if not matches:
             # Fallback if no sentence boundaries found
             return [{'text': text.strip(), 'start': 0, 'end': len(text)}]

        current_chunk_text = ""
        current_start = -1
        last_match_end = 0
        
        for match in matches:
            sentence = match.group(0)
            sentence_start = match.start()
            
            # If adding this sentence would exceed chunk size (unless chunk is empty)
            if current_chunk_text and len(current_chunk_text) + len(sentence) > max_chunk_size:
                # Save current chunk
                chunks.append({
                    'text': current_chunk_text.strip(),
                    'start': current_start,
                    'end': current_start + len(current_chunk_text)
                })
                # Reset
                current_chunk_text = ""
                current_start = -1

            if current_start == -1:
                current_start = sentence_start
            
            current_chunk_text += sentence
            last_match_end = match.end()
        
        # Add remaining text if any
        remaining = text[last_match_end:].strip()
        if remaining:
            if not current_chunk_text:
                current_start = last_match_end + (text[last_match_end:].find(remaining))
            current_chunk_text += remaining
        
        # Add final chunk
        if current_chunk_text.strip():
            chunks.append({
                'text': current_chunk_text.strip(),
                'start': current_start,
                'end': current_start + len(current_chunk_text)
            })
        
        return chunks
    
    async def fetch_share_content(self, share_code: str) -> Tuple[bool, str]:
        """
        Fetch content from share.vives.io using share code
        
        Args:
            share_code: Share code (e.g., "abc123")
            
        Returns:
            Tuple of (success: bool, content or error message: str)
        """
        try:
            # Construct URL
            url = f"{self.share_base_url}/{share_code}"
            
            logger.info(f"Fetching share content from: {url}")
            
            # Fetch content with timeout
            async with httpx.AsyncClient(timeout=self.fetch_timeout) as client:
                response = await client.get(url)
                
                if response.status_code == 200:
                    content = response.text
                    
                    # Validate content length
                    if len(content) > self.max_text_length:
                        return False, f"Content too large ({len(content)} chars). Maximum allowed: {self.max_text_length}"
                    
                    logger.info(f"Successfully fetched {len(content)} characters from share {share_code}")
                    return True, content
                    
                elif response.status_code == 404:
                    return False, f"Share code '{share_code}' not found"
                else:
                    return False, f"Failed to fetch share: HTTP {response.status_code}"
                    
        except httpx.TimeoutException:
            logger.error(f"Timeout fetching share {share_code}")
            return False, "Request timed out. Please try again."
            
        except Exception as e:
            logger.error(f"Error fetching share {share_code}: {e}")
            return False, f"Error fetching share: {str(e)}"
    
    def create_session(self, sid: str, text: str, source: str = "text") -> Dict:
        """
        Create a new reading session
        
        Args:
            sid: Socket ID
            text: Text to read
            source: Source of text ("text" or "share")
            
        Returns:
            Session data dictionary
        """
        # Validate text length
        if len(text) > self.max_text_length:
            raise ValueError(f"Text too large ({len(text)} chars). Maximum: {self.max_text_length}")
        
        # Chunk the text
        chunks = self.chunk_text(text)
        
        # Create session
        session = {
            'chunks': chunks,
            'current_index': 0,
            'state': 'stopped',  # stopped, playing, paused
            'original_text': text,
            'source': source,
            'total_chunks': len(chunks)
        }
        
        self.sessions[sid] = session
        logger.info(f"Created reading session for {sid}: {len(chunks)} chunks from {source}")
        
        return session
    
    def get_session(self, sid: str) -> Optional[Dict]:
        """Get reading session for socket ID"""
        return self.sessions.get(sid)
    
    def delete_session(self, sid: str) -> None:
        """Delete reading session"""
        if sid in self.sessions:
            del self.sessions[sid]
            logger.info(f"Deleted reading session for {sid}")
    
    def get_current_chunk(self, sid: str) -> Optional[Dict]:
        """Get current chunk dictionary"""
        session = self.get_session(sid)
        if not session:
            return None
        
        index = session['current_index']
        chunks = session['chunks']
        
        if 0 <= index < len(chunks):
            return chunks[index]
        return None
    
    def get_next_chunk(self, sid: str) -> Optional[Dict]:
        """
        Advance to next chunk and return it
        
        Returns:
            Next chunk dictionary, or None if at end
        """
        session = self.get_session(sid)
        if not session:
            return None
        
        session['current_index'] += 1
        
        if session['current_index'] >= len(session['chunks']):
            session['current_index'] = len(session['chunks']) - 1
            return None
        
        return session['chunks'][session['current_index']]
    
    def get_previous_chunk(self, sid: str) -> Optional[Dict]:
        """
        Go back to previous chunk and return it
        
        Returns:
            Previous chunk dictionary, or None if at beginning
        """
        session = self.get_session(sid)
        if not session:
            return None
        
        session['current_index'] -= 1
        
        if session['current_index'] < 0:
            session['current_index'] = 0
            return None
        
        return session['chunks'][session['current_index']]
    
    def seek_to_chunk(self, sid: str, chunk_index: int) -> Optional[Dict]:
        """
        Seek to specific chunk index
        
        Args:
            sid: Socket ID
            chunk_index: Target chunk index (0-based)
            
        Returns:
            Chunk dictionary at index, or None if invalid
        """
        session = self.get_session(sid)
        if not session:
            return None
        
        if 0 <= chunk_index < len(session['chunks']):
            session['current_index'] = chunk_index
            return session['chunks'][chunk_index]
        
        return None
    
    def reset_position(self, sid: str) -> None:
        """Reset playback position to beginning"""
        session = self.get_session(sid)
        if session:
            session['current_index'] = 0
            session['state'] = 'stopped'
    
    def set_state(self, sid: str, state: str) -> None:
        """
        Set playback state
        
        Args:
            sid: Socket ID
            state: New state ("playing", "paused", "stopped")
        """
        session = self.get_session(sid)
        if session:
            session['state'] = state
    
    def get_progress(self, sid: str) -> Optional[Dict]:
        """
        Get current progress information
        
        Returns:
            Dictionary with progress data, or None if no session
        """
        session = self.get_session(sid)
        if not session:
            return None
        
        current_index = session['current_index']
        total_chunks = session['total_chunks']
        
        # Calculate percentage
        if total_chunks > 0:
            percentage = ((current_index + 1) / total_chunks) * 100
        else:
            percentage = 0
        
        current_chunk = self.get_current_chunk(sid) or {}
        
        return {
            'current_chunk': current_index,
            'total_chunks': total_chunks,
            'current_text': current_chunk.get('text', ""),
            'start_offset': current_chunk.get('start', 0),
            'end_offset': current_chunk.get('end', 0),
            'progress_percentage': round(percentage, 1),
            'state': session['state'],
            'source': session['source']
        }
