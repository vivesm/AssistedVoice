
import re

def chunk_text(text: str):
    if not text.strip():
        return []
    
    chunks = []
    # Simplified regex for testing
    sentence_pattern = re.compile(r'(.*?[.!?])(?:\s+|$)')
    matches = list(sentence_pattern.finditer(text))
    
    print(f"Matches found: {len(matches)}")
    if not matches:
         return [{'text': text.strip(), 'start': 0, 'end': len(text)}]

    for i, match in enumerate(matches):
        sentence = match.group(1).strip()
        print(f"Match {i}: group(1)='{sentence}', start={match.start()}, end={match.end()}")
        if not sentence:
            continue
            
        chunks.append({
            'text': sentence,
            'start': match.start(),
            'end': match.start() + len(sentence)
        })
    
    return chunks

text = "The quick brown fox jumps over the lazy dog. Programming is a creative and rewarding endeavor. AI agents are here to help you solve complex tasks with ease. Let's build something amazing together."
chunks = chunk_text(text)
print(f"Total chunks: {len(chunks)}")
