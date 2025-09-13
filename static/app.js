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

// WebSocket reconnection settings
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
const baseReconnectDelay = 1000; // Start with 1 second
let reconnectTimeout = null;

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
    // Clear any existing reconnect timeout
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    socket = io({
        reconnection: true,
        reconnectionAttempts: maxReconnectAttempts,
        reconnectionDelay: baseReconnectDelay,
        reconnectionDelayMax: 30000,
        timeout: 20000
    });
    
    socket.on('connect', () => {
        reconnectAttempts = 0; // Reset counter on successful connection
        updateStatus('Connected', 'ready');
        console.log('Connected to server');
    });
    
    socket.on('disconnect', (reason) => {
        updateStatus('Disconnected', 'error');
        stopRecording();
        console.log('Disconnected:', reason);
        
        // Handle reconnection with exponential backoff
        if (reason === 'io server disconnect') {
            // Server disconnected us, try to reconnect
            attemptReconnection();
        }
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error.message);
        attemptReconnection();
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
        hideModelLoadingSpinner(); // Hide loading spinner on error
        hideWhisperLoadingSpinner();
        showError(data.message);
    });
    
    socket.on('conversation_cleared', () => {
        clearChatDisplay();
    });
    
    socket.on('model_changed', (data) => {
        currentModel = data.model;  // Update current model
        hideModelLoadingSpinner();  // Hide loading spinner when model changes
        updateStatus(`Model changed to ${data.model}`, 'ready');
        loadModels();
    });
    
    socket.on('tts_changed', (data) => {
        updateStatus('Voice settings updated', 'ready');
    });
    
    socket.on('whisper_model_changed', (data) => {
        hideWhisperLoadingSpinner();
        updateStatus(`Whisper model changed to ${data.model}`, 'ready');
    });
    
    // Loading progress removed - using simple inline spinners instead
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Main UI elements - using new simplified UI IDs
    const voiceBtn = document.getElementById('voiceBtn');
    const textInput = document.getElementById('textInput');
    const sendBtn = document.getElementById('sendBtn');
    const clearBtn = document.getElementById('clearBtn');
    const menuBtn = document.getElementById('menuBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const closeMenu = document.getElementById('closeMenu');
    const closeSettings = document.getElementById('closeSettings');
    const overlay = document.getElementById('overlay');
    
    // Voice recording button - click to start, click to stop
    if (voiceBtn) {
        voiceBtn.addEventListener('click', () => {
            if (isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        });
    }
    
    // Text input events
    if (textInput) {
        textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendTextMessage();
            }
        });
    }
    
    // Send button
    if (sendBtn) {
        sendBtn.addEventListener('click', sendTextMessage);
    }
    
    // Clear button
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            socket.emit('clear_conversation');
        });
    }
    
    // Menu button
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            const sideMenu = document.getElementById('sideMenu');
            sideMenu.classList.add('open');
            overlay.classList.add('active');
        });
    }
    
    // Settings button
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            const settingsPanel = document.getElementById('settingsPanel');
            settingsPanel.classList.add('open');
            overlay.classList.add('active');
        });
    }
    
    // Close menu
    if (closeMenu) {
        closeMenu.addEventListener('click', () => {
            const sideMenu = document.getElementById('sideMenu');
            sideMenu.classList.remove('open');
            overlay.classList.remove('active');
        });
    }
    
    // Close settings
    if (closeSettings) {
        closeSettings.addEventListener('click', () => {
            const settingsPanel = document.getElementById('settingsPanel');
            settingsPanel.classList.remove('open');
            overlay.classList.remove('active');
        });
    }
    
    // Overlay click to close panels
    if (overlay) {
        overlay.addEventListener('click', () => {
            const sideMenu = document.getElementById('sideMenu');
            const settingsPanel = document.getElementById('settingsPanel');
            sideMenu.classList.remove('open');
            settingsPanel.classList.remove('open');
            overlay.classList.remove('active');
        });
    }
    
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
            // Show loading spinner when switching models
            showModelLoadingSpinner();
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
                showWhisperLoadingSpinner();
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
        
        // Update UI for new simplified interface
        const voiceBtn = document.getElementById('voiceBtn');
        const recordingIndicator = voiceBtn?.querySelector('.recording-indicator');
        const micIcon = voiceBtn?.querySelector('.mic-icon');
        
        if (voiceBtn) {
            voiceBtn.classList.add('recording');
        }
        if (recordingIndicator) {
            recordingIndicator.style.display = 'flex';
        }
        if (micIcon) {
            micIcon.style.display = 'none';
        }
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
    
    // Update UI for new simplified interface
    const voiceBtn = document.getElementById('voiceBtn');
    const recordingIndicator = voiceBtn?.querySelector('.recording-indicator');
    const micIcon = voiceBtn?.querySelector('.mic-icon');
    
    if (voiceBtn) {
        voiceBtn.classList.remove('recording');
    }
    if (recordingIndicator) {
        recordingIndicator.style.display = 'none';
    }
    if (micIcon) {
        micIcon.style.display = 'block';
    }
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
    // Hide welcome screen and show messages
    const welcome = document.getElementById('welcome');
    const messages = document.getElementById('messages');
    
    if (welcome) {
        welcome.style.display = 'none';
    }
    
    if (messages) {
        messages.classList.add('active');
    }
    
    // Create message element for new UI
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    // Add avatar
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    avatarDiv.textContent = role === 'user' ? '👤' : '🤖';
    
    // Add content wrapper
    const contentWrapper = document.createElement('div');
    
    // Add message content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = text;
    
    // Add timestamp
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'message-time';
    const now = new Date();
    timestampDiv.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Assemble message structure
    contentWrapper.appendChild(contentDiv);
    contentWrapper.appendChild(timestampDiv);
    
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(contentWrapper);
    
    // Append to messages container
    if (messages) {
        messages.appendChild(messageDiv);
        // Scroll to bottom
        const chatContainer = document.getElementById('chatContainer');
        if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
    }
    
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
    // Update both status text and model indicator in new UI
    const statusText = document.getElementById('statusText');
    const modelIndicator = document.getElementById('modelIndicator');
    
    if (statusText) {
        statusText.textContent = message;
        statusText.className = `status-text status-${type}`;
    }
    
    // Update model indicator if it's a model-related status
    if (type === 'ready' && currentModel && modelIndicator) {
        modelIndicator.textContent = currentModel;
    }
}

