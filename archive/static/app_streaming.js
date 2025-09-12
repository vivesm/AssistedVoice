/**
 * AssistedVoice Web Interface - Continuous Streaming Version
 */

// Global variables
let socket = null;
let mediaRecorder = null;
let audioStream = null;
let isConversationActive = false;
let currentState = 'idle'; // idle, listening, processing, speaking
let silenceTimer = null;
let audioContext = null;
let analyser = null;

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    initializeWebSocket();
    setupEventListeners();
    initializeAudioContext();
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
        stopConversation();
    });
    
    socket.on('connected', (data) => {
        console.log(data.status);
        fetchConfig();
    });
    
    socket.on('status', (data) => {
        updateStatus(data.message, data.type);
    });
    
    socket.on('partial_transcription', (data) => {
        updatePartialTranscription(data.text);
    });
    
    socket.on('final_transcription', (data) => {
        finalizeTranscription(data.text);
    });
    
    socket.on('response_chunk', (data) => {
        appendToCurrentResponse(data.text);
    });
    
    socket.on('response_complete', (data) => {
        completeResponse(data.text);
        // Continue listening if conversation is active
        if (isConversationActive) {
            setTimeout(() => {
                currentState = 'listening';
                updateStatus('Listening...', 'listening');
            }, 500);
        }
    });
    
    socket.on('vad_speech_start', () => {
        updateStatus('Speech detected...', 'recording');
        document.getElementById('vadIndicator').classList.add('active');
    });
    
    socket.on('vad_speech_end', () => {
        updateStatus('Processing...', 'processing');
        document.getElementById('vadIndicator').classList.remove('active');
    });
    
    socket.on('error', (data) => {
        showError(data.message);
    });
    
    socket.on('conversation_cleared', () => {
        clearChatDisplay();
    });
}

/**
 * Initialize audio context for visualization
 */
function initializeAudioContext() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    const conversationBtn = document.getElementById('conversationBtn');
    const textInput = document.getElementById('textInput');
    const sendButton = document.getElementById('sendButton');
    const clearButton = document.getElementById('clearButton');
    
    // Conversation button - toggle conversation mode
    conversationBtn.addEventListener('click', () => {
        if (isConversationActive) {
            stopConversation();
        } else {
            startConversation();
        }
    });
    
    // Text input events
    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !isConversationActive) {
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
 * Start continuous conversation mode
 */
async function startConversation() {
    try {
        // Get microphone permission and start streaming
        audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // Connect to audio context for visualization
        const source = audioContext.createMediaStreamSource(audioStream);
        source.connect(analyser);
        
        // Create MediaRecorder for streaming
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
            ? 'audio/webm;codecs=opus' 
            : 'audio/webm';
            
        mediaRecorder = new MediaRecorder(audioStream, {
            mimeType: mimeType,
            audioBitsPerSecond: 32000
        });
        
        // Send audio chunks as they become available
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && isConversationActive) {
                // Convert blob to base64 and send
                const reader = new FileReader();
                reader.onloadend = () => {
                    socket.emit('audio_stream_chunk', {
                        audio: reader.result,
                        timestamp: Date.now()
                    });
                };
                reader.readAsDataURL(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            console.log('MediaRecorder stopped');
        };
        
        // Start recording with 250ms chunks
        mediaRecorder.start(250);
        isConversationActive = true;
        currentState = 'listening';
        
        // Notify server that streaming has started
        socket.emit('start_conversation_stream');
        
        // Update UI
        document.getElementById('conversationBtn').classList.add('active');
        document.getElementById('conversationBtn').querySelector('.button-text').textContent = 'Stop Conversation';
        document.getElementById('streamingIndicator').style.display = 'flex';
        updateStatus('Listening... Speak naturally', 'listening');
        
        // Start audio level visualization
        visualizeAudioLevel();
        
    } catch (err) {
        console.error('Error starting conversation:', err);
        showError('Failed to start conversation: ' + err.message);
    }
}

/**
 * Stop conversation mode
 */
function stopConversation() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    
    isConversationActive = false;
    currentState = 'idle';
    
    // Notify server
    socket.emit('stop_conversation_stream');
    
    // Update UI
    document.getElementById('conversationBtn').classList.remove('active');
    document.getElementById('conversationBtn').querySelector('.button-text').textContent = 'Start Conversation';
    document.getElementById('streamingIndicator').style.display = 'none';
    document.getElementById('vadIndicator').classList.remove('active');
    document.getElementById('partialTranscription').textContent = '';
    updateStatus('Conversation ended', 'ready');
}

/**
 * Visualize audio input level
 */
function visualizeAudioLevel() {
    if (!isConversationActive) return;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate average volume
    const average = dataArray.reduce((a, b) => a + b) / bufferLength;
    const normalized = Math.min(100, (average / 128) * 100);
    
    // Update visual indicator
    const levelBar = document.getElementById('audioLevel');
    if (levelBar) {
        levelBar.style.width = normalized + '%';
        levelBar.style.backgroundColor = normalized > 30 ? '#4a90e2' : '#ccc';
    }
    
    // Continue visualization
    requestAnimationFrame(visualizeAudioLevel);
}

/**
 * Update partial transcription display
 */
function updatePartialTranscription(text) {
    const partialDiv = document.getElementById('partialTranscription');
    if (partialDiv) {
        partialDiv.textContent = text;
        partialDiv.style.display = text ? 'block' : 'none';
    }
}

/**
 * Finalize transcription and add to chat
 */
function finalizeTranscription(text) {
    if (text) {
        addMessage('user', text);
        document.getElementById('partialTranscription').textContent = '';
    }
}

/**
 * Send text message (when not in conversation mode)
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

let currentResponse = '';
let currentResponseDiv = null;

/**
 * Start or append to streaming response
 */
function appendToCurrentResponse(text) {
    if (!currentResponseDiv) {
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
    const streamingDiv = document.getElementById('streaming-response');
    if (streamingDiv) {
        streamingDiv.classList.remove('streaming');
        streamingDiv.id = '';
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
            <p>Click "Start Conversation" to begin speaking, or type your message below.</p>
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