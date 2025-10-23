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
let audioQueue = []; // Queue for audio playback
let isPlayingAudio = false; // Track if audio is currently playing

// WebSocket reconnection settings
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
const baseReconnectDelay = 1000; // Start with 1 second
let reconnectTimeout = null;
let connectionState = 'disconnected'; // Track connection state: disconnected, connecting, connected, error

// Request/Response logging
const REQUEST_LOG_ENABLED = true; // Enable for debugging
function logRequest(type, data) {
    if (!REQUEST_LOG_ENABLED) return;
    console.log(`[REQUEST] ${new Date().toISOString()} - ${type}`, data);
}

function logResponse(type, data) {
    if (!REQUEST_LOG_ENABLED) return;
    console.log(`[RESPONSE] ${new Date().toISOString()} - ${type}`, data);
}

function logConnectionState(state, details = '') {
    console.log(`[CONNECTION] ${new Date().toISOString()} - State: ${state}`, details);
    connectionState = state;
    updateConnectionIndicator(state);
}

function updateConnectionIndicator(state) {
    // Visual indicator for connection state
    const statusText = document.getElementById('statusText');
    if (!statusText) return;

    switch(state) {
        case 'connecting':
            statusText.classList.add('status-warning');
            statusText.classList.remove('status-error', 'status-ready');
            break;
        case 'connected':
            statusText.classList.add('status-ready');
            statusText.classList.remove('status-error', 'status-warning');
            break;
        case 'error':
        case 'disconnected':
            statusText.classList.add('status-error');
            statusText.classList.remove('status-ready', 'status-warning');
            break;
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    // Ensure chat ID is always set
    if (!currentChatId) {
        currentChatId = Date.now().toString();
    }
    
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
            // console.error('Error checking saved conversation:', e);
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
    
    // Ensure speaker buttons are updated after DOM is ready
    setTimeout(() => {
        console.log('Updating speaker buttons, ttsEnabled:', ttsEnabled, 'currentTTSEngine:', currentTTSEngine);
        updateSpeakerButtons();
    }, 100);
    
    loadChatHistory(); // Load chat history for the hamburger menu
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

    logConnectionState('connecting', 'Initializing WebSocket connection');

    socket = io({
        reconnection: true,
        reconnectionAttempts: maxReconnectAttempts,
        reconnectionDelay: baseReconnectDelay,
        reconnectionDelayMax: 30000,
        timeout: 20000
    });

    socket.on('connect', () => {
        reconnectAttempts = 0; // Reset counter on successful connection
        logConnectionState('connected', 'Successfully connected to server');
        updateStatus('Connected', 'ready');
    });

    socket.on('disconnect', (reason) => {
        logConnectionState('disconnected', `Disconnected: ${reason}`);
        updateStatus('Disconnected', 'error');
        stopRecording();

        // Handle reconnection with exponential backoff
        if (reason === 'io server disconnect') {
            // Server disconnected us, try to reconnect
            attemptReconnection();
        }
    });

    socket.on('connect_error', (error) => {
        logConnectionState('error', `Connection error: ${error.message}`);
        attemptReconnection();
    });
    
    socket.on('connected', (data) => {
        logResponse('connected', data);
        fetchConfig();
    });

    socket.on('status', (data) => {
        logResponse('status', data);
        updateStatus(data.message, data.type);
    });

    socket.on('transcription', (data) => {
        logResponse('transcription', data);
        addMessage('user', data.text);
    });

    socket.on('response_chunk', (data) => {
        // Only log first chunk to avoid spam
        if (!firstTokenTime && messageStartTime) {
            logResponse('response_chunk', { model: data.model, length: data.text.length });
        }

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
        logResponse('response_complete', { model: data.model, length: data.text?.length });
        if (data.model) currentModel = data.model;
        completeResponse(data.text);
        // Save conversation after response is complete
        setTimeout(saveConversation, 100);
    });

    socket.on('tts_complete', () => {
        logResponse('tts_complete', {});
        updateStatus('Ready', 'ready');
    });

    socket.on('audio_data', (data) => {
        logResponse('audio_data', { hasAudio: !!data.audio, length: data.audio?.length });
        if (data.audio) {
            playAudioData(data.audio);
        }
    });

    socket.on('error', (data) => {
        logResponse('error', data);
        showError(data.message);
    });

    socket.on('conversation_cleared', () => {
        logResponse('conversation_cleared', {});
        clearChatDisplay();
    });

    socket.on('model_changed', (data) => {
        logResponse('model_changed', data);
        currentModel = data.model;  // Update current model
        updateStatus(`Model changed to ${data.model}`, 'ready');

        // Directly update model indicator to ensure it's visible
        const modelIndicator = document.getElementById('modelIndicator');
        if (modelIndicator) {
            modelIndicator.textContent = data.model;
        }

        loadModels();
    });

    socket.on('tts_changed', (data) => {
        logResponse('tts_changed', data);
        updateStatus('Voice settings updated', 'ready');
    });

    socket.on('whisper_model_changed', (data) => {
        logResponse('whisper_model_changed', data);
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
    
    // Mute button - toggle voice output
    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            toggleMute();
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
    
    // Global click handler for audio playback (handles autoplay policy)
    document.addEventListener('click', () => {
        // Try to play pending audio on any user interaction
        if (window.pendingAudio) {
            console.log('User interaction detected, attempting to play pending audio');
            window.pendingAudio.play().then(() => {
                console.log('Pending audio now playing');
                showAudioPlayingIndicator();
            }).catch(err => {
                console.error('Still cannot play audio:', err);
            });
            window.pendingAudio = null;
            // Remove click to play message if it exists
            const msg = document.querySelector('.click-to-play-msg');
            if (msg) msg.remove();
        }
    });
    
    // Send button
    if (sendBtn) {
        sendBtn.addEventListener('click', sendTextMessage);
    }
    
    // Clear button
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            logRequest('clear_conversation', {});
            socket.emit('clear_conversation');
        });
    }
    
    // Menu button
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            const sideMenu = document.getElementById('sideMenu');
            
            // Save current chat if needed before showing history
            const currentConversation = localStorage.getItem('assistedVoiceConversation');
            if (currentConversation && currentChatId) {
                const data = JSON.parse(currentConversation);
                if (data.messages && data.messages.length > 0) {
                    saveChatToHistory(data.messages, currentChatId);
                }
            }
            
            // Load and display chat history
            loadChatHistory();
            
            // Show the menu
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
    
    // New Chat button
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            startNewChat();
            // Close the menu after starting new chat
            const sideMenu = document.getElementById('sideMenu');
            const overlay = document.getElementById('overlay');
            sideMenu.classList.remove('open');
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
                const requestData = { model: model };
                logRequest('change_model', requestData);
                socket.emit('change_model', requestData);
                currentModel = model;
                localStorage.setItem('selectedModel', model);

                // Immediately update model indicator
                const modelIndicator = document.getElementById('modelIndicator');
                if (modelIndicator) {
                    modelIndicator.textContent = model;
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
                const requestData = { model: model };
                logRequest('change_whisper_model', requestData);
                socket.emit('change_whisper_model', requestData);
                localStorage.setItem('selectedWhisperModel', model);
            }
        });

        // Load saved Whisper model preference
        const savedWhisperModel = localStorage.getItem('selectedWhisperModel');
        if (savedWhisperModel) {
            whisperSelect.value = savedWhisperModel;
        }
    }

    // Voice/TTS engine selector in menu
    const voiceSelect = document.getElementById('voiceSelect');
    if (voiceSelect) {
        voiceSelect.addEventListener('change', (e) => {
            const engine = e.target.value;

            // Update TTS settings based on selection
            if (engine === 'none') {
                ttsEnabled = false;
                currentTTSEngine = 'none';
            } else if (engine === 'edge-tts') {
                ttsEnabled = true;
                currentTTSEngine = 'edge-tts';
                const requestData = { engine: 'edge-tts' };
                logRequest('change_tts', requestData);
                socket.emit('change_tts', requestData);
            } else if (engine === 'macos') {
                ttsEnabled = true;
                currentTTSEngine = 'macos';
                const requestData = { engine: 'macos' };
                logRequest('change_tts', requestData);
                socket.emit('change_tts', requestData);
            }

            // Save preference
            localStorage.setItem('ttsEngine', engine);

            // Update speaker buttons on existing messages
            updateSpeakerButtons();
        });
        
        // Load saved preference and apply it
        const savedEngine = localStorage.getItem('ttsEngine') || 'edge-tts';
        voiceSelect.value = savedEngine;
        
        // Apply the saved engine settings
        if (savedEngine === 'none') {
            ttsEnabled = false;
            currentTTSEngine = 'none';
        } else if (savedEngine === 'edge-tts') {
            ttsEnabled = true;
            currentTTSEngine = 'edge-tts';
        } else if (savedEngine === 'macos') {
            ttsEnabled = true;
            currentTTSEngine = 'macos';
        }
        
        // Update speaker buttons based on current state
        updateSpeakerButtons();
    }
}

