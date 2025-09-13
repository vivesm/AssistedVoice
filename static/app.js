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
    // Check for saved conversation before showing welcome
    const welcome = document.getElementById('welcome');
    const messages = document.getElementById('messages');
    
    const savedConversation = localStorage.getItem('assistedVoiceConversation');
    let hasMessages = false;
    
    if (savedConversation) {
        try {
            const data = JSON.parse(savedConversation);
            hasMessages = data.messages && data.messages.length > 0;
        } catch (e) {
            console.error('Error checking saved conversation:', e);
        }
    }
    
    // Show appropriate view immediately
    if (hasMessages) {
        // Hide welcome, show messages container
        if (welcome) welcome.style.display = 'none';
        if (messages) messages.classList.add('active');
    } else {
        // Ensure welcome is visible if no messages
        if (welcome) welcome.style.display = 'flex';
    }
    
    initializeWebSocket();
    setupEventListeners();
    loadSettings();
    loadConversation(); // This will populate the messages if they exist
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
        // Loading spinners removed - not in simplified UI
        showError(data.message);
    });
    
    socket.on('conversation_cleared', () => {
        clearChatDisplay();
    });
    
    socket.on('model_changed', (data) => {
        console.log('Model changed event received:', data.model);
        currentModel = data.model;  // Update current model
        // Loading spinner removed - not in simplified UI
        updateStatus(`Model changed to ${data.model}`, 'ready');
        
        // Directly update model indicator to ensure it's visible
        const modelIndicator = document.getElementById('modelIndicator');
        if (modelIndicator) {
            modelIndicator.textContent = data.model;
            console.log('Model indicator updated via socket to:', data.model);
        } else {
            console.error('Model indicator element not found!');
        }
        
        loadModels();
    });
    
    socket.on('tts_changed', (data) => {
        updateStatus('Voice settings updated', 'ready');
    });
    
    socket.on('whisper_model_changed', (data) => {
        // Loading spinner removed
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
                // Check if send on enter is enabled
                const sendOnEnter = localStorage.getItem('sendOnEnter') !== 'false';
                if (sendOnEnter) {
                    sendTextMessage();
                }
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
    
    // Settings Panel Event Listeners
    setupSettingsListeners();
    
    // TTS engine selector (if it exists - not in simplified UI)
    // TTS engine selector removed - not in simplified UI
    
    // Model selector
    const modelSelect = document.getElementById('modelSelect');
    if (modelSelect) {
        modelSelect.addEventListener('change', (e) => {
            const model = e.target.value;
            if (model) {
                // Show loading spinner when switching models
                // Loading spinner removed - not in simplified UI
                socket.emit('change_model', { model: model });
                currentModel = model;
                localStorage.setItem('selectedModel', model);
                
                // Immediately update model indicator
                const modelIndicator = document.getElementById('modelIndicator');
                if (modelIndicator) {
                    modelIndicator.textContent = model;
                    console.log('Model indicator updated to:', model);
                }
            }
        });
    }
    
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
 * Setup settings panel event listeners
 */
function setupSettingsListeners() {
    // Theme buttons
    const themeButtons = document.querySelectorAll('.theme-btn');
    themeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active from all buttons
            themeButtons.forEach(b => b.classList.remove('active'));
            // Add active to clicked button
            btn.classList.add('active');
            
            // Apply theme
            const theme = btn.dataset.theme;
            applyTheme(theme);
            localStorage.setItem('theme', theme);
        });
    });
    
    // Font size slider
    const fontSlider = document.getElementById('fontSlider');
    if (fontSlider) {
        fontSlider.addEventListener('input', (e) => {
            const size = e.target.value;
            document.documentElement.style.fontSize = `${size}px`;
            localStorage.setItem('fontSize', size);
        });
    }
    
    // Send on Enter checkbox
    const sendOnEnter = document.getElementById('sendOnEnter');
    if (sendOnEnter) {
        sendOnEnter.addEventListener('change', (e) => {
            localStorage.setItem('sendOnEnter', e.target.checked);
        });
    }
    
    // Sound effects checkbox
    const soundEffects = document.getElementById('soundEffects');
    if (soundEffects) {
        soundEffects.addEventListener('change', (e) => {
            localStorage.setItem('soundEffects', e.target.checked);
        });
    }
}

/**
 * Apply theme to the app
 */