/**
 * Attempt to reconnect with exponential backoff
 */
function attemptReconnection() {
    if (reconnectAttempts >= maxReconnectAttempts) {
        updateStatus('Connection failed. Please refresh the page.', 'error');
        return;
    }
    
    reconnectAttempts++;
    const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts - 1), 30000);
    
    updateStatus(`Reconnecting... (Attempt ${reconnectAttempts}/${maxReconnectAttempts})`, 'warning');
    
    reconnectTimeout = setTimeout(() => {
        socket.connect();
    }, delay);
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
    // Clear messages and show welcome state again
    const messages = document.getElementById('messages');
    const welcome = document.getElementById('welcome');
    
    if (messages) {
        messages.innerHTML = '';
        messages.classList.remove('active');
    }
    
    if (welcome) {
        welcome.style.display = 'flex';
    }
    
    // Re-setup model quick select
    setupModelQuickSelect();
    
    // Update status
    updateStatus('Ready', 'ready');
    
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
        
        // Setup model quick select after loading config
        setupModelQuickSelect();
        
        // Update container state
        updateChatContainerState();
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

/**
 * Show model loading spinner
 */
let modelSpinnerTimeout = null;
function showModelLoadingSpinner() {
    const spinner = document.getElementById('modelLoadingSpinner');
    const modelSelect = document.getElementById('modelSelect');
    if (spinner) {
        spinner.style.display = 'inline-block';
        // Clear any existing timeout
        if (modelSpinnerTimeout) {
            clearTimeout(modelSpinnerTimeout);
            modelSpinnerTimeout = null;
        }
    }
    if (modelSelect) {
        modelSelect.disabled = true;
        modelSelect.parentElement.classList.add('loading');
    }
}