/**
 * Setup settings panel event listeners
 */
function setupSettingsListeners() {
    // Server Configuration
    setupServerSettings();
    
    // AI Model Settings
    setupAIModelSettings();
    
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

// REMOVED: Unused sound effects functionality
// /**
//  * Play a sound effect if enabled
//  */
// function playSound(type) {
//     const soundEnabled = localStorage.getItem('soundEffects') === 'true';
//     if (!soundEnabled) return;
//     
//     // Create audio element
//     const audio = new Audio();
//     
//     // Use different sounds for different events
//     switch(type) {
//         case 'send':
//             // Use a simple beep for send (data URI for a short beep sound)
//             audio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBBxypOXyvmMfBjiS2Oy9diMFl2z2wliWPTJW9XvuNxMEA';
//             break;
//         case 'receive':
//             // Use a different beep for receive
//             audio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBCZypOXyvmMfBjiS2Oy9diMGlmz2wVmVPzNX9HvtOBQFBg';
//             audio.volume = 0.3;
//             break;
//     }
//     
//     // Play the sound
//     audio.play().catch(e => {}); // Silently fail if sound cannot play
// }

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

                const requestData = {
                    audio: reader.result,
                    enable_tts: ttsEnabled
                };
                logRequest('process_audio', { audioSize: reader.result.length, enable_tts: ttsEnabled });
                socket.emit('process_audio', requestData);
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
        // console.error('Error starting recording:', err);
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
 * Replay a message using TTS
 */
function replayMessage(text) {
    // Always allow manual replay via speaker button, regardless of TTS settings
    if (text) {
        const requestData = { text: text, enable_tts: true };
        logRequest('replay_text', { textLength: text.length });
        socket.emit('replay_text', requestData);
    }
}

/**
 * Play audio data received from server - simplified version
 */
function playAudioData(audioDataUrl) {
    try {
        console.log('Received audio for playback, data URL length:', audioDataUrl.length);
        console.log('First 100 chars:', audioDataUrl.substring(0, 100));
        
        // Validate the audio data URL format
        if (!audioDataUrl.startsWith('data:audio')) {
            console.error('Invalid audio data URL format, received:', audioDataUrl.substring(0, 50));
            return;
        }
        
        // Create and play audio directly - simple approach that works
        const audio = new Audio(audioDataUrl);
        audio.volume = 1.0;
        
        // Play the audio immediately
        audio.play().then(() => {
            console.log('Audio playing successfully');
        }).catch(err => {
            console.error('Audio playback error:', err);
            // Try clicking anywhere on the page to enable audio
            if (err.name === 'NotAllowedError') {
                console.log('Browser requires user interaction for audio. Click anywhere on the page.');
                // Store audio for later playback after user interaction
                window.pendingAudio = audio;
                
                // Add one-time click handler to play audio
                document.addEventListener('click', function playPendingAudio() {
                    if (window.pendingAudio) {
                        window.pendingAudio.play().catch(e => console.error('Retry play error:', e));
                        window.pendingAudio = null;
                        document.removeEventListener('click', playPendingAudio);
                    }
                }, { once: true });
            }
        });
        
    } catch (err) {
        console.error('Error in playAudioData:', err);
    }
}

/**
 * Play the next audio in queue
 */
function playNextInQueue() {
    if (audioQueue.length === 0) {
        isPlayingAudio = false;
        return;
    }
    
    isPlayingAudio = true;
    const audioDataUrl = audioQueue.shift();
    
    const audio = new Audio(audioDataUrl);
    audio.volume = 1.0;
    
    // Add event listeners
    audio.addEventListener('ended', () => {
        console.log('Audio playback ended');
        // Play next in queue
        playNextInQueue();
    });
    
    audio.addEventListener('error', (e) => {
        console.error('Audio error:', e);
        // Try next in queue on error
        playNextInQueue();
    });
    
    // Attempt to play
    const playPromise = audio.play();
    
    if (playPromise !== undefined) {
        playPromise.then(() => {
            console.log('Audio playback started successfully');
            // Add visual indicator that audio is playing
            showAudioPlayingIndicator();
        }).catch(err => {
            console.error('Error playing audio:', err);
            isPlayingAudio = false;
            
            if (err.name === 'NotAllowedError') {
                console.log('Autoplay blocked - showing click to play message');
                showClickToPlayMessage();
                // Store for manual trigger
                window.pendingAudioQueue = audioQueue;
                window.pendingAudioQueue.unshift(audioDataUrl); // Put it back
                audioQueue = []; // Clear queue
            }
        });
    }
}

/**
 * Show visual indicator that audio is playing
 */
function showAudioPlayingIndicator() {
    // Remove any existing indicator
    const existingIndicator = document.querySelector('.audio-playing-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }
    
    // Create new indicator
    const indicator = document.createElement('div');
    indicator.className = 'audio-playing-indicator';
    indicator.innerHTML = '🔊 Playing audio...';
    indicator.style.cssText = `
        position: fixed;
        top: 70px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 14px;
        z-index: 1000;
        animation: fadeInOut 2s;
    `;
    document.body.appendChild(indicator);
    
    // Remove after 2 seconds
    setTimeout(() => {
        indicator.remove();
    }, 2000);
}

/**
 * Show click to play message when autoplay is blocked
 */
function showClickToPlayMessage() {
    // Remove any existing message
    const existingMsg = document.querySelector('.click-to-play-msg');
    if (existingMsg) {
        existingMsg.remove();
    }
    
    // Create message
    const msg = document.createElement('div');
    msg.className = 'click-to-play-msg';
    msg.innerHTML = '🔇 Click anywhere to enable audio playback';
    msg.style.cssText = `
        position: fixed;
        top: 70px;
        left: 50%;
        transform: translateX(-50%);
        background: #ff9800;
        color: white;
        padding: 12px 24px;
        border-radius: 25px;
        font-size: 14px;
        z-index: 1000;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    `;
    
    // Add click handler to play pending audio
    msg.onclick = () => {
        msg.remove();
        if (window.pendingAudioQueue && window.pendingAudioQueue.length > 0) {
            audioQueue = window.pendingAudioQueue;
            window.pendingAudioQueue = null;
            playNextInQueue();
        }
    };
    
    document.body.appendChild(msg);
}

/**
 * Update speaker buttons on existing messages based on current TTS state
 */
function updateSpeakerButtons() {
    const messages = document.querySelectorAll('.message.assistant .message-time');
    
    messages.forEach(timestampDiv => {
        const existingBtn = timestampDiv.querySelector('.message-speaker-btn');
        const messageContent = timestampDiv.parentElement.querySelector('.message-content');
        const text = messageContent ? messageContent.textContent : '';
        
        // Always show speaker button for assistant messages with text
        // Speaker button should work regardless of TTS settings
        if (!existingBtn && text) {
            // Add speaker button
            const speakerBtn = document.createElement('button');
            speakerBtn.className = 'message-speaker-btn';
            speakerBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>
            `;
            speakerBtn.onclick = () => replayMessage(text);
            timestampDiv.appendChild(speakerBtn);
        }
        // Never remove speaker buttons - they should always be available
    });
}

/**
 * Toggle mute state for TTS
 */
function toggleMute() {
    const muteBtn = document.getElementById('muteBtn');
    const speakerOnIcon = muteBtn.querySelector('.speaker-on-icon');
    const speakerOffIcon = muteBtn.querySelector('.speaker-off-icon');
    
    if (ttsEnabled) {
        // Currently unmuted, so mute it
        // Save the current engine before muting
        localStorage.setItem('previousTTSEngine', currentTTSEngine);
        
        // Mute
        ttsEnabled = false;
        currentTTSEngine = 'none';
        
        // Update UI
        muteBtn.classList.add('muted');
        speakerOnIcon.style.display = 'none';
        speakerOffIcon.style.display = 'block';
        
        // Update voice selector in settings if open
        const voiceSelect = document.getElementById('voiceSelect');
        if (voiceSelect) {
            voiceSelect.value = 'none';
        }
        
        // Emit to backend
        const muteRequestData = { engine: 'none' };
        logRequest('change_tts', muteRequestData);
        socket.emit('change_tts', muteRequestData);

        // Save mute state
        localStorage.setItem('ttsEngine', 'none');
        localStorage.setItem('isMuted', 'true');

        updateStatus('Voice output muted', 'ready');
    } else {
        // Currently muted, so unmute it
        // Restore previous engine or default to edge-tts
        const previousEngine = localStorage.getItem('previousTTSEngine') || 'edge-tts';

        // Unmute
        ttsEnabled = true;
        currentTTSEngine = previousEngine;

        // Update UI
        muteBtn.classList.remove('muted');
        speakerOnIcon.style.display = 'block';
        speakerOffIcon.style.display = 'none';

        // Update voice selector in settings if open
        const voiceSelect = document.getElementById('voiceSelect');
        if (voiceSelect) {
            voiceSelect.value = previousEngine;
        }

        // Emit to backend
        const unmuteRequestData = { engine: previousEngine };
        logRequest('change_tts', unmuteRequestData);
        socket.emit('change_tts', unmuteRequestData);
        
        // Save unmute state
        localStorage.setItem('ttsEngine', previousEngine);
        localStorage.setItem('isMuted', 'false');
        
        updateStatus('Voice output enabled', 'ready');
    }
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
    const requestData = {
        text: text,
        enable_tts: ttsEnabled
    };
    logRequest('process_text', { textLength: text.length, enable_tts: ttsEnabled });
    socket.emit('process_text', requestData);
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
    
    // Add avatar with SVG icon
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    if (role === 'user') {
        avatarDiv.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
        `;
    } else {
        avatarDiv.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79s7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58s9.14-3.47 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z"/>
            </svg>
        `;
    }
    
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
    
    // Add speaker button for assistant messages
    if (role === 'assistant' && ttsEnabled) {
        const speakerBtn = document.createElement('button');
        speakerBtn.className = 'message-speaker-btn';
        speakerBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
        `;
        speakerBtn.onclick = () => replayMessage(text);
        timestampDiv.appendChild(speakerBtn);
    }
    
    // Assemble message structure
    contentWrapper.appendChild(contentDiv);
    contentWrapper.appendChild(timestampDiv);
    
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(contentWrapper);
    
    // Append to messages container
    if (messages) {
        messages.appendChild(messageDiv);
        
        // Play sound effect if enabled
        // Commented out: Sound effects not implemented, playSound function doesn't exist
        // const soundEnabled = localStorage.getItem('soundEffects') === 'true';
        // if (soundEnabled) {
        //     playSound(role === 'user' ? 'send' : 'receive');
        // }
        
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
    // Only create message div if we have actual text to display
    if (!text || text.trim() === '') {
        return;
    }
    
    // Remove typing indicator when response starts
    const typingIndicator = document.querySelector('.typing-indicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
    
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
        
        // Add avatar with SVG icon
        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';
        avatarDiv.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79s7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58s9.14-3.47 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z"/>
            </svg>
        `;
        
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
    // Remove typing indicator if it exists
    const typingIndicator = document.querySelector('.typing-indicator');
    if (typingIndicator) {
        typingIndicator.remove();
    }
    
    // Don't complete if we have no text
    if (!fullText || fullText.trim() === '') {
        currentResponse = '';
        currentResponseDiv = null;
        return;
    }
    
    if (currentResponseDiv) {
        // Play sound effect if enabled
        // Commented out: Sound effects not implemented, playSound function doesn't exist
        // const soundEnabled = localStorage.getItem('soundEffects') === 'true';
        // if (soundEnabled) {
        //     playSound('receive');
        // }
        
        // Update timestamp with metrics
        let timestampDiv = currentResponseDiv.parentElement?.querySelector('.message-time');
        if (timestampDiv) {
            // Save existing speaker button if present
            const existingSpeakerBtn = timestampDiv.querySelector('.message-speaker-btn');
            
            if (messageStartTime) {
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
            } else {
                const now = new Date();
                timestampDiv.innerHTML = `
                    ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${currentModel || 'llama3.2:3b'}
                `;
            }
            
            // Restore speaker button if it was removed
            if (existingSpeakerBtn) {
                timestampDiv.appendChild(existingSpeakerBtn);
            }
        }
        console.log('Speaker button debug:', {
            timestampDiv: !!timestampDiv,
            ttsEnabled,
            currentTTSEngine,
            fullText: fullText?.substring(0, 50)
        });
        
        // Add speaker button if not already present
        if (timestampDiv && !timestampDiv.querySelector('.message-speaker-btn')) {
            const speakerBtn = document.createElement('button');
            speakerBtn.className = 'message-speaker-btn';
            speakerBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
            `;
            speakerBtn.onclick = () => {
                console.log('Speaker button clicked, text:', fullText);
                // Always allow manual replay via speaker button
                replayMessage(fullText);
            };
            timestampDiv.appendChild(speakerBtn);
            console.log('Speaker button added successfully');
        } else if (timestampDiv) {
            console.log('Speaker button already present');
        } else {
            console.log('Could not find timestampDiv to add speaker button');
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
            
            // Add avatar with SVG icon
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'message-avatar';
            if (msg.role === 'user') {
                avatarDiv.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                    </svg>
                `;
            } else {
                avatarDiv.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79s7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58s9.14-3.47 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z"/>
                    </svg>
                `;
            }
            
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
            
            // Add speaker button for assistant messages only if not already in metadata
            // Check if metadata already contains a speaker button to avoid duplicates
            if (msg.role === 'assistant') {
                const hasExistingSpeakerBtn = msg.metadata && msg.metadata.includes('message-speaker-btn');
                if (!hasExistingSpeakerBtn) {
                    const speakerBtn = document.createElement('button');
                    speakerBtn.className = 'message-speaker-btn';
                    speakerBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                        </svg>
                    `;
                    speakerBtn.onclick = () => replayMessage(msg.content);
                    timestampDiv.appendChild(speakerBtn);
                }
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
        // console.error('Failed to load conversation:', err);
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
        
        // Don't load conversation here - it's already loaded in DOMContentLoaded
        // loadConversation();
        
        // Setup model quick select after loading config
        setupModelQuickSelect();
        
        // Update container state
        updateChatContainerState();
    } catch (err) {
        // console.error('Failed to fetch config:', err);
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
                    // console.log('Model indicator updated in loadModels to:', model);
                } else {
                    // console.error('Model indicator element not found in loadModels!');
                }
            }
            modelSelect.appendChild(option);
        });
    } catch (err) {
        // console.error('Failed to load models:', err);
    }
}

/**
 * Update voice selector based on TTS engine
 */
function updateVoiceSelector(engine) {
    const voiceSelect = document.getElementById('voiceSelect');
    if (!voiceSelect) return;
    
    // Clear current options
    voiceSelect.innerHTML = '';
    
    if (engine === 'none') {
        // Disable voice selector for text-only mode
        voiceSelect.disabled = true;
        const option = document.createElement('option');
        option.textContent = 'Voice disabled';
        voiceSelect.appendChild(option);
    } else {
        voiceSelect.disabled = false;
        
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

// Removed loadSimpleVoices() - deprecated function
// Voice loading is now handled directly by updateVoiceSelector()

// Removed modelLoadingTimes object - not used anywhere in the code

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
    // Load TTS engine preference with validation
    const savedEngine = localStorage.getItem('ttsEngine');
    const validEngines = ['edge-tts', 'macos', 'none'];
    
    if (savedEngine && validEngines.includes(savedEngine)) {
        currentTTSEngine = savedEngine;
        ttsEnabled = (savedEngine !== 'none');
        
        // Update voice selector to match saved setting
        const voiceSelect = document.getElementById('voiceSelect');
        if (voiceSelect) {
            voiceSelect.value = savedEngine;
        }
    } else {
        // Clear invalid or missing setting and set defaults
        currentTTSEngine = 'edge-tts';
        ttsEnabled = true;
        localStorage.setItem('ttsEngine', 'edge-tts');
        
        // Update voice selector to match default
        const voiceSelect = document.getElementById('voiceSelect');
        if (voiceSelect) {
            voiceSelect.value = 'edge-tts';
        }
    }
    
    // Don't call updateVoiceSelector here - it overwrites the Voice Engine dropdown
    // The Voice Engine dropdown should maintain its options
    
    // Update mute button visual state
    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
        const speakerOnIcon = muteBtn.querySelector('.speaker-on-icon');
        const speakerOffIcon = muteBtn.querySelector('.speaker-off-icon');
        
        if (currentTTSEngine === 'none' || !ttsEnabled) {
            // Show muted state
            muteBtn.classList.add('muted');
            if (speakerOnIcon) speakerOnIcon.style.display = 'none';
            if (speakerOffIcon) speakerOffIcon.style.display = 'block';
        } else {
            // Show unmuted state
            muteBtn.classList.remove('muted');
            if (speakerOnIcon) speakerOnIcon.style.display = 'block';
            if (speakerOffIcon) speakerOffIcon.style.display = 'none';
        }
    }
    
    // Update speaker buttons on existing messages to match TTS state
    updateSpeakerButtons();
    
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
                        // console.error('No model specified for button');
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
                    const requestData = { model: model };
                    logRequest('change_model', requestData);
                    socket.emit('change_model', requestData);
                    currentModel = model;
                    localStorage.setItem('selectedModel', model);

                    // Update the model selector dropdown
                    const modelSelect = document.getElementById('modelSelect');
                    if (modelSelect) {
                        modelSelect.value = model;
                    }
                } catch (error) {
                    // console.error('Error in model card click:', error);
                    // Loading spinner removed
                    showError('Failed to change model. Please try again.');
                }
                
                // Hide the quick select UI
                updateChatContainerState();
            });
        });
    } catch (error) {
        // console.error('Error setting up model quick select:', error);
    }
}

/**
 * Chat History Management Functions
 */

// Global variable to track current chat ID
let currentChatId = Date.now().toString(); // Initialize with unique ID on load

/**
 * Start a new chat
 */
function startNewChat() {
    // Save current conversation if it has messages
    const currentConversation = localStorage.getItem('assistedVoiceConversation');
    if (currentConversation && currentChatId) {
        const data = JSON.parse(currentConversation);
        if (data.messages && data.messages.length > 0) {
            saveChatToHistory(data.messages, currentChatId);
        }
    }
    
    // Clear current conversation
    clearChatDisplay();
    localStorage.removeItem('assistedVoiceConversation');
    // Generate new unique chat ID
    currentChatId = Date.now().toString();
    
    // Update UI to show welcome screen
    showWelcomeScreen();
    
    // Refresh chat history display
    loadChatHistory();
}

/**
 * Save current chat to history
 */
function saveChatToHistory(messages, chatId = null) {
    if (!messages || messages.length === 0) return;
    
    // Use provided chatId or generate new one
    const id = chatId || Date.now().toString();
    const firstMessage = messages.find(msg => msg.role === 'user');
    const preview = firstMessage ? firstMessage.content.substring(0, 60) : 'New chat';
    
    const chatData = {
        id: id,
        timestamp: new Date().toISOString(),
        preview: preview,
        messageCount: messages.length,
        messages: messages
    };
    
    // Get existing chat history
    const history = getChatHistory();
    
    // Check if this chat already exists and update it
    const existingIndex = history.findIndex(chat => chat.id === id);
    if (existingIndex !== -1) {
        // Update existing chat
        history[existingIndex] = chatData;
    } else {
        // Add new chat to beginning
        history.unshift(chatData);
    }
    
    // Keep only last 20 chats
    if (history.length > 20) {
        history.splice(20);
    }
    
    // Save back to localStorage
    localStorage.setItem('assistedVoiceChatHistory', JSON.stringify(history));
}

/**
 * Get chat history from localStorage
 */
function getChatHistory() {
    try {
        const history = localStorage.getItem('assistedVoiceChatHistory');
        return history ? JSON.parse(history) : [];
    } catch (error) {
        console.error('Error loading chat history:', error);
        return [];
    }
}

/**
 * Load and display chat history in the menu
 */
function loadChatHistory() {
    const chatHistoryList = document.getElementById('chatHistoryList');
    if (!chatHistoryList) return;
    
    const history = getChatHistory();
    
    if (history.length === 0) {
        chatHistoryList.innerHTML = `
            <div class="history-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
                <p>No previous chats</p>
            </div>
        `;
        return;
    }
    
    // Build history HTML
    let historyHTML = '';
    history.forEach(chat => {
        const date = new Date(chat.timestamp);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const isActive = currentChatId === chat.id;
        
        historyHTML += `
            <div class="history-item ${isActive ? 'active' : ''}" data-chat-id="${chat.id}">
                <button class="history-item-delete" data-chat-id="${chat.id}">✕</button>
                <div class="history-item-date">${dateStr}</div>
                <div class="history-item-preview">${chat.preview}</div>
                <div class="history-item-count">${chat.messageCount} messages</div>
            </div>
        `;
    });
    
    chatHistoryList.innerHTML = historyHTML;
    
    // Add click handlers for history items
    chatHistoryList.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't load chat if delete button was clicked
            if (e.target.classList.contains('history-item-delete')) return;
            
            const chatId = item.dataset.chatId;
            loadChatFromHistory(chatId);
        });
    });
    
    // Add click handlers for delete buttons
    chatHistoryList.querySelectorAll('.history-item-delete').forEach(button => {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const chatId = button.dataset.chatId;
            deleteChatFromHistory(chatId);
        });
    });
}

/**
 * Load a specific chat from history
 */
function loadChatFromHistory(chatId) {
    const history = getChatHistory();
    const chat = history.find(c => c.id === chatId);
    
    if (!chat) return;
    
    // Save current conversation first if needed
    const currentConversation = localStorage.getItem('assistedVoiceConversation');
    if (currentConversation && currentChatId) {
        const data = JSON.parse(currentConversation);
        if (data.messages && data.messages.length > 0) {
            saveChatToHistory(data.messages, currentChatId);
        }
    }
    
    // Load the selected chat
    currentChatId = chatId;
    
    // Clear current display and load chat messages
    clearChatDisplay();
    
    // Load messages into display
    chat.messages.forEach(message => {
        addMessage(message.role, message.content, false); // false = don't save to localStorage
    });
    
    // Update localStorage with current conversation
    localStorage.setItem('assistedVoiceConversation', JSON.stringify({
        messages: chat.messages,
        timestamp: chat.timestamp
    }));
    
    // Hide welcome screen and show messages
    hideWelcomeScreen();
    
    // Close the history menu
    const sideMenu = document.getElementById('sideMenu');
    const overlay = document.getElementById('overlay');
    sideMenu.classList.remove('open');
    overlay.classList.remove('active');
    
    // Refresh history display to show active state
    loadChatHistory();
}

/**
 * Delete a chat from history
 */
function deleteChatFromHistory(chatId) {
    const history = getChatHistory();
    const updatedHistory = history.filter(c => c.id !== chatId);
    localStorage.setItem('assistedVoiceChatHistory', JSON.stringify(updatedHistory));
    
    // If we deleted the currently active chat, clear it first then start a new one
    if (currentChatId === chatId) {
        // Clear the current conversation from localStorage first to prevent re-saving
        localStorage.removeItem('assistedVoiceConversation');
        // Clear the display
        clearChatDisplay();
        // Generate new chat ID
        currentChatId = Date.now().toString();
        // Show welcome screen
        showWelcomeScreen();
        // Refresh history display
        loadChatHistory();
    } else {
        // Just refresh the history display
        loadChatHistory();
    }
}

/**
 * Show welcome screen
 */
function showWelcomeScreen() {
    const welcome = document.getElementById('welcome');
    const messages = document.getElementById('messages');
    
    if (welcome) welcome.style.display = 'flex';
    if (messages) messages.classList.remove('active');
}

/**
 * Hide welcome screen
 */
function hideWelcomeScreen() {
    const welcome = document.getElementById('welcome');
    const messages = document.getElementById('messages');
    
    if (welcome) welcome.style.display = 'none';
    if (messages) messages.classList.add('active');
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

/**
 * Setup server configuration settings
 */
function setupServerSettings() {
    const serverTypeSelect = document.getElementById('serverTypeSelect');
    const serverHost = document.getElementById('serverHost');
    const serverPort = document.getElementById('serverPort');
    const testConnectionBtn = document.getElementById('testConnectionBtn');
    const connectionStatus = document.getElementById('connectionStatus');
    
    // Load saved server config from localStorage
    const savedServerType = localStorage.getItem('serverType') || 'ollama';
    const savedServerHost = localStorage.getItem('serverHost') || 'localhost';
    const savedServerPort = localStorage.getItem('serverPort') || '11434';
    
    if (serverTypeSelect) {
        serverTypeSelect.value = savedServerType;
        serverTypeSelect.addEventListener('change', (e) => {
            const serverType = e.target.value;
            localStorage.setItem('serverType', serverType);
            
            // Update default port based on server type
            if (serverType === 'lm-studio' && serverPort.value === '11434') {
                serverPort.value = '1234';
                localStorage.setItem('serverPort', '1234');
            } else if (serverType === 'ollama' && serverPort.value === '1234') {
                serverPort.value = '11434';
                localStorage.setItem('serverPort', '11434');
            }
            
            showToast(`Server type changed to ${serverType}`, 'success');
        });
    }
    
    if (serverHost) {
        serverHost.value = savedServerHost;
        serverHost.addEventListener('change', (e) => {
            localStorage.setItem('serverHost', e.target.value);
            showToast('Server host updated', 'success');
        });
    }
    
    if (serverPort) {
        serverPort.value = savedServerPort;
        serverPort.addEventListener('change', (e) => {
            localStorage.setItem('serverPort', e.target.value);
            showToast('Server port updated', 'success');
        });
    }
    
    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', async () => {
            testConnectionBtn.disabled = true;
            testConnectionBtn.textContent = 'Testing...';
            connectionStatus.textContent = '';
            connectionStatus.className = 'connection-status';
            
            try {
                const host = serverHost.value || 'localhost';
                const port = serverPort.value || '11434';
                const serverType = serverTypeSelect.value || 'ollama';
                
                // Send test request to backend
                const response = await fetch('/api/test-connection', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        type: serverType,
                        host: host,
                        port: parseInt(port)
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    connectionStatus.textContent = '✓ Connected';
                    connectionStatus.className = 'connection-status success';
                    showToast('Connection successful!', 'success');
                } else {
                    connectionStatus.textContent = '✗ Connection failed';
                    connectionStatus.className = 'connection-status error';
                    showToast(result.error || 'Connection failed', 'error');
                }
            } catch (error) {
                connectionStatus.textContent = '✗ Connection failed';
                connectionStatus.className = 'connection-status error';
                showToast('Failed to test connection', 'error');
            } finally {
                testConnectionBtn.disabled = false;
                testConnectionBtn.textContent = 'Test Connection';
            }
        });
    }
}

/**
 * Setup AI Model Settings (temperature, max tokens, system prompt)
 */
function setupAIModelSettings() {
    // Temperature slider
    const temperatureSlider = document.getElementById('temperatureSlider');
    const temperatureValue = document.getElementById('temperatureValue');
    
    if (temperatureSlider && temperatureValue) {
        // Load saved temperature
        const savedTemp = localStorage.getItem('aiTemperature') || '0.7';
        temperatureSlider.value = savedTemp;
        temperatureValue.textContent = savedTemp;
        
        // Handle temperature changes
        temperatureSlider.addEventListener('input', (e) => {
            const temp = e.target.value;
            temperatureValue.textContent = temp;
            localStorage.setItem('aiTemperature', temp);

            // Send to backend
            if (socket && socket.connected) {
                const requestData = { temperature: parseFloat(temp) };
                logRequest('update_temperature', requestData);
                socket.emit('update_temperature', requestData);
            }
        });
    }

    // Max tokens input
    const maxTokensInput = document.getElementById('maxTokensInput');

    if (maxTokensInput) {
        // Load saved max tokens
        const savedMaxTokens = localStorage.getItem('aiMaxTokens') || '500';
        maxTokensInput.value = savedMaxTokens;

        // Handle max tokens changes
        maxTokensInput.addEventListener('change', (e) => {
            const maxTokens = parseInt(e.target.value);

            // Validate range
            if (maxTokens < 50) {
                e.target.value = 50;
            } else if (maxTokens > 2000) {
                e.target.value = 2000;
            }

            localStorage.setItem('aiMaxTokens', e.target.value);

            // Send to backend
            if (socket && socket.connected) {
                const requestData = { max_tokens: parseInt(e.target.value) };
                logRequest('update_max_tokens', requestData);
                socket.emit('update_max_tokens', requestData);
            }
        });
    }
    
    // System prompt textarea
    const systemPromptTextarea = document.getElementById('systemPromptTextarea');
    const promptTemplates = document.getElementById('promptTemplates');
    const resetPromptBtn = document.getElementById('resetPromptBtn');
    
    const defaultPrompt = 'You are a helpful voice assistant. Keep responses concise and natural for speech. Avoid using markdown, special characters, or formatting that doesn\'t work well when spoken aloud. Be conversational and friendly.';
    
    const templates = {
        'default': defaultPrompt,
        'technical': 'You are a technical expert assistant. Provide detailed technical explanations while keeping responses clear and well-structured for voice output. Focus on accuracy and completeness.',
        'creative': 'You are a creative writing assistant. Help with storytelling, creative ideas, and imaginative responses. Keep language vivid but natural for speech.',
        'tutor': 'You are an educational tutor. Explain concepts clearly and patiently, breaking down complex topics into understandable parts. Encourage learning and ask clarifying questions.',
        'concise': 'You are a concise assistant. Provide brief, direct answers without unnecessary elaboration. Focus on the essential information only.'
    };
    
    if (systemPromptTextarea) {
        // Load saved system prompt
        const savedPrompt = localStorage.getItem('aiSystemPrompt') || defaultPrompt;
        systemPromptTextarea.value = savedPrompt;
        
        // Handle system prompt changes
        let promptDebounceTimeout = null;
        systemPromptTextarea.addEventListener('input', (e) => {
            // Debounce to avoid sending too many updates
            clearTimeout(promptDebounceTimeout);
            promptDebounceTimeout = setTimeout(() => {
                const prompt = e.target.value;
                localStorage.setItem('aiSystemPrompt', prompt);

                // Send to backend
                if (socket && socket.connected) {
                    const requestData = { system_prompt: prompt };
                    logRequest('update_system_prompt', { promptLength: prompt.length });
                    socket.emit('update_system_prompt', requestData);
                }
            }, 500); // Wait 500ms after user stops typing
        });
    }

    // Prompt templates dropdown
    if (promptTemplates) {
        promptTemplates.addEventListener('change', (e) => {
            const templateKey = e.target.value;
            if (templateKey && templates[templateKey]) {
                systemPromptTextarea.value = templates[templateKey];
                localStorage.setItem('aiSystemPrompt', templates[templateKey]);

                // Send to backend
                if (socket && socket.connected) {
                    const requestData = { system_prompt: templates[templateKey] };
                    logRequest('update_system_prompt', { template: templateKey });
                    socket.emit('update_system_prompt', requestData);
                }

                // Reset dropdown to placeholder
                promptTemplates.value = '';
            }
        });
    }

    // Reset prompt button
    if (resetPromptBtn) {
        resetPromptBtn.addEventListener('click', () => {
            systemPromptTextarea.value = defaultPrompt;
            localStorage.setItem('aiSystemPrompt', defaultPrompt);

            // Send to backend
            if (socket && socket.connected) {
                const requestData = { system_prompt: defaultPrompt };
                logRequest('update_system_prompt', { action: 'reset' });
                socket.emit('update_system_prompt', requestData);
            }

            showToast('System prompt reset to default', 'success');
        });
    }
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    // Add to body
    document.body.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 300);
    }, 3000);
}