function applyTheme(theme) {
    const body = document.body;
    
    if (theme === 'light') {
        body.classList.add('light-theme');
    } else if (theme === 'dark') {
        body.classList.remove('light-theme');
    } else if (theme === 'auto') {
        // Check system preference
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (prefersDark) {
            body.classList.remove('light-theme');
        } else {
            body.classList.add('light-theme');
        }
    }
}

/**
 * Load and apply saved settings
 */
function loadSavedSettings() {
    // Load theme
    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);
    
    // Update theme button state
    const themeButtons = document.querySelectorAll('.theme-btn');
    themeButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.theme === savedTheme) {
            btn.classList.add('active');
        }
    });
    
    // Load font size
    const savedFontSize = localStorage.getItem('fontSize') || '16';
    document.documentElement.style.fontSize = `${savedFontSize}px`;
    const fontSlider = document.getElementById('fontSlider');
    if (fontSlider) {
        fontSlider.value = savedFontSize;
    }
    
    // Load send on enter
    const savedSendOnEnter = localStorage.getItem('sendOnEnter') !== 'false';
    const sendOnEnterCheckbox = document.getElementById('sendOnEnter');
    if (sendOnEnterCheckbox) {
        sendOnEnterCheckbox.checked = savedSendOnEnter;
    }
    
    // Load sound effects
    const savedSoundEffects = localStorage.getItem('soundEffects') === 'true';
    const soundEffectsCheckbox = document.getElementById('soundEffects');
    if (soundEffectsCheckbox) {
        soundEffectsCheckbox.checked = savedSoundEffects;
    }
}

/**
 * Play a sound effect if enabled
 */
function playSound(type) {
    const soundEnabled = localStorage.getItem('soundEffects') === 'true';
    if (!soundEnabled) return;
    
    // Create audio element
    const audio = new Audio();
    
    // Use different sounds for different events
    switch(type) {
        case 'send':
            // Use a simple beep for send (data URI for a short beep sound)
            audio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBBxypOXyvmMfBjiS2Oy9diMFl2z2wliWPTJW9XvuNxMEA';
            break;
        case 'receive':
            // Use a different beep for receive
            audio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBCZypOXyvmMfBjiS2Oy9diMGlmz2wVmVPzNX9HvtOBQFBg';
            audio.volume = 0.3;
            break;
    }
    
    // Play the sound
    audio.play().catch(e => console.log('Could not play sound:', e));
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
            document.body.classList.add('recording'); // Add visual feedback to body
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
        document.body.classList.remove('recording'); // Remove visual feedback from body
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
        
        // Play sound effect if enabled
        const soundEnabled = localStorage.getItem('soundEffects') === 'true';
        if (soundEnabled) {
            playSound(role === 'user' ? 'send' : 'receive');
        }
        
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
        // Hide welcome screen and show messages
        const welcome = document.getElementById('welcome');
        const messages = document.getElementById('messages');
        
        if (welcome) {
            welcome.style.display = 'none';
        }
        
        if (messages) {
            messages.classList.add('active');
        }
        
        // Create new message element for simplified UI
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';
        
        // Add avatar
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';
        avatarDiv.textContent = '🤖';
        
        // Add content wrapper
        const contentWrapper = document.createElement('div');
        
        // Add message content
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        // Add timestamp (will be updated when complete)
        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-time';
        timestampDiv.innerHTML = `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${currentModel || 'Assistant'}`;
        
        // Assemble message structure
        contentWrapper.appendChild(contentDiv);
        contentWrapper.appendChild(timestampDiv);
        
        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(contentWrapper);
        
        // Append to messages container
        if (messages) {
            messages.appendChild(messageDiv);
        }
        
        currentResponseDiv = contentDiv;
    }
    
    currentResponse += text;
    currentResponseDiv.textContent = currentResponse;
    
    // Scroll to bottom
    const chatContainer = document.getElementById('chatContainer');
    if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

/**
 * Complete the streaming response
 */
