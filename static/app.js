/**
 * AssistedVoice Simple Push-to-Talk Interface
 */

// Global variables
let socket = null;
let mediaRecorder = null;
let audioStream = null;
let audioChunks = [];
let isRecording = false;
let ttsEnabled = true; // Default to enabled
let currentTTSEngine = 'edge-tts'; // Track current TTS engine
let currentModel = null; // Track current model for responses

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
        if (data.model) currentModel = data.model;
        
        // Track first token time
        if (!firstTokenTime && messageStartTime) {
            firstTokenTime = Date.now();
        }
        
        // Count tokens (approximate by words)
        tokenCount += data.text.split(/\s+/).filter(w => w.length > 0).length;
        
        appendToCurrentResponse(data.text);
    });
    
    socket.on('response_complete', (data) => {
        if (data.model) currentModel = data.model;
        completeResponse(data.text);
        // Save conversation after response is complete
        setTimeout(saveConversation, 100);
    });
    
    socket.on('tts_complete', () => {
        updateStatus('Ready', 'ready');
    });
    
    socket.on('error', (data) => {
        hideLoadingOverlay(); // Hide loading on any error
        showError(data.message);
    });
    
    socket.on('conversation_cleared', () => {
        clearChatDisplay();
    });
    
    socket.on('model_changed', (data) => {
        currentModel = data.model;  // Update current model
        updateStatus(`Model changed to ${data.model}`, 'ready');
        loadModels();
    });
    
    socket.on('tts_changed', (data) => {
        updateStatus('Voice settings updated', 'ready');
    });
    
    socket.on('whisper_model_changed', (data) => {
        hideLoadingOverlay();
        updateStatus(`Whisper model changed to ${data.model}`, 'ready');
    });
    
    socket.on('loading_progress', (data) => {
        updateLoadingProgress(data.message, data.progress);
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
    
    // TTS engine selector
    const ttsEngineSelect = document.getElementById('ttsEngineSelect');
    ttsEngineSelect.addEventListener('change', (e) => {
        const engine = e.target.value;
        currentTTSEngine = engine;
        localStorage.setItem('ttsEngine', engine);
        
        // Update voice selector visibility and options
        updateVoiceSelector(engine);
        
        // Update ttsEnabled based on engine
        ttsEnabled = (engine !== 'none');
        
        // Notify server of engine change
        if (engine !== 'none') {
            const voiceSelect = document.getElementById('voiceSelect');
            const voice = voiceSelect.value;
            if (voice) {
                socket.emit('change_tts', { engine: engine, voice: voice });
            }
        }
        
        updateStatus(engine === 'none' ? 'Text-only mode' : `Voice: ${engine}`, 'ready');
    });
    
    // Model selector
    const modelSelect = document.getElementById('modelSelect');
    modelSelect.addEventListener('change', (e) => {
        const model = e.target.value;
        if (model) {
            // Show loading overlay when switching models
            showLoadingOverlay(model, `Loading ${model} model...`);
            socket.emit('change_model', { model: model });
            currentModel = model;
            localStorage.setItem('selectedModel', model);
        }
    });
    
    // Whisper model selector
    const whisperSelect = document.getElementById('whisperSelect');
    if (whisperSelect) {
        whisperSelect.addEventListener('change', (e) => {
            const model = e.target.value;
            if (model) {
                showLoadingOverlay(model, `Switching to ${model} model for speech recognition`);
                socket.emit('change_whisper_model', { model: model });
                localStorage.setItem('selectedWhisperModel', model);
            }
        });
        
        // Load saved Whisper model preference
        const savedWhisperModel = localStorage.getItem('selectedWhisperModel');
        if (savedWhisperModel) {
            whisperSelect.value = savedWhisperModel;
        }
    }
    
    // Voice selector
    const voiceSelect = document.getElementById('voiceSelect');
    voiceSelect.addEventListener('change', (e) => {
        const voice = e.target.value;
        if (voice && currentTTSEngine !== 'none') {
            socket.emit('change_tts', { engine: currentTTSEngine, voice: voice });
            localStorage.setItem(`selectedVoice_${currentTTSEngine}`, voice);
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
                // Start performance tracking
                messageStartTime = Date.now();
                firstTokenTime = null;
                tokenCount = 0;
                
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
    
    // Start performance tracking
    messageStartTime = Date.now();
    firstTokenTime = null;
    tokenCount = 0;
    
    // Add message to chat
    addMessage('user', text);
    
    // Clear input
    textInput.value = '';
    
    // Show typing indicator immediately
    showTypingIndicator();
    
    // Update status subtly
    updateStatus('Thinking...', 'processing');
    
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
    
    // Add speaker button for assistant messages
    if (role === 'assistant') {
        const speakerButton = document.createElement('button');
        speakerButton.className = 'speaker-button';
        speakerButton.innerHTML = '🔊';
        speakerButton.title = 'Speak this message';
        speakerButton.addEventListener('click', (e) => {
            e.preventDefault();
            speakText(text);
        });
        labelDiv.appendChild(speakerButton);
    }
    
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
    
    // Save conversation after adding message
    setTimeout(saveConversation, 100);
}

let currentResponse = '';
let currentResponseDiv = null;

// Performance metrics tracking
let messageStartTime = null;
let firstTokenTime = null;
let tokenCount = 0;

/**
 * Show typing indicator with animated dots
 */
function showTypingIndicator() {
    const chatContainer = document.getElementById('chatContainer');
    
    // Remove any existing typing indicator
    const existing = document.querySelector('.typing-indicator');
    if (existing) existing.remove();
    
    // Remove welcome message if it exists
    const welcomeMsg = chatContainer.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.style.display = 'none';
    }
    
    // Create typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant-message typing-indicator';
    typingDiv.innerHTML = `
        <div class="message-label">Assistant • ${currentModel || 'llama3.2:3b'}</div>
        <div class="message-content">
            <span class="typing-dots">
                <span></span>
                <span></span>
                <span></span>
            </span>
        </div>
    `;
    
    chatContainer.appendChild(typingDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/**
 * Start or append to streaming response
 */
function appendToCurrentResponse(text) {
    if (!currentResponseDiv) {
        // Remove typing indicator if it exists
        const typingIndicator = document.querySelector('.typing-indicator');
        if (typingIndicator) typingIndicator.remove();
        
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
        labelDiv.textContent = currentModel ? `Assistant • ${currentModel}` : 'Assistant';
        
        // Add speaker button for assistant messages
        const speakerButton = document.createElement('button');
        speakerButton.className = 'speaker-button';
        speakerButton.innerHTML = '🔊';
        speakerButton.title = 'Speak this message';
        speakerButton.style.display = 'none'; // Hide until response is complete
        labelDiv.appendChild(speakerButton);
        
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
        
        // Show and activate speaker button
        const labelDiv = currentResponseDiv.parentElement.querySelector('.message-label');
        const speakerButton = labelDiv.querySelector('.speaker-button');
        if (speakerButton) {
            speakerButton.style.display = 'inline-block';
            speakerButton.addEventListener('click', (e) => {
                e.preventDefault();
                speakText(fullText);
            });
        }
        
        // Calculate and display metrics
        if (messageStartTime) {
            const totalTime = Date.now() - messageStartTime;
            const firstTokenDelay = firstTokenTime ? firstTokenTime - messageStartTime : 0;
            const tokensPerSecond = tokenCount > 0 && totalTime > 0 ? 
                (tokenCount / (totalTime / 1000)).toFixed(1) : 0;
            
            // Update timestamp with metrics
            const timestampDiv = currentResponseDiv.parentElement.querySelector('.message-timestamp');
            if (timestampDiv) {
                const timeStr = new Date().toLocaleTimeString();
                const totalSec = (totalTime / 1000).toFixed(2);
                const firstSec = (firstTokenDelay / 1000).toFixed(2);
                timestampDiv.innerHTML = `
                    <span class="timestamp-time">${timeStr}</span>
                    <span class="metrics-separator">•</span>
                    <span class="metric-item" title="Total response time">${totalSec}s total</span>
                    <span class="metrics-separator">•</span>
                    <span class="metric-item" title="Time to first token">${firstSec}s first</span>
                    <span class="metrics-separator">•</span>
                    <span class="metric-item" title="Tokens per second">${tokensPerSecond} tokens/s</span>
                `;
            }
        }
    }
    
    currentResponse = '';
    currentResponseDiv = null;
    messageStartTime = null;
    firstTokenTime = null;
    tokenCount = 0;
}

/**
 * Speak text using server-side TTS (reuse existing TTS pathway)
 */
function speakText(text) {
    if (!text || text.trim() === '') {
        return;
    }
    
    // Check socket connection
    if (!socket || !socket.connected) {
        console.error('WebSocket not connected');
        return;
    }
    
    // Send to server for TTS processing using the same pathway as responses
    socket.emit('replay_text', { 
        text: text.trim(),
        enable_tts: true 
    });
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
    // Clear saved conversation
    localStorage.removeItem('assistedVoiceConversation');
}

/**
 * Save conversation to localStorage
 */
function saveConversation() {
    const messages = [];
    const messageElements = document.querySelectorAll('.message');
    
    messageElements.forEach(elem => {
        const label = elem.querySelector('.message-label')?.textContent;
        const content = elem.querySelector('.message-content')?.textContent;
        if (label && content) {
            messages.push({
                role: label === 'You' ? 'user' : 'assistant',
                content: content
            });
        }
    });
    
    if (messages.length > 0) {
        localStorage.setItem('assistedVoiceConversation', JSON.stringify({
            version: 1,
            timestamp: Date.now(),
            messages: messages
        }));
    }
}

/**
 * Load conversation from localStorage
 */
function loadConversation() {
    try {
        const saved = localStorage.getItem('assistedVoiceConversation');
        if (!saved) return;
        
        const data = JSON.parse(saved);
        if (data.version !== 1) return; // Skip if version mismatch
        
        const chatContainer = document.getElementById('chatContainer');
        
        // Remove welcome message if it exists
        const welcomeMsg = chatContainer.querySelector('.welcome-message');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }
        
        // Restore messages
        data.messages.forEach(msg => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${msg.role}-message`;
            
            const labelDiv = document.createElement('div');
            labelDiv.className = 'message-label';
            labelDiv.textContent = msg.role === 'user' ? 'You' : 'Assistant';
            
            // Add speaker button for assistant messages
            if (msg.role === 'assistant') {
                const speakerButton = document.createElement('button');
                speakerButton.className = 'speaker-button';
                speakerButton.innerHTML = '🔊';
                speakerButton.title = 'Speak this message';
                speakerButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    speakText(msg.content);
                });
                labelDiv.appendChild(speakerButton);
            }
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = msg.content;
            
            const timestampDiv = document.createElement('div');
            timestampDiv.className = 'message-timestamp';
            timestampDiv.textContent = 'Restored';
            
            messageDiv.appendChild(labelDiv);
            messageDiv.appendChild(contentDiv);
            messageDiv.appendChild(timestampDiv);
            
            chatContainer.appendChild(messageDiv);
        });
        
        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
        
    } catch (err) {
        console.error('Failed to load conversation:', err);
    }
}

/**
 * Fetch and display configuration
 */
async function fetchConfig() {
    try {
        const response = await fetch('/config');
        const config = await response.json();
        
        // Load available models
        loadModels();
        // Voice loading is now handled by loadSettings()
        
        // Load saved conversation
        loadConversation();
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
                currentModel = model;  // Set current model
            }
            modelSelect.appendChild(option);
        });
    } catch (err) {
        console.error('Failed to load models:', err);
    }
}

/**
 * Update voice selector based on TTS engine
 */
function updateVoiceSelector(engine) {
    const voiceSelector = document.getElementById('voiceSelector');
    const voiceSelect = document.getElementById('voiceSelect');
    
    if (engine === 'none') {
        // Hide voice selector for text-only mode
        voiceSelector.style.display = 'none';
    } else {
        // Show voice selector
        voiceSelector.style.display = 'flex';
        
        // Clear current options
        voiceSelect.innerHTML = '';
        
        if (engine === 'edge-tts') {
            // Neural voices
            const neuralVoices = [
                { value: 'en-US-JennyNeural', label: 'Jenny (Female)' },
                { value: 'en-US-GuyNeural', label: 'Guy (Male)' },
                { value: 'en-US-AriaNeural', label: 'Aria (Female)' },
                { value: 'en-GB-SoniaNeural', label: 'Sonia (British)' },
                { value: 'en-GB-RyanNeural', label: 'Ryan (British)' }
            ];
            
            neuralVoices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.value;
                option.textContent = voice.label;
                voiceSelect.appendChild(option);
            });
            
            // Restore saved selection
            const savedVoice = localStorage.getItem('selectedVoice_edge-tts');
            if (savedVoice) {
                voiceSelect.value = savedVoice;
            }
        } else if (engine === 'macos') {
            // Classic macOS voices
            const macVoices = [
                { value: 'Samantha', label: 'Samantha' },
                { value: 'Alex', label: 'Alex' },
                { value: 'Victoria', label: 'Victoria' },
                { value: 'Fred', label: 'Fred' },
                { value: 'Karen', label: 'Karen' }
            ];
            
            macVoices.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.value;
                option.textContent = voice.label;
                voiceSelect.appendChild(option);
            });
            
            // Restore saved selection
            const savedVoice = localStorage.getItem('selectedVoice_macos');
            if (savedVoice) {
                voiceSelect.value = savedVoice;
            }
        }
    }
}

/**
 * Load voice options (deprecated, kept for compatibility)
 */
function loadSimpleVoices() {
    // This function is now handled by updateVoiceSelector
    const savedEngine = localStorage.getItem('ttsEngine') || 'edge-tts';
    updateVoiceSelector(savedEngine);
}

/**
 * Loading overlay functions
 */
const modelLoadingTimes = {
    'tiny': 2,
    'base': 3,
    'small': 5,
    'medium': 10,
    'large': 15,
    'turbo': 5
};

function showLoadingOverlay(modelName, message) {
    const overlay = document.getElementById('loadingOverlay');
    const title = document.getElementById('loadingTitle');
    const messageEl = document.getElementById('loadingMessage');
    const timeEl = document.getElementById('loadingTime');
    const progressFill = document.getElementById('progressFill');
    
    const estimatedTime = modelLoadingTimes[modelName] || 5;
    
    title.textContent = `Loading ${modelName} model...`;
    messageEl.textContent = message || 'Please wait while the model loads';
    timeEl.textContent = `Estimated time: ~${estimatedTime} seconds`;
    
    // Reset progress
    progressFill.style.width = '0%';
    
    overlay.classList.add('show');
    
    // Simulate progress (since we don't have real progress from the backend yet)
    let progress = 0;
    const interval = setInterval(() => {
        progress += (100 / (estimatedTime * 10)); // Update every 100ms
        if (progress > 90) progress = 90; // Don't go to 100% until we get confirmation
        progressFill.style.width = `${progress}%`;
        
        if (progress >= 90) {
            clearInterval(interval);
        }
    }, 100);
    
    // Store interval ID for cleanup
    overlay.progressInterval = interval;
    
    // Disable controls during loading
    disableControls(true);
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    const progressFill = document.getElementById('progressFill');
    
    // Complete the progress bar
    progressFill.style.width = '100%';
    
    // Clear any running progress interval
    if (overlay.progressInterval) {
        clearInterval(overlay.progressInterval);
        overlay.progressInterval = null;
    }
    
    // Hide after a brief delay to show completion
    setTimeout(() => {
        overlay.classList.remove('show');
        // Re-enable controls
        disableControls(false);
    }, 500);
}

function updateLoadingProgress(message, progress) {
    const messageEl = document.getElementById('loadingMessage');
    const progressFill = document.getElementById('progressFill');
    const overlay = document.getElementById('loadingOverlay');
    
    if (messageEl && overlay.classList.contains('show')) {
        messageEl.textContent = message;
        if (progressFill && progress !== undefined) {
            // Clear any existing interval since we're getting real progress
            if (overlay.progressInterval) {
                clearInterval(overlay.progressInterval);
                overlay.progressInterval = null;
            }
            progressFill.style.width = `${progress}%`;
        }
    }
}

function disableControls(disabled) {
    const whisperSelect = document.getElementById('whisperSelect');
    const modelSelect = document.getElementById('modelSelect');
    const recordBtn = document.getElementById('recordBtn');
    const textInput = document.getElementById('textInput');
    const sendButton = document.getElementById('sendButton');
    
    if (whisperSelect) whisperSelect.disabled = disabled;
    if (modelSelect) modelSelect.disabled = disabled;
    if (recordBtn) recordBtn.disabled = disabled;
    if (textInput) textInput.disabled = disabled;
    if (sendButton) sendButton.disabled = disabled;
}


/**
 * Load saved settings
 */
function loadSettings() {
    // Load TTS engine preference
    const savedEngine = localStorage.getItem('ttsEngine');
    if (savedEngine) {
        currentTTSEngine = savedEngine;
        document.getElementById('ttsEngineSelect').value = savedEngine;
        ttsEnabled = (savedEngine !== 'none');
    } else {
        currentTTSEngine = 'edge-tts';
        ttsEnabled = true;
        localStorage.setItem('ttsEngine', 'edge-tts');
    }
    
    // Update voice selector based on engine
    updateVoiceSelector(currentTTSEngine);
}