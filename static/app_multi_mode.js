/**
 * AssistedVoice Multi-Mode Interface
 * Supports: Continuous, Smart Pause, and Push-to-Talk modes
 */

// Global variables
let socket = null;
let mediaRecorder = null;
let audioStream = null;
let audioContext = null;
let analyser = null;

// Mode management
let currentMode = 'ptt'; // 'continuous', 'smart', 'ptt'
let isActive = false;
let isRecording = false;

// Streaming state
let audioBuffer = [];
let silenceTimer = null;
let lastSpeechTime = Date.now();
let currentTranscription = '';
let currentResponse = '';

// Settings
const settings = {
    continuous: {
        bufferSize: 5000, // ms
        transcribeInterval: 1000, // ms - match backend processing
        responseSpeed: 5,
        chunkSize: 250 // ms
    },
    smart: {
        pauseDuration: 1500, // ms
        minSpeechLength: 500, // ms
        chunkSize: 500 // ms
    },
    ptt: {
        // No special settings needed
    }
};

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    initializeWebSocket();
    setupEventListeners();
    initializeAudioContext();
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
        stopCurrentMode();
    });
    
    socket.on('connected', (data) => {
        console.log(data.status);
        fetchConfig();
    });
    
    socket.on('status', (data) => {
        updateStatus(data.message, data.type);
    });
    
    // Transcription events
    socket.on('partial_transcription', (data) => {
        if (currentMode !== 'ptt') {
            updatePartialTranscription(data.text);
        }
    });
    
    socket.on('transcription', (data) => {
        addMessage('user', data.text);
        currentTranscription = '';
        updatePartialTranscription('');
    });
    
    // Response events
    socket.on('response_chunk', (data) => {
        appendToCurrentResponse(data.text);
    });
    
    socket.on('response_complete', (data) => {
        completeResponse(data.text);
        
        // In continuous mode, keep listening
        if (currentMode === 'continuous' && isActive) {
            setTimeout(() => {
                updateStatus('Listening...', 'listening');
            }, 500);
        }
    });
    
    // Voice activity events (for smart mode)
    socket.on('vad_speech_start', () => {
        if (currentMode === 'smart') {
            document.getElementById('vadIndicator').classList.add('active');
            clearTimeout(silenceTimer);
        }
    });
    
    socket.on('vad_speech_end', () => {
        if (currentMode === 'smart') {
            document.getElementById('vadIndicator').classList.remove('active');
            // Start silence timer
            silenceTimer = setTimeout(() => {
                if (currentTranscription) {
                    socket.emit('process_smart_pause');
                }
            }, settings.smart.pauseDuration);
        }
    });
    
    socket.on('error', (data) => {
        showError(data.message);
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
    // Mode selector buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const newMode = btn.dataset.mode;
            switchMode(newMode);
        });
    });
    
    // Main action button
    const conversationBtn = document.getElementById('conversationBtn');
    conversationBtn.addEventListener('click', handleMainButtonClick);
    
    // Text input
    const textInput = document.getElementById('textInput');
    const sendButton = document.getElementById('sendButton');
    
    textInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendTextMessage();
        }
    });
    
    sendButton.addEventListener('click', sendTextMessage);
    
    // Clear button
    document.getElementById('clearButton').addEventListener('click', () => {
        socket.emit('clear_conversation');
        clearChatDisplay();
    });
    
    // Settings panel
    document.getElementById('settingsToggle').addEventListener('click', () => {
        const content = document.getElementById('settingsContent');
        content.style.display = content.style.display === 'none' ? 'block' : 'none';
    });
    
    // Settings controls
    document.getElementById('responseSpeed').addEventListener('input', (e) => {
        settings.continuous.responseSpeed = parseInt(e.target.value);
        document.getElementById('responseSpeedValue').textContent = e.target.value;
    });
    
    document.getElementById('pauseDuration').addEventListener('input', (e) => {
        settings.smart.pauseDuration = parseInt(e.target.value);
        document.getElementById('pauseDurationValue').textContent = (e.target.value / 1000).toFixed(1) + 's';
    });
    
    document.getElementById('showTranscription').addEventListener('change', (e) => {
        document.getElementById('transcriptionDisplay').style.display = 
            e.target.checked ? 'block' : 'none';
    });
}

/**
 * Switch conversation mode
 */
