/**
 * AssistedVoice Simple Push-to-Talk Interface
 */

// Global variables
let socket = null;
let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let isRecording = false;
let ttsEnabled = false; // Default to text-only mode

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    initializeWebSocket();
    setupEventListeners();
    loadSettings();
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
        stopRecording();
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
    
    socket.on('tts_complete', () => {
        updateStatus('Ready', 'ready');
    });
    
    socket.on('error', (data) => {
        showError(data.message);
    });
    
    socket.on('conversation_cleared', () => {
        clearChatDisplay();
    });
    
    socket.on('model_changed', (data) => {
        updateStatus(`Model changed to ${data.model}`, 'ready');
        loadModels();
    });
    
    socket.on('tts_changed', (data) => {
        updateStatus('Voice settings updated', 'ready');
    });
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    const recordBtn = document.getElementById('recordBtn');
    const textInput = document.getElementById('textInput');
    const sendButton = document.getElementById('sendButton');
    const clearButton = document.getElementById('clearButton');
    
    // Push-to-talk button - click to start, click to stop
    recordBtn.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });
    
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
    
    // TTS toggle
    const ttsToggle = document.getElementById('ttsToggle');
    ttsToggle.addEventListener('change', (e) => {
        ttsEnabled = e.target.checked;
        localStorage.setItem('ttsEnabled', ttsEnabled);
        updateStatus(ttsEnabled ? 'Voice enabled' : 'Text-only mode', 'ready');
    });
    
    // Model selector
    const modelSelect = document.getElementById('modelSelect');
    modelSelect.addEventListener('change', (e) => {
        const model = e.target.value;
        if (model) {
            socket.emit('change_model', { model: model });
            localStorage.setItem('selectedModel', model);
        }
    });
    
    // Voice selector
    const voiceSelect = document.getElementById('voiceSelect');
    voiceSelect.addEventListener('change', (e) => {
        const voice = e.target.value;
        if (voice) {
            socket.emit('change_tts', { engine: 'edge-tts', voice: voice });
            localStorage.setItem('selectedVoice', voice);
        }
    });
}

/**
 * Start recording audio
 */
async function startRecording() {
    try {
        // Reset chunks
        audioChunks = [];
        
        // Get microphone permission
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Create MediaRecorder
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
            ? 'audio/webm;codecs=opus' 
            : 'audio/webm';
            
        mediaRecorder = new MediaRecorder(audioStream, { mimeType: mimeType });
        
        // Collect audio data
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        // Handle recording stop
        mediaRecorder.onstop = () => {
            // Create blob from chunks
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            
            // Convert to base64 and send
            const reader = new FileReader();
            reader.onloadend = () => {
                socket.emit('process_audio', {
                    audio: reader.result,
                    enable_tts: ttsEnabled
                });
            };
            reader.readAsDataURL(audioBlob);
            
            // Clean up
            audioChunks = [];
        };
        
        // Start recording
        mediaRecorder.start();
        isRecording = true;
        
        // Update UI
        document.getElementById('recordBtn').classList.add('active');
        document.getElementById('recordingIndicator').style.display = 'flex';
        updateStatus('Recording... Click again to stop', 'recording');
        
    } catch (err) {
        console.error('Error starting recording:', err);
        showError('Failed to start recording: ' + err.message);
    }
}

/**
 * Stop recording audio
 */
function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    
    isRecording = false;
    
    // Update UI
    document.getElementById('recordBtn').classList.remove('active');
    document.getElementById('recordingIndicator').style.display = 'none';
    updateStatus('Processing...', 'processing');
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
    socket.emit('process_text', { 
        text: text,
        enable_tts: ttsEnabled 
    });
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

let currentResponse = '';
let currentResponseDiv = null;

/**
 * Start or append to streaming response
 */
function appendToCurrentResponse(text) {
    if (!currentResponseDiv) {
        // Create new message div for streaming
        const chatContainer = document.getElementById('chatContainer');
        
        // Remove welcome message if it exists
        const welcomeMsg = chatContainer.querySelector('.welcome-message');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant-message streaming';
        
        const labelDiv = document.createElement('div');
        labelDiv.className = 'message-label';
        labelDiv.textContent = 'Assistant';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = new Date().toLocaleTimeString();
        
        messageDiv.appendChild(labelDiv);
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);
        
        chatContainer.appendChild(messageDiv);
        currentResponseDiv = contentDiv;
    }
    
    currentResponse += text;
    currentResponseDiv.textContent = currentResponse;
    
    // Scroll to bottom
    const chatContainer = document.getElementById('chatContainer');
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Complete the streaming response
 */
function completeResponse(fullText) {
    if (currentResponseDiv) {
        currentResponseDiv.parentElement.classList.remove('streaming');
    }
    
    currentResponse = '';
    currentResponseDiv = null;
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
            <p>Click the microphone to start recording, or type your message below.</p>
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
        
        // Load available models
        loadModels();
        loadSimpleVoices();
    } catch (err) {
        console.error('Failed to fetch config:', err);
    }
}

/**
 * Load available models
 */
async function loadModels() {
    try {
        const response = await fetch('/api/models');
        const data = await response.json();
        
        const modelSelect = document.getElementById('modelSelect');
        const savedModel = localStorage.getItem('selectedModel');
        
        modelSelect.innerHTML = '';
        data.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            if (model === data.current || model === savedModel) {
                option.selected = true;
            }
            modelSelect.appendChild(option);
        });
    } catch (err) {
        console.error('Failed to load models:', err);
    }
}

/**
 * Load simple voice options
 */
function loadSimpleVoices() {
    const voiceSelect = document.getElementById('voiceSelect');
    const savedVoice = localStorage.getItem('selectedVoice');
    
    if (savedVoice) {
        voiceSelect.value = savedVoice;
    }
}


/**
 * Load saved settings
 */
function loadSettings() {
    // Load TTS preference from localStorage
    const savedTTS = localStorage.getItem('ttsEnabled');
    if (savedTTS !== null) {
        ttsEnabled = savedTTS === 'true';
    } else {
        ttsEnabled = true; // Default to enabled
        localStorage.setItem('ttsEnabled', 'true');
    }
    
    // Update UI
    document.getElementById('ttsToggle').checked = ttsEnabled;
}