/**
 * Shared state management for AssistedVoice
 */

export const state = {
    socket: null,
    mediaRecorder: null,
    audioStream: null,
    audioChunks: [],
    isRecording: false,
    ttsEnabled: true,
    currentTTSEngine: 'edge-tts',
    currentModel: null,
    audioQueue: [],
    isPlayingAudio: false,
    currentAudio: null,
    isGenerating: false,

    // Response streaming
    currentResponse: '',
    currentResponseDiv: null,

    // Live Assistant Mode
    isLiveMode: false,
    liveAudioContext: null,
    liveAudioWorklet: null,
    liveAudioStream: null,
    recentTranscripts: [],

    // Audio visualization
    audioContext: null,
    analyser: null,
    animationFrameId: null,
    audioBars: [],

    // WebSocket reconnection
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
    baseReconnectDelay: 1000,
    reconnectTimeout: null,
    connectionState: 'disconnected',

    // Chat
    currentChatId: null,

    // Metrics
    firstTokenTime: null,
    messageStartTime: null,
    tokenCount: 0,

    // Initialization flag to suppress redundant notifications on load
    isInitializing: true
};

// Getters and Setters for convenience (optional, but helps with debugging)
export function setSocket(s) { state.socket = s; }
export function getSocket() { return state.socket; }
