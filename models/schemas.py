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
    type: str = Field(..., description="Server type")


class ConfigResponse(BaseModel):
    """Complete configuration response"""
    whisper: WhisperConfig
    ollama: LLMConfig
    lm_studio: LLMConfig
    tts: TTSConfig
    server: ServerConfig


# Model Management
class ModelListResponse(BaseModel):
    """Available models response"""
    models: List[str] = Field(..., description="List of available models")
    current: str = Field(..., description="Currently selected model")


class ModelSwitchRequest(BaseModel):
    """Request to switch model"""
    model: str = Field(..., description="Model name to switch to")

class BackendSwitchRequest(BaseModel):
    """Request to switch backend"""
    type: str = Field(..., description="Backend type (ollama, openai, gemini, lm-studio)")
    model: Optional[str] = Field(None, description="Optional model name for the backend")


# Audio Processing
class AudioProcessRequest(BaseModel):
    """Audio processing request"""
    audio: str = Field(..., description="Base64-encoded audio data")
    enable_tts: bool = Field(True, description="Enable TTS response")


class TranscriptionResponse(BaseModel):
    """Transcription result"""
    text: str = Field(..., description="Transcribed text")


# Chat
class ChatRequest(BaseModel):
    """Text chat request"""
    text: str = Field(..., description="User input text")
    images: Optional[List[str]] = Field(None, description="Optional image data as base64 or paths")
    enable_tts: bool = Field(False, description="Enable TTS response")


class ChatResponse(BaseModel):
    """Chat response"""
    text: str = Field(..., description="Response text")
    model: str = Field(..., description="Model used for response")


# TTS
class TTSEngineRequest(BaseModel):
    """TTS engine selection request"""
    engine: str = Field(..., description="TTS engine to use")


class TTSVoiceRequest(BaseModel):
    """TTS voice selection request"""
    voice: str = Field(..., description="Voice to use")


# Connection Testing
class ConnectionTestResponse(BaseModel):
    """Connection test result"""
    success: bool = Field(..., description="Connection status")
    message: str = Field(..., description="Status message")


# Generic Success Response
class SuccessResponse(BaseModel):
    """Generic success response"""
    success: bool = Field(True, description="Operation success status")
    message: Optional[str] = Field(None, description="Success message")
