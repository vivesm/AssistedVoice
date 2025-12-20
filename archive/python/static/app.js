/**
 * AssistedVoice Web Interface - Client JavaScript
 */

// Global variables
let socket = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let currentResponse = '';

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    initializeWebSocket();
    setupEventListeners();
    requestMicrophonePermission();
});

/**
 * Initialize WebSocket connection
 */
function initializeWebSocket() {
    socket = io();
    
    socket.on('connect', () => {
        updateStatus('Connected', 'ready');
        console.log('Connected to server');
    });
    
    socket.on('disconnect', () => {
        updateStatus('Disconnected', 'error');
    });
    
    socket.on('connected', (data) => {
        console.log(data.status);
        fetchConfig();
    });
    
    socket.on('status', (data) => {
        updateStatus(data.message, data.type);
    });
    
    socket.on('transcription', (data) => {
        addMessage('user', data.text);
    });
    
    socket.on('response_chunk', (data) => {
        appendToCurrentResponse(data.text);
    });
    
    socket.on('response_complete', (data) => {
        completeResponse(data.text);
    });
    
    socket.on('error', (data) => {
        showError(data.message);
    });
    
    socket.on('conversation_cleared', () => {
        clearChatDisplay();
    });
    
    socket.on('tts_complete', () => {
        updateStatus('Ready', 'ready');
    });
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    const pttButton = document.getElementById('pttButton');
    const textInput = document.getElementById('textInput');
    const sendButton = document.getElementById('sendButton');
    const clearButton = document.getElementById('clearButton');
    
    // Click to start/stop recording (toggle mode)
    pttButton.addEventListener('click', (e) => {
        e.preventDefault();
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });
    
    // Optional: Keep hold-to-talk as alternative (uncomment if wanted)
    // pttButton.addEventListener('mousedown', startRecording);
    // pttButton.addEventListener('mouseup', stopRecording);
    // pttButton.addEventListener('mouseleave', stopRecording);
    
    // Text input events
    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendTextMessage();
        }
    });
    
    sendButton.addEventListener('click', sendTextMessage);
    
    // Clear button
    clearButton.addEventListener('click', () => {
        socket.emit('clear_conversation');
    });
}

/**
 * Request microphone permission
 */
async function requestMicrophonePermission() {
    try {
        // Check if we're in a secure context (HTTPS or localhost)
        if (!window.isSecureContext) {
            showError('Microphone requires HTTPS. Use localhost or enable HTTPS.');
            console.error('Not in secure context. Microphone API requires HTTPS or localhost.');
            return;
        }
        
        // Check if getUserMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showError('Your browser does not support audio recording');
            console.error('getUserMedia not supported');
            return;
        }
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        console.log('Microphone permission granted');
        updateStatus('Microphone ready', 'ready');
    } catch (err) {
        console.error('Microphone permission denied:', err);
        if (err.name === 'NotAllowedError') {
            showError('Microphone blocked. Click the lock icon in address bar to allow.');
        } else if (err.name === 'NotFoundError') {
            showError('No microphone found. Please connect a microphone.');
        } else {
            showError('Microphone access error: ' + err.message);
        }
    }
}

/**
 * Start recording audio
 */
async function startRecording() {
    if (isRecording) return;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true
            }
        });
        
        mediaRecorder = new MediaRecorder(stream, {
            mimeType: 'audio/webm'
        });
        
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            await sendAudioToServer(audioBlob);
            
            // Stop all tracks
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        isRecording = true;
        
        // Update UI
        document.getElementById('pttButton').classList.add('recording');
        document.querySelector('.button-text').textContent = 'Click to Stop';
        document.getElementById('recordingIndicator').style.display = 'flex';
        updateStatus('Recording... Click button to stop', 'recording');
        
    } catch (err) {
        console.error('Error starting recording:', err);
        showError('Failed to start recording');
    }
}

/**
 * Stop recording audio
 */
