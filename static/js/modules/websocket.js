/**
 * WebSocket handling module for AssistedVoice
 */
import { state } from './state.js';
import { logConnectionState, logResponse, showToast } from './utils.js';
import { playAudioData, stopAudio } from './audio.js';

// Helper to safely call UI updates
function updateStatus(message, type) {
    if (state.ui && state.ui.updateStatus) {
        state.ui.updateStatus(message, type);
    }
}

function appendToCurrentResponse(text) {
    if (state.ui && state.ui.appendToCurrentResponse) {
        state.ui.appendToCurrentResponse(text);
    }
}

function completeResponse(fullText) {
    if (state.ui && state.ui.completeResponse) {
        state.ui.completeResponse(fullText);
    }
}

function showTypingIndicator() {
    if (state.ui && state.ui.showTypingIndicator) {
        state.ui.showTypingIndicator();
    }
}

function showStopGenerationButton() {
    if (state.ui && state.ui.showStopGenerationButton) {
        state.ui.showStopGenerationButton();
    }
}

function hideStopGenerationButton() {
    if (state.ui && state.ui.hideStopGenerationButton) {
        state.ui.hideStopGenerationButton();
    }
}

function showError(message) {
    if (state.ui && state.ui.showError) {
        state.ui.showError(message);
    }
}

function updateVADStatus(status) {
    if (state.ui && state.ui.updateVADStatus) {
        state.ui.updateVADStatus(status);
    }
}

function syncAISettingsToBackend() {
    if (state.ui && state.ui.syncAISettingsToBackend) {
        state.ui.syncAISettingsToBackend();
    }
}

/**
 * Initialize WebSocket connection
 */
export function initializeWebSocket() {
    if (state.socket) {
        state.socket.disconnect();
    }

    // Initialize Socket.IO
    state.socket = io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: state.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000
    });

    setupSocketListeners();
}

/**
 * Setup WebSocket event listeners
 */
function setupSocketListeners() {
    const socket = state.socket;

    // Connection events
    socket.on('connect', () => {
        logConnectionState('Connected');
        updateStatus('Ready', 'ready');
        state.reconnectAttempts = 0;

        // Sync settings on reconnect
        syncAISettingsToBackend();
    });

    socket.on('disconnect', (reason) => {
        logConnectionState('Disconnected', reason);
        updateStatus('Disconnected', 'error');

        if (reason === 'io server disconnect') {
            // Server initiated disconnect, need to manually reconnect
            socket.connect();
        }
    });

    socket.on('connect_error', (error) => {
        logConnectionState('Connection Error', error);
        updateStatus('Connection error', 'error');
    });

    // Text processing events
    socket.on('response_start', (data) => {
        state.isGenerating = true;
        state.currentResponse = '';
        showTypingIndicator();
        showStopGenerationButton();

        // Performance metrics
        state.messageStartTime = Date.now();
        state.firstTokenTime = null;
        state.tokenCount = 0;
        console.log('Started generation timing:', state.messageStartTime);
    });

    socket.on('response_chunk', (data) => {
        // Record first token time
        if (!state.firstTokenTime) {
            state.firstTokenTime = Date.now();
        }
        state.tokenCount++;

        state.currentResponse += data.text;
        appendToCurrentResponse(data.text);
    });

    socket.on('response_complete', (data) => {
        state.isGenerating = false;
        hideStopGenerationButton();
        completeResponse(data.text);
        logResponse(data.text);
    });

    // Audio processing events
    socket.on('audio_chunk', (data) => {
        if (state.ttsEnabled) {
            if (!state.isPlayingAudio) {
                playAudioData(data.audio);
            } else {
                state.audioQueue.push(data.audio);
            }
        }
    });

    socket.on('audio_data', (data) => {
        console.log('Received audio_data event:', {
            hasAudio: !!data.audio,
            size: data.audio ? data.audio.length : 0,
            audioPreview: data.audio?.substring(0, 50),
            ttsEnabled: state.ttsEnabled
        });

        // Always play audio when received, regardless of global TTS state
        // This allows replay buttons to work even when TTS is muted
        if (data.audio) {
            console.log('Playing audio data...');
            playAudioData(data.audio);
        } else {
            console.warn('No audio data in audio_data event');
        }
    });

    socket.on('audio_end', () => {
        // Handle end of audio stream if needed
    });

    // Status and error events
    socket.on('status_update', (data) => {
        updateStatus(data.message, data.type);
    });

    socket.on('error', (data) => {
        state.isGenerating = false;
        hideStopGenerationButton();
        showError(data.message);

        // Also show toast for better visibility
        showToast(data.message, 'error');
    });

    // VAD events
    socket.on('vad_listening', () => {
        updateVADStatus('listening');
    });

    socket.on('vad_speech_detected', () => {
        updateVADStatus('speech');
    });

    socket.on('vad_silence_detected', () => {
        updateVADStatus('silence');
    });

    // Model events
    socket.on('model_changed', (data) => {
        console.log('Model changed event received:', data);

        // Update state
        state.currentModel = data.model;

        // Update status
        updateStatus('Ready', 'ready');
        showToast(`Model switched to ${data.model}`, 'success');

        // Update dropdown if exists
        const modelSelect = document.getElementById('modelSelect');
        if (modelSelect) {
            modelSelect.value = data.model;
        }

        // Update model indicator
        const modelIndicator = document.getElementById('modelIndicator');
        if (modelIndicator) {
            modelIndicator.textContent = data.model;
        }

        // Update active class in welcome grid if visible
        const modelGrid = document.querySelector('.model-grid');
        if (modelGrid) {
            const btns = modelGrid.querySelectorAll('.model-btn');
            btns.forEach(btn => btn.classList.remove('active'));
            const activeBtn = modelGrid.querySelector(`[data-model="${data.model}"]`);
            if (activeBtn) activeBtn.classList.add('active');
        }
    });
}

/**
 * Emit an event to the server
 */
export function emit(event, data) {
    if (state.socket && state.socket.connected) {
        state.socket.emit(event, data);
    } else {
        showToast('Not connected to server', 'error');
    }
}