/**
 * Hide model loading spinner
 */
function hideModelLoadingSpinner() {
    // Ensure spinner shows for at least 500ms for visibility
    const minDisplayTime = 500;
    
    if (modelSpinnerTimeout) {
        // Spinner is already scheduled to hide
        return;
    }
    
    modelSpinnerTimeout = setTimeout(() => {
        const spinner = document.getElementById('modelLoadingSpinner');
        const modelSelect = document.getElementById('modelSelect');
        if (spinner) {
            spinner.style.display = 'none';
        }
        if (modelSelect) {
            modelSelect.disabled = false;
            modelSelect.parentElement.classList.remove('loading');
        }
        modelSpinnerTimeout = null;
    }, minDisplayTime);
}

/**
 * Show Whisper loading spinner
 */
function showWhisperLoadingSpinner() {
    const spinner = document.getElementById('whisperLoadingSpinner');
    const whisperSelect = document.getElementById('whisperSelect');
    if (spinner) {
        spinner.style.display = 'inline-block';
    }
    if (whisperSelect) {
        whisperSelect.disabled = true;
        whisperSelect.parentElement.classList.add('loading');
    }
}

/**
 * Hide Whisper loading spinner
 */
function hideWhisperLoadingSpinner() {
    const spinner = document.getElementById('whisperLoadingSpinner');
    const whisperSelect = document.getElementById('whisperSelect');
    if (spinner) {
        spinner.style.display = 'none';
    }
    if (whisperSelect) {
        whisperSelect.disabled = false;
        whisperSelect.parentElement.classList.remove('loading');
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

/**
 * Setup model quick select cards
 */
function setupModelQuickSelect() {
    try {
        // Use the new .model-btn class from simplified UI
        const modelButtons = document.querySelectorAll('.model-btn');
        
        modelButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                try {
                    const model = btn.dataset.model;
                    if (!model) {
                        console.error('No model specified for button');
                        showError('Unable to select model. Please try again.');
                        return;
                    }
                    
                    // Check if socket is connected
                    if (!socket || !socket.connected) {
                        showError('Not connected to server. Please wait...');
                        attemptReconnection();
                        return;
                    }
                    
                    // Update status to show loading
                    updateStatus(`Loading ${model}...`, 'loading');
                    
                    // Change the model with timeout
                    const modelChangeTimeout = setTimeout(() => {
                        updateStatus('Model change timed out. Please try again.', 'error');
                    }, 30000);
                    
                    // Listen for successful model change
                    socket.once('model_changed', () => {
                        clearTimeout(modelChangeTimeout);
                        hideModelLoadingSpinner();
                    });
                    
                    socket.once('error', () => {
                        clearTimeout(modelChangeTimeout);
                        hideModelLoadingSpinner();
                    });
                    
                    // Change the model
                    socket.emit('change_model', { model: model });
                    currentModel = model;
                    localStorage.setItem('selectedModel', model);
                    
                    // Update the model selector dropdown
                    const modelSelect = document.getElementById('modelSelect');
                    if (modelSelect) {
                        modelSelect.value = model;
                    }
                } catch (error) {
                    console.error('Error in model card click:', error);
                    hideModelLoadingSpinner();
                    showError('Failed to change model. Please try again.');
                }
                
                // Hide the quick select UI
                updateChatContainerState();
            });
        });
    } catch (error) {
        console.error('Error setting up model quick select:', error);
    }
}

/**
 * Update chat container state (show/hide model selection)
 */
function updateChatContainerState() {
    const chatContainer = document.getElementById('chatContainer');
    const messages = chatContainer.querySelectorAll('.message');
    
    if (messages.length > 0) {
        chatContainer.classList.add('has-messages');
    } else {
        chatContainer.classList.remove('has-messages');
    }
}