"""
Pydantic models for request/response validation
"""
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


# Configuration Models
class WhisperConfig(BaseModel):
    """Whisper STT configuration"""
    model: str = Field(..., description="Whisper model name")


class LLMConfig(BaseModel):
    """LLM configuration"""
    model: str = Field(..., description="Model name")
    temperature: float = Field(0.7, description="Temperature setting")
    max_tokens: int = Field(500, description="Maximum tokens")


class TTSConfig(BaseModel):
    """TTS configuration"""
    engine: str = Field(..., description="TTS engine name")


class ServerConfig(BaseModel):
    """Server type configuration"""
    type: str = Field(..., description="Server type (ollama/lm-studio)")


class ConfigResponse(BaseModel):
    """Complete configuration response"""
    whisper: WhisperConfig
    ollama: LLMConfig
    lm_studio: LLMConfig
    tts: TTSConfig
    server: ServerConfig


# Model Management
class ModelInfo(BaseModel):
    "\"\"Model information with name and capabilities\"\""
    name: str = Field(..., description="Model name")
    capabilities: List[str] = Field(default_factory=list, description="Model capabilities (vision, tools, etc.)")


class ModelListResponse(BaseModel):
    "\"\"Available models response\"\""
    models: List[ModelInfo] = Field(..., description="List of available models with metadata")
    current: str = Field(..., description="Currently selected model")


class ModelSwitchRequest(BaseModel):
    "\"\"Request to switch model\"\""
    model: str = Field(..., description="Model name to switch to")


# Audio Processing
class AudioProcessRequest(BaseModel):
    "\"\"Audio processing request\"\""
    audio: str = Field(..., description="Base64-encoded audio data")
    enable_tts: bool = Field(True, description="Enable TTS response")


class TranscriptionResponse(BaseModel):
    "\"\"Transcription result\"\""
    text: str = Field(..., description="Transcribed text")


# Chat
class ChatRequest(BaseModel):
    "\"\"Text chat request\"\""
    text: str = Field(..., description="User input text")
    enable_tts: bool = Field(True, description="Enable TTS response")


class ChatResponse(BaseModel):
    "\"\"Chat response\"\""
    text: str = Field(..., description="Response text")
    model: str = Field(..., description="Model used for response")


# TTS
class TTSEngineRequest(BaseModel):
    "\"\"TTS engine selection request\"\""
    engine: str = Field(..., description="TTS engine to use")


class TTSVoiceRequest(BaseModel):
    "\"\"TTS voice selection request\"\""
    voice: str = Field(..., description="Voice to use")


# Connection Testing
class ConnectionTestResponse(BaseModel):
    "\"\"Connection test result\"\""
    success: bool = Field(..., description="Connection status")
    message: str = Field(..., description="Status message")


# Settings Updates
class TemperatureUpdateRequest(BaseModel):
    "\"\"Temperature update request\"\""
    temperature: float = Field(..., ge=0.0, le=2.0, description="Temperature value (0.0-2.0)")


class MaxTokensUpdateRequest(BaseModel):
    "\"\"Max tokens update request\"\""
    max_tokens: int = Field(..., gt=0, description="Maximum tokens (must be positive)")


class SystemPromptUpdateRequest(BaseModel):
    "\"\"System prompt update request\"\""
    system_prompt: str = Field(..., description="New system prompt")


class WhisperModelRequest(BaseModel):
    "\"\"Whisper model selection request\"\""
    model: str = Field(..., description="Whisper model name")


# Error Response
class ErrorResponse(BaseModel):
    "\"\"Error response\"\""
    error: str = Field(..., description="Error message")
    detail: Optional[str] = Field(None, description="Detailed error information")


# WebSocket Event Payloads
class StatusEvent(BaseModel):
    "\"\"Status update event\"\""
    message: str = Field(..., description="Status message")
    type: str = Field(..., description="Status type (processing/transcribing/generating/speaking/ready)")


class TranscriptionEvent(BaseModel):
    "\"\"Transcription event\"\""
    text: str = Field(..., description="Transcribed text")


class ResponseChunkEvent(BaseModel):
    "\"\"Response chunk event\"\""
    text: str = Field(..., description="Text chunk")
    model: str = Field(..., description="Model name")


class ResponseCompleteEvent(BaseModel):
    "\"\"Response complete event\"\""
    text: str = Field(..., description="Complete response text")
    model: str = Field(..., description="Model name")


class AudioDataEvent(BaseModel):
    "\"\"Audio data event\"\""
    audio: str = Field(..., description="Base64-encoded audio data")


class ErrorEvent(BaseModel):
    "\"\"Error event\"\""
    message: str = Field(..., description="Error message")


class ModelChangedEvent(BaseModel):
    "\"\"Model changed event\"\""
    model: str = Field(..., description="New model name")


class TTSChangedEvent(BaseModel):
    "\"\"TTS engine changed event\"\""
    engine: str = Field(..., description="New TTS engine")


class WhisperModelChangedEvent(BaseModel):
    "\"\"Whisper model changed event\"\""
    model: str = Field(..., description="New Whisper model")


# Generic Success Response
class SuccessResponse(BaseModel):
    "\"\"Generic success response\"\""
    success: bool = Field(True, description="Operation success status")
    message: Optional[str] = Field(None, description="Success message")