function switchMode(newMode) {
    // Stop current mode if active
    if (isActive) {
        stopCurrentMode();
    }
    
    // Update UI
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === newMode);
    });
    
    // Update current mode
    currentMode = newMode;
    document.getElementById('currentMode').textContent = 
        newMode === 'continuous' ? 'Continuous' :
        newMode === 'smart' ? 'Smart Pause' : 'Push to Talk';
    
    // Update button text based on mode
    const btnText = document.querySelector('.button-text');
    if (newMode === 'continuous') {
        btnText.textContent = 'Start Streaming';
    } else if (newMode === 'smart') {
        btnText.textContent = 'Start Conversation';
    } else {
        btnText.textContent = 'Click to Talk';
    }
    
    // Show/hide relevant UI elements
    updateUIForMode(newMode);
    
    console.log(`Switched to ${newMode} mode`);
}

/**
 * Handle main button click based on current mode
 */
function handleMainButtonClick() {
    if (currentMode === 'ptt') {
        // Push-to-talk: toggle recording
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    } else if (currentMode === 'continuous' || currentMode === 'smart') {
        // Continuous/Smart: toggle conversation
        if (isActive) {
            stopCurrentMode();
        } else {
            startCurrentMode();
        }
    }
}

/**
 * Start the current mode
 */
async function startCurrentMode() {
    if (currentMode === 'continuous') {
        await startContinuousMode();
    } else if (currentMode === 'smart') {
        await startSmartMode();
    } else if (currentMode === 'ptt') {
        startRecording();
    }
}

/**
 * Stop the current mode
 */
function stopCurrentMode() {
    if (currentMode === 'continuous' || currentMode === 'smart') {
        stopStreamingMode();
    } else if (currentMode === 'ptt' && isRecording) {
        stopRecording();
    }
}

/**
 * Start continuous streaming mode
 */
async function startContinuousMode() {
    try {
        // Get microphone permission
        audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // Connect to audio context
        const source = audioContext.createMediaStreamSource(audioStream);
        source.connect(analyser);
        
        // Create MediaRecorder
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
            ? 'audio/webm;codecs=opus' 
            : 'audio/webm';
            
        mediaRecorder = new MediaRecorder(audioStream, {
            mimeType: mimeType,
            audioBitsPerSecond: 32000
        });
        
        // Send chunks immediately for continuous processing
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && isActive) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    socket.emit('audio_stream_continuous', {
                        audio: reader.result,
                        timestamp: Date.now(),
                        settings: settings.continuous
                    });
                };
                reader.readAsDataURL(event.data);
            }
        };
        
        // Start recording with larger chunks for better WebM containers
        mediaRecorder.start(250); // 250ms chunks for better audio quality
        isActive = true;
        
        // Notify server
        socket.emit('start_continuous_mode', { settings: settings.continuous });
        
        // Update UI
        updateUIForActiveStreaming();
        updateStatus('Streaming... Speak naturally', 'listening');
        
        // Start visualization
        visualizeAudioLevel();
        
    } catch (err) {
        console.error('Error starting continuous mode:', err);
        showError('Failed to start continuous mode: ' + err.message);
    }
}

/**
 * Start smart pause mode
 */
async function startSmartMode() {
    try {
        // Get microphone permission
        audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        // Connect to audio context
        const source = audioContext.createMediaStreamSource(audioStream);
        source.connect(analyser);
        
        // Create MediaRecorder
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
            ? 'audio/webm;codecs=opus' 
            : 'audio/webm';
            
        mediaRecorder = new MediaRecorder(audioStream, {
            mimeType: mimeType,
            audioBitsPerSecond: 32000
        });
        
        // Buffer chunks for smart pause detection
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0 && isActive) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    socket.emit('audio_stream_smart', {
                        audio: reader.result,
                        timestamp: Date.now(),
                        settings: settings.smart
                    });
                };
                reader.readAsDataURL(event.data);
            }
        };
        
        // Start recording with larger chunks for reliable detection
        mediaRecorder.start(500); // 500ms chunks for better pause detection
        isActive = true;
        
        // Notify server
        socket.emit('start_smart_mode', { settings: settings.smart });
        
        // Update UI
        updateUIForActiveStreaming();
        updateStatus('Listening for speech...', 'listening');
        
        // Start visualization
        visualizeAudioLevel();
        
    } catch (err) {
        console.error('Error starting smart mode:', err);
        showError('Failed to start smart mode: ' + err.message);
    }
}

/**
 * Stop streaming modes (continuous/smart)
 */
function stopStreamingMode() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    
    isActive = false;
    clearTimeout(silenceTimer);
    
    // Notify server
    if (currentMode === 'continuous') {
        socket.emit('stop_continuous_mode');
    } else if (currentMode === 'smart') {
        socket.emit('stop_smart_mode');
    }
    
    // Update UI
    updateUIForInactiveMode();
    updateStatus('Stopped', 'ready');
}

/**
 * Start recording (PTT mode)
 */