function completeResponse(fullText) {
    if (currentResponseDiv) {
        // Play sound effect if enabled
        const soundEnabled = localStorage.getItem('soundEffects') === 'true';
        if (soundEnabled) {
            playSound('receive');
        }
        
        // Update timestamp with metrics
        const timestampDiv = currentResponseDiv.parentElement?.querySelector('.message-time');
        if (timestampDiv && messageStartTime) {
            const now = new Date();
            const totalTime = Date.now() - messageStartTime;
            const firstTokenDelay = firstTokenTime ? firstTokenTime - messageStartTime : 0;
            const tokensPerSecond = tokenCount > 0 && totalTime > 0 ? 
                (tokenCount / (totalTime / 1000)).toFixed(1) : 0;
            
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const totalSec = (totalTime / 1000).toFixed(1);
            const firstSec = (firstTokenDelay / 1000).toFixed(2);
            
            timestampDiv.innerHTML = `
                ${timeStr} • ${currentModel || 'llama3.2:3b'}<br>
                <span style="font-size: 11px; opacity: 0.7;">${totalSec}s total • ${firstSec}s first • ${tokensPerSecond} tokens/s</span>
            `;
        } else if (timestampDiv) {
            const now = new Date();
            timestampDiv.innerHTML = `
                ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${currentModel || 'llama3.2:3b'}
            `;
        }
    }
    
    currentResponse = '';
    currentResponseDiv = null;
    messageStartTime = null;
    firstTokenTime = null;
    tokenCount = 0;
}

// speakText function removed - not used in simplified UI

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
    const messageElements = document.querySelectorAll('#messages .message');
    
    messageElements.forEach(elem => {
        const isUser = elem.classList.contains('user');
        const content = elem.querySelector('.message-content')?.textContent;
        const metadata = elem.querySelector('.message-time')?.innerHTML; // Get full HTML including metrics
        
        if (content) {
            messages.push({
                role: isUser ? 'user' : 'assistant',
                content: content,
                metadata: metadata || null // Store metadata if available
            });
        }
    });
    
    if (messages.length > 0) {
        localStorage.setItem('assistedVoiceConversation', JSON.stringify({
            version: 3, // Increment version for new format
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
        if (data.version !== 3 && data.version !== 2 && data.version !== 1) return; // Accept all versions
        
        // Hide welcome and show messages
        const welcome = document.getElementById('welcome');
        const messages = document.getElementById('messages');
        
        if (!messages) return;
        
        if (welcome) {
            welcome.style.display = 'none';
        }
        
        messages.classList.add('active');
        
        // Restore messages
        data.messages.forEach(msg => {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${msg.role === 'user' ? 'user' : 'assistant'}`;
            
            // Add avatar
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'message-avatar';
            avatarDiv.textContent = msg.role === 'user' ? '👤' : '🤖';
            
            // Add content wrapper
            const contentWrapper = document.createElement('div');
            
            // Add message content
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = msg.content;
            
            // Add timestamp/metadata
            const timestampDiv = document.createElement('div');
            timestampDiv.className = 'message-time';
            
            // Use saved metadata if available (v3), otherwise show "Restored" (v1, v2)
            if (msg.metadata) {
                timestampDiv.innerHTML = msg.metadata; // Restore full HTML with metrics
            } else {
                timestampDiv.textContent = 'Restored'; // Fallback for old format
            }
            
            // Assemble message structure
            contentWrapper.appendChild(contentDiv);
            contentWrapper.appendChild(timestampDiv);
            
            messageDiv.appendChild(avatarDiv);
            messageDiv.appendChild(contentWrapper);
            
            messages.appendChild(messageDiv);
        });
        
        // Scroll to bottom
        const chatContainer = document.getElementById('chatContainer');
        if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
        
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
                
                // Update model indicator when loading
                const modelIndicator = document.getElementById('modelIndicator');
                if (modelIndicator) {
                    modelIndicator.textContent = model;
                    console.log('Model indicator updated in loadModels to:', model);
                } else {
                    console.error('Model indicator element not found in loadModels!');
                }
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

// Loading spinner functions removed - not needed in simplified UI

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
        // ttsEngineSelect removed - not in simplified UI
        ttsEnabled = (savedEngine !== 'none');
    } else {
        currentTTSEngine = 'edge-tts';
        ttsEnabled = true;
        localStorage.setItem('ttsEngine', 'edge-tts');
    }
    
    // Update voice selector based on engine
    updateVoiceSelector(currentTTSEngine);
    
    // Load theme and other settings
    loadSavedSettings();
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
                        // Loading spinner removed
                    });
                    
                    socket.once('error', () => {
                        clearTimeout(modelChangeTimeout);
                        // Loading spinner removed
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
                    // Loading spinner removed
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