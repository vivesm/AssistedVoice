"""
Live Assistant Service
Manages continuous transcription and AI insights
"""
import time
from typing import List, Dict


class LiveAssistantService:
    """Simple service for live assistant mode"""

    def __init__(self, chat_service, buffer_duration=60):
        """
        Initialize live assistant service

        Args:
            chat_service: ChatService instance for AI generation
            buffer_duration: How many seconds of transcript to keep (default: 60)
        """
        self.chat_service = chat_service
        self.buffer_duration = buffer_duration
        self.transcript_buffer: List[Dict] = []
        self.chunk_count = 0
        self.recent_transcripts: List[Dict] = []  # Track recent transcripts for deduplication
        self.dedupe_window = 10  # Deduplication window in seconds

    def add_transcript(self, text: str) -> None:
        """
        Add transcribed text to buffer with deduplication

        Args:
            text: Transcribed text from audio chunk
        """
        if not text or not text.strip():
            return

        current_time = time.time()
        normalized_text = text.strip().lower()

        # Check for duplicate within deduplication window
        for recent in self.recent_transcripts:
            if current_time - recent['timestamp'] <= self.dedupe_window:
                if recent['text'].strip().lower() == normalized_text:
                    # Duplicate found - skip adding
                    return

        # Not a duplicate - add to buffers
        transcript_entry = {
            'text': text,
            'timestamp': current_time
        }

        self.transcript_buffer.append(transcript_entry)
        self.recent_transcripts.append(transcript_entry)

        self.chunk_count += 1
        self._clean_buffer()

    def _clean_buffer(self) -> None:
        """Remove transcript entries older than buffer_duration and dedupe window"""
        current_time = time.time()

        # Clean main transcript buffer
        self.transcript_buffer = [
            entry for entry in self.transcript_buffer
            if current_time - entry['timestamp'] <= self.buffer_duration
        ]

        # Clean recent transcripts cache (for deduplication)
        self.recent_transcripts = [
            entry for entry in self.recent_transcripts
            if current_time - entry['timestamp'] <= self.dedupe_window
        ]

    def should_generate_insight(self, interval_chunks: int = 3) -> bool:
        """
        Determine if it's time to generate AI insight

        Args:
            interval_chunks: Generate insight every N chunks (default: 3)

        Returns:
            True if should generate insight
        """
        # Generate every interval_chunks (e.g., every 3 chunks = 15 seconds)
        return self.chunk_count % interval_chunks == 0 and len(self.transcript_buffer) > 0

    def get_full_transcript(self) -> str:
        """Get all buffered transcript as single string"""
        return ' '.join([entry['text'] for entry in self.transcript_buffer])

    def generate_insight(self) -> Dict[str, str]:
        """
        Generate AI insight from current transcript buffer

        Returns:
            Dict with 'topic' and 'key_points' keys
        """
        full_transcript = self.get_full_transcript()

        if not full_transcript.strip():
            return {
                'topic': 'Listening...',
                'key_points': ['No speech detected yet']
            }

        # Create concise prompt for AI
        prompt = f"""You are a silent assistant listening to a conversation. Your role is to observe, understand context, and provide helpful suggestions when you have something genuinely useful to contribute.

DO NOT just summarize what was said. Instead:
- Wait until you understand the full context
- Identify what the person might need help with
- Offer actionable advice, suggestions, or relevant information
- Point out important details they might have missed
- If the conversation lacks clear context or purpose, acknowledge you're still listening

Transcript (last 60 seconds):
{full_transcript}

Provide helpful insights in this EXACT format (no markdown, natural language only):
TOPIC: [Brief description of what you understand is happening - max 10 words]
POINTS:
- [Actionable suggestion or helpful observation - max 15 words]
- [Another useful insight or advice - max 15 words]
- [Important detail or recommendation - max 15 words]

Keep it concise, practical, and conversational. Speak naturally as if advising a friend."""

        try:
            # Generate using existing chat service
            response = ""
            for chunk in self.chat_service.generate_response(prompt, stream=False):
                response += chunk

            # Parse response
            topic, key_points = self._parse_insight_response(response)

            return {
                'topic': topic,
                'key_points': key_points
            }

        except Exception as e:
            return {
                'topic': 'Error generating insight',
                'key_points': [str(e)]
            }

    def _parse_insight_response(self, response: str) -> tuple:
        """
        Parse AI response into topic and key points

        Args:
            response: Raw AI response text

        Returns:
            Tuple of (topic, key_points_list)
        """
        topic = "Analyzing conversation..."
        key_points = []

        lines = response.strip().split('\n')

        for line in lines:
            line = line.strip()

            # Extract topic
            if line.startswith('TOPIC:'):
                topic = line.replace('TOPIC:', '').strip()

            # Extract bullet points
            elif line.startswith('-') or line.startswith('•'):
                point = line.lstrip('-•').strip()
                if point:
                    key_points.append(point)

        # Fallback if parsing failed
        if not key_points:
            # Try to extract any meaningful sentences
            sentences = [s.strip() for s in response.split('.') if len(s.strip()) > 10]
            key_points = sentences[:3] if sentences else ['Processing transcript...']

        return topic, key_points

    def clear(self) -> None:
        """Clear all transcript buffers and deduplication cache"""
        self.transcript_buffer = []
        self.recent_transcripts = []
        self.chunk_count = 0