async function startRecording() {
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
        
        audioBuffer = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioBuffer.push(event.data);
            }
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioBuffer, { type: 'audio/webm' });
            await sendAudioToServer(audioBlob);
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        isRecording = true;
        
        // Update UI
        document.getElementById('conversationBtn').classList.add('active');
        document.querySelector('.button-text').textContent = 'Click to Stop';
        document.getElementById('recordingIndicator').style.display = 'flex';
        updateStatus('Recording...', 'recording');
        
    } catch (err) {
        console.error('Error starting recording:', err);
        showError('Failed to start recording');
    }
}

/**
 * Stop recording (PTT mode)
 */
function stopRecording() {
    if (!isRecording) return;
    
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        isRecording = false;
        
        // Update UI
        document.getElementById('conversationBtn').classList.remove('active');
        document.querySelector('.button-text').textContent = 'Click to Talk';
        document.getElementById('recordingIndicator').style.display = 'none';
        updateStatus('Processing...', 'processing');
    }
}

/**
 * Send audio to server (PTT mode)
 */
async function sendAudioToServer(audioBlob) {
    const reader = new FileReader();
    reader.onloadend = () => {
        socket.emit('process_audio', { audio: reader.result });
    };
    reader.readAsDataURL(audioBlob);
}

/**
 * Visualize audio input level
 */
function visualizeAudioLevel() {
    if (!isActive || !analyser) return;
    
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
 * Update UI for different modes
 */
function updateUIForMode(mode) {
    const streamingIndicator = document.getElementById('streamingIndicator');
    const transcriptionDisplay = document.getElementById('transcriptionDisplay');
    
    if (mode === 'continuous' || mode === 'smart') {
        // Show streaming-specific UI
        if (document.getElementById('showTranscription').checked) {
            transcriptionDisplay.style.display = 'block';
        }
    } else {
        // Hide streaming UI for PTT mode
        streamingIndicator.style.display = 'none';
        transcriptionDisplay.style.display = 'none';
    }
    
    // Show relevant settings
    document.querySelectorAll('.setting-group[data-mode]').forEach(group => {
        group.style.display = group.dataset.mode === mode ? 'block' : 'none';
    });
}

/**
 * Update UI for active streaming
 */
function updateUIForActiveStreaming() {
    const btn = document.getElementById('conversationBtn');
    btn.classList.add(currentMode === 'continuous' ? 'continuous-active' : 'active');
    document.querySelector('.button-text').textContent = 'Stop';
    document.getElementById('streamingIndicator').style.display = 'flex';
}

/**
 * Update UI for inactive mode
 */
function updateUIForInactiveMode() {
    const btn = document.getElementById('conversationBtn');
    btn.classList.remove('active', 'continuous-active');
    document.querySelector('.button-text').textContent = 
        currentMode === 'continuous' ? 'Start Streaming' :
        currentMode === 'smart' ? 'Start Conversation' : 'Click to Talk';
    document.getElementById('streamingIndicator').style.display = 'none';
    document.getElementById('vadIndicator').classList.remove('active');
    document.getElementById('partialTranscription').textContent = '';
}

/**
 * Update partial transcription display
 */
function updatePartialTranscription(text) {
    const partialDiv = document.getElementById('partialTranscription');
    if (partialDiv) {
        partialDiv.textContent = text;
        currentTranscription = text;
    }
}

/**
 * Send text message
 */
function sendTextMessage() {
    const textInput = document.getElementById('textInput');
    const text = textInput.value.trim();
    
    if (!text) return;
    
    addMessage('user', text);
    textInput.value = '';
    
    socket.emit('process_text', { text: text });
}

/**
 * Add message to chat display
 */
function addMessage(role, text) {
    const chatContainer = document.getElementById('chatContainer');
    
    // Remove welcome message
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

let currentResponseDiv = null;

/**
 * Append to streaming response
 */
function appendToCurrentResponse(text) {
    if (!currentResponseDiv) {
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
            <p>Choose a mode and start talking.</p>
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

/**
 * Load saved settings
 */
function loadSettings() {
    // Load from localStorage if available
    const saved = localStorage.getItem('assistedVoiceSettings');
    if (saved) {
        Object.assign(settings, JSON.parse(saved));
        
        // Update UI
        document.getElementById('responseSpeed').value = settings.continuous.responseSpeed;
        document.getElementById('responseSpeedValue').textContent = settings.continuous.responseSpeed;
        document.getElementById('pauseDuration').value = settings.smart.pauseDuration;
        document.getElementById('pauseDurationValue').textContent = (settings.smart.pauseDuration / 1000).toFixed(1) + 's';
    }
}

/**
 * Save settings
 */
function saveSettings() {
    localStorage.setItem('assistedVoiceSettings', JSON.stringify(settings));
}