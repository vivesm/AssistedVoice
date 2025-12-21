
import re
from typing import List, Dict

def chunk_text(text: str, max_chunk_size: int = 500) -> List[Dict]:
    if not text.strip():
        return []
    
    chunks = []
    sentence_pattern = re.compile(r'(.*?[.!?])(?:\s+|$)')
    matches = list(sentence_pattern.finditer(text))
    
    if not matches:
         return [{'text': text.strip(), 'start': 0, 'end': len(text)}]

    current_chunk_text = ""
    current_start = -1
    
    for match in matches:
        sentence = match.group(0)
        sentence_start = match.start()
        
        if current_chunk_text and len(current_chunk_text) + len(sentence) > max_chunk_size:
            chunks.append({
                'text': current_chunk_text.strip(),
                'start': current_start,
                'end': current_start + len(current_chunk_text)
            })
            current_chunk_text = ""
            current_start = -1

        if current_start == -1:
            current_start = sentence_start
        
        current_chunk_text += sentence
    
    if current_chunk_text.strip():
        chunks.append({
            'text': current_chunk_text.strip(),
            'start': current_start,
            'end': current_start + len(current_chunk_text)
        })
    
    return chunks

text = "The quick brown fox jumps over the lazy dog. Programming is a creative and rewarding endeavor. AI agents are here to help you solve complex tasks with ease. Let's build something amazing together."
chunks = chunk_text(text)
print(f"Total chunks: {len(chunks)}")
for i, c in enumerate(chunks):
    print(f"Chunk {i}: {c}")