function stopRecording() {
    if (!isRecording) return;
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        isRecording = false;
        
        // Update UI
        document.getElementById('pttButton').classList.remove('recording');
        document.querySelector('.button-text').textContent = 'Click to Talk';
        document.getElementById('recordingIndicator').style.display = 'none';
        updateStatus('Processing...', 'processing');
    }
}

/**
 * Send audio to server
 */
async function sendAudioToServer(audioBlob) {
    // Convert to base64
    const reader = new FileReader();
    reader.onloadend = () => {
        const base64Audio = reader.result;
        socket.emit('process_audio', { audio: base64Audio });
    };
    reader.readAsDataURL(audioBlob);
}

/**
 * Send text message
 */
function sendTextMessage() {
    const textInput = document.getElementById('textInput');
    const text = textInput.value.trim();
    
    if (!text) return;
    
    // Add message to chat
    addMessage('user', text);
    
    // Clear input
    textInput.value = '';
    
    // Send to server
    socket.emit('process_text', { text: text });
}

/**
 * Add message to chat display
 */
function addMessage(role, text) {
    const chatContainer = document.getElementById('chatContainer');
    
    // Remove welcome message if it exists
    const welcomeMsg = chatContainer.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}-message`;
    
    const labelDiv = document.createElement('div');
    labelDiv.className = 'message-label';
    labelDiv.textContent = role === 'user' ? 'You' : 'Assistant';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = text;
    
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'message-timestamp';
    timestampDiv.textContent = new Date().toLocaleTimeString();
    
    messageDiv.appendChild(labelDiv);
    messageDiv.appendChild(contentDiv);
    messageDiv.appendChild(timestampDiv);
    
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Start a new assistant response
 */
function appendToCurrentResponse(text) {
    if (!currentResponse) {
        // Create new message div for streaming
        const chatContainer = document.getElementById('chatContainer');
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant-message streaming';
        messageDiv.id = 'streaming-response';
        
        const labelDiv = document.createElement('div');
        labelDiv.className = 'message-label';
        labelDiv.textContent = 'Assistant';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.id = 'streaming-content';
        
        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = new Date().toLocaleTimeString();
        
        messageDiv.appendChild(labelDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);
        
        chatContainer.appendChild(messageDiv);
    }
    
    currentResponse += text;
    const contentDiv = document.getElementById('streaming-content');
    if (contentDiv) {
        contentDiv.textContent = currentResponse;
        
        // Scroll to bottom
        const chatContainer = document.getElementById('chatContainer');
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

/**
 * Complete the streaming response
 */
function completeResponse(fullText) {
    const streamingDiv = document.getElementById('streaming-response');
    if (streamingDiv) {
        streamingDiv.classList.remove('streaming');
        streamingDiv.id = '';
    }
    
    const contentDiv = document.getElementById('streaming-content');
    if (contentDiv) {
        contentDiv.id = '';
    }
    
    currentResponse = '';
}

/**
 * Update status display
 */
function updateStatus(message, type) {
    const statusElement = document.getElementById('status');
    statusElement.textContent = message;
    statusElement.className = `status status-${type}`;
}

/**
 * Show error message
 */
function showError(message) {
    updateStatus(message, 'error');
    
    // Also add to chat
    const chatContainer = document.getElementById('chatContainer');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message error-message';
    errorDiv.textContent = `Error: ${message}`;
    chatContainer.appendChild(errorDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Clear chat display
 */
function clearChatDisplay() {
    const chatContainer = document.getElementById('chatContainer');
    chatContainer.innerHTML = `
        <div class="welcome-message">
            <p>Conversation cleared!</p>
            <p>Hold the microphone button to speak, or type your message below.</p>
        </div>
    `;
}

/**
 * Fetch and display configuration
 */
async function fetchConfig() {
    try {
        const response = await fetch('/config');
        const config = await response.json();
        
        const modelInfo = document.getElementById('model-info');
        modelInfo.textContent = `Model: ${config.model} | Whisper: ${config.whisper_model}`;
    } catch (err) {
        console.error('Failed to fetch config:', err);
    }
}