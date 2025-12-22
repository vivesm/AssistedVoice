# Build stage
FROM python:3.11-slim AS builder

# Install build dependencies
# portaudio19-dev is required to compile pyaudio
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Production stage
FROM python:3.11-slim

# Install runtime dependencies
# - portaudio: required for pyaudio (audio recording)
# - ffmpeg: audio processing for edge-tts
# - libsndfile1: audio file I/O
RUN apt-get update && apt-get install -y --no-install-recommends \
    portaudio19-dev \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser

# Set working directory
WORKDIR /app

# Copy application code
COPY --chown=appuser:appuser . .

# Create directories for persistent data
RUN mkdir -p /app/logs /app/models /app/data /app/signal_data && \
    chown -R appuser:appuser /app/logs /app/models /app/data /app/signal_data

# Switch to non-root user
USER appuser

# Environment variables
ENV HOST=0.0.0.0
ENV PORT=5001
ENV FLASK_DEBUG=False
ENV PYTHONUNBUFFERED=1

# Expose port
EXPOSE 5001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:5001/ || exit 1

# Default command
CMD ["python", "web_assistant.py"]
