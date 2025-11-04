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
let currentAudio = null; // Track currently playing audio element
let isGenerating = false; // Track if LLM is generating response

// Audio visualization (Feature 2.1)
let audioContext = null;
let analyser = null;
let animationFrameId = null;
let audioBars = [];

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

/**
 * Render markdown text to safe HTML
 * @param {string} text - Markdown text to render
 * @returns {string} - Sanitized HTML
 */
function renderMarkdown(text) {
    if (!text || typeof text !== 'string') return '';

    // Configure marked.js with highlight.js integration
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            highlight: function(code, lang) {
                if (typeof hljs !== 'undefined') {
                    if (lang && hljs.getLanguage(lang)) {
                        try {
                            return hljs.highlight(code, { language: lang }).value;
                        } catch (e) {
                            console.error('Highlight error:', e);
                        }
                    }
                    try {
                        return hljs.highlightAuto(code).value;
                    } catch (e) {
                        console.error('Highlight auto error:', e);
                        return code;
                    }
                }
                return code;
            },
            breaks: true,        // GFM line breaks
            gfm: true,          // GitHub Flavored Markdown
            tables: true,       // Support tables
            smartLists: true,   // Better list handling
            smartypants: false  // Don't convert quotes/dashes
        });

        try {
            // Parse markdown to HTML
            const rawHtml = marked.parse(text);

            // Sanitize HTML with DOMPurify
            if (typeof DOMPurify !== 'undefined') {
                return DOMPurify.sanitize(rawHtml, {
                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'div', 'span'],
                    ALLOWED_ATTR: ['href', 'target', 'rel', 'class']
                });
            }
            return rawHtml;
        } catch (e) {
            console.error('Markdown render error:', e);
            return text; // Fallback to plain text on error
        }
    }

    return text; // Fallback if marked is not loaded
}

/**
 * Add copy buttons to code blocks
 * @param {HTMLElement} container - Container element with rendered markdown
 */
function addCopyButtonsToCodeBlocks(container) {
    if (!container) return;

    const codeBlocks = container.querySelectorAll('pre > code');

    codeBlocks.forEach((codeBlock) => {
        const pre = codeBlock.parentElement;

        // Skip if copy button already exists
        if (pre.querySelector('.code-copy-btn')) return;

        // Create copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
        `;
        copyBtn.setAttribute('aria-label', 'Copy code');
        copyBtn.title = 'Copy code';

        // Add click handler
        copyBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();

            try {
                const code = codeBlock.textContent;
                await navigator.clipboard.writeText(code);

                // Visual feedback
                copyBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                `;
                copyBtn.classList.add('copied');

                showToast('Code copied to clipboard!', 'success');

                // Reset button after 2 seconds
                setTimeout(() => {
                    copyBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                    `;
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch (err) {
                console.error('Failed to copy code:', err);
                showToast('Failed to copy code', 'error');
            }
        };

        // Add button to pre element
        pre.style.position = 'relative';
        pre.appendChild(copyBtn);
    });
}

// Toast Notification System
function showToast(message, type = 'success', duration = 2000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Create icon based on type
    let iconSVG = '';
    if (type === 'success') {
        iconSVG = '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    } else if (type === 'error') {
        iconSVG = '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    } else {
        iconSVG = '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }

    toast.innerHTML = `
        ${iconSVG}
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Auto-remove after duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
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

    // Initialize routing
    initializeRouting();
});

/**
 * View Routing System - Navigate between chat and settings page
 */
function initializeRouting() {
    const chatContainer = document.getElementById('chatContainer');
    const settingsPage = document.getElementById('settingsPage');
    const settingsPanel = document.getElementById('settingsPanel');
    const settingsPageContent = document.getElementById('settingsPageContent');
    const settingsContent = document.querySelector('.settings-content');
    const menuBtn = document.getElementById('menuBtn');
    const backBtn = document.getElementById('backBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const appTitle = document.querySelector('.app-title');
    const overlay = document.getElementById('overlay');

    // Navigate to a specific view
    function navigateToView(view) {
        if (view === 'settings') {
            // Move settings content from panel to page
            if (settingsContent && settingsPageContent) {
                settingsPageContent.appendChild(settingsContent);
            }

            // Hide chat, show settings page
            if (chatContainer) chatContainer.style.display = 'none';
            if (settingsPage) settingsPage.style.display = 'flex';
            if (settingsPanel) settingsPanel.classList.remove('open');

            // Remove overlay and blur effect
            if (overlay) overlay.classList.remove('active');

            // Update header
            if (menuBtn) menuBtn.style.display = 'none';
            if (backBtn) backBtn.style.display = 'flex';
            if (settingsBtn) settingsBtn.style.display = 'none';
            if (appTitle) appTitle.textContent = 'Settings';

            // Update URL hash
            window.location.hash = '#/settings';
        } else {
            // Move settings content back to panel
            const settingsPanelContainer = settingsPanel?.querySelector('.settings-panel > div:last-child');
            if (settingsContent && settingsPanelContainer) {
                // Find the correct parent in the panel
                const panelParent = settingsPanel.querySelector('.settings-panel');
                if (panelParent && panelParent.children.length >= 2) {
                    // Insert after settings-header and settings-search-wrapper
                    panelParent.appendChild(settingsContent);
                }
            }

            // Hide settings page, show chat
            if (chatContainer) chatContainer.style.display = 'flex';
            if (settingsPage) settingsPage.style.display = 'none';

            // Remove overlay and blur effect
            if (overlay) overlay.classList.remove('active');

            // Update header
            if (menuBtn) menuBtn.style.display = 'flex';
            if (backBtn) backBtn.style.display = 'none';
            if (settingsBtn) settingsBtn.style.display = 'flex';
            if (appTitle) appTitle.textContent = 'AssistedVoice';

            // Update URL hash
            if (window.location.hash === '#/settings') {
                window.location.hash = '';
            }
        }
    }

    // Handle browser back/forward buttons
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash;
        if (hash === '#/settings') {
            navigateToView('settings');
        } else {
            navigateToView('chat');
        }
    });

    // Settings button - navigate to settings page
    if (settingsBtn) {
        const oldClickHandler = settingsBtn.onclick;
        settingsBtn.onclick = (e) => {
            e.preventDefault();
            navigateToView('settings');
        };
    }

    // Back button - navigate to chat
    if (backBtn) {
        backBtn.addEventListener('click', (e) => {
            e.preventDefault();
            navigateToView('chat');
        });
    }

    // Handle initial route on page load
    const initialHash = window.location.hash;
    if (initialHash === '#/settings') {
        navigateToView('settings');
    }

    // Export for use elsewhere
    window.navigateToView = navigateToView;
}

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

        // Sync AI settings from localStorage to backend
        syncAISettingsToBackend();
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

        // Show stop generation button
        if (!isGenerating) {
            isGenerating = true;
            showStopGenerationButton();
        }

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

        // Hide stop generation button
        isGenerating = false;
        hideStopGenerationButton();

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
        updateStatus(`Model changed to ${data.model}`, 'ready');

        // Update all displays using central function
        updateModelDisplay(data.model);
    });

    socket.on('tts_changed', (data) => {
        logResponse('tts_changed', data);
        updateStatus('Voice settings updated', 'ready');
    });

    socket.on('whisper_model_changed', (data) => {
        logResponse('whisper_model_changed', data);
        updateStatus(`Whisper model changed to ${data.model}`, 'ready');
    });

    socket.on('voice_preview', (data) => {
        logResponse('voice_preview', { hasAudio: !!data.audio });
        if (data.audio) {
            // Play the preview audio
            playAudioData(data.audio);
            showToast('Voice preview playing', 'success');
        }
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

    // Stop generation button
    const stopGenerationBtn = document.getElementById('stopGenerationBtn');
    if (stopGenerationBtn) {
        stopGenerationBtn.addEventListener('click', stopGeneration);
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

    // Search toggle button
    const searchToggleBtn = document.getElementById('searchToggleBtn');
    if (searchToggleBtn) {
        searchToggleBtn.addEventListener('click', () => {
            toggleConversationSearch();
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

    // Settings Search Functionality
    const settingsSearch = document.getElementById('settingsSearch');
    if (settingsSearch) {
        settingsSearch.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const settingsSections = document.querySelectorAll('.settings-section');

            settingsSections.forEach(section => {
                const sectionTitle = section.querySelector('.section-title')?.textContent.toLowerCase() || '';
                const settingItems = section.querySelectorAll('.setting-item');
                let sectionHasMatch = false;

                settingItems.forEach(item => {
                    const label = item.querySelector('label')?.textContent.toLowerCase() || '';
                    const hint = item.querySelector('.setting-hint')?.textContent.toLowerCase() || '';
                    const select = item.querySelector('select');
                    const selectText = select ? Array.from(select.options).map(opt => opt.textContent.toLowerCase()).join(' ') : '';

                    const matches = searchTerm === '' ||
                                  label.includes(searchTerm) ||
                                  hint.includes(searchTerm) ||
                                  sectionTitle.includes(searchTerm) ||
                                  selectText.includes(searchTerm);

                    if (matches) {
                        item.style.display = '';
                        sectionHasMatch = true;
                    } else {
                        item.style.display = 'none';
                    }
                });

                // Hide/show entire section based on matches
                if (sectionHasMatch || searchTerm === '') {
                    section.style.display = '';
                } else {
                    section.style.display = 'none';
                }
            });
        });

        // Clear search when settings panel closes
        document.getElementById('closeSettings')?.addEventListener('click', () => {
            settingsSearch.value = '';
            settingsSearch.dispatchEvent(new Event('input')); // Reset filter
        });
    }

    // Keyboard Shortcuts Modal
    const shortcutsModal = document.getElementById('shortcutsModal');
    const closeShortcuts = document.getElementById('closeShortcuts');

    function showShortcutsModal() {
        if (shortcutsModal) {
            shortcutsModal.classList.add('active');
            if (overlay) overlay.classList.add('active');
        }
    }

    function hideShortcutsModal() {
        if (shortcutsModal) {
            shortcutsModal.classList.remove('active');
            if (overlay) overlay.classList.remove('active');
        }
    }

    if (closeShortcuts) {
        closeShortcuts.addEventListener('click', hideShortcutsModal);
    }

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ignore if typing in input fields (except for specific shortcuts)
        const isTyping = document.activeElement.tagName === 'INPUT' ||
                        document.activeElement.tagName === 'TEXTAREA';

        // ? - Show keyboard shortcuts (works anywhere)
        if (e.key === '?' && !isTyping) {
            e.preventDefault();
            if (shortcutsModal.classList.contains('active')) {
                hideShortcutsModal();
            } else {
                showShortcutsModal();
            }
            return;
        }

        // Escape - Stop audio or close any open panel
        if (e.key === 'Escape') {
            e.preventDefault();

            // First priority: stop audio if playing
            if (currentAudio) {
                stopAudio();
                return;
            }

            // Second priority: hide conversation search if visible
            const searchWrapper = document.getElementById('conversationSearchWrapper');
            if (searchWrapper && searchWrapper.style.display === 'flex') {
                hideConversationSearch();
                return;
            }

            // Otherwise close panels
            const sideMenu = document.getElementById('sideMenu');
            const settingsPanel = document.getElementById('settingsPanel');

            if (shortcutsModal.classList.contains('active')) {
                hideShortcutsModal();
            } else if (settingsPanel?.classList.contains('active')) {
                settingsPanel.classList.remove('active');
                if (overlay) overlay.classList.remove('active');
            } else if (sideMenu?.classList.contains('active')) {
                sideMenu.classList.remove('active');
                if (overlay) overlay.classList.remove('active');
            }
            return;
        }

        // Don't process other shortcuts if typing
        if (isTyping && e.key !== 'Enter') return;

        // Ctrl/Cmd + K - Open settings
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            if (settingsBtn) settingsBtn.click();
            return;
        }

        // Ctrl/Cmd + F - Toggle search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            toggleConversationSearch();
            return;
        }

        // Ctrl/Cmd + M - Open menu
        if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
            e.preventDefault();
            if (menuBtn) menuBtn.click();
            return;
        }

        // Ctrl/Cmd + L - Clear chat
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            e.preventDefault();
            if (clearBtn) clearBtn.click();
            return;
        }

        // Ctrl/Cmd + R - Toggle recording
        if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
            e.preventDefault();
            if (voiceBtn) {
                if (isRecording) {
                    stopRecording();
                } else {
                    startRecording();
                }
            }
            return;
        }

        // Ctrl/Cmd + D - Toggle mute
        if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
            e.preventDefault();
            const muteBtn = document.getElementById('muteBtn');
            if (muteBtn) muteBtn.click();
            return;
        }

        // / - Focus input (when not already typing)
        if (e.key === '/' && !isTyping) {
            e.preventDefault();
            if (textInput) {
                textInput.focus();
            }
            return;
        }
    });

    // Settings Panel Event Listeners
    setupSettingsListeners();

    // Onboarding Tutorial (Feature 2.5)
    setupTutorial();

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

                // Update all displays using central function
                updateModelDisplay(model);
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

    // Speech Rate Slider
    const speechRateSlider = document.getElementById('speechRateSlider');
    const speechRateValue = document.getElementById('speechRateValue');
    let speechRateTimeout;
    if (speechRateSlider && speechRateValue) {
        // Load saved value
        const savedRate = parseFloat(localStorage.getItem('speechRate') || '1.0');
        speechRateSlider.value = savedRate;
        speechRateValue.textContent = savedRate.toFixed(1) + 'x';

        speechRateSlider.addEventListener('input', (e) => {
            const rate = parseFloat(e.target.value);
            speechRateValue.textContent = rate.toFixed(1) + 'x';
            localStorage.setItem('speechRate', rate.toString());

            // Debounced toast and socket emit
            clearTimeout(speechRateTimeout);
            speechRateTimeout = setTimeout(() => {
                showToast(`Speech rate set to ${rate.toFixed(1)}x`, 'success');
                // Emit to server if needed for real-time TTS updates
                const requestData = { rate: rate };
                logRequest('update_speech_rate', requestData);
                socket.emit('update_speech_rate', requestData);
            }, 500);
        });
    }

    // Voice Volume Slider
    const voiceVolumeSlider = document.getElementById('voiceVolumeSlider');
    const voiceVolumeValue = document.getElementById('voiceVolumeValue');
    let voiceVolumeTimeout;
    if (voiceVolumeSlider && voiceVolumeValue) {
        // Load saved value
        const savedVolume = parseInt(localStorage.getItem('voiceVolume') || '100');
        voiceVolumeSlider.value = savedVolume;
        voiceVolumeValue.textContent = savedVolume + '%';

        voiceVolumeSlider.addEventListener('input', (e) => {
            const volume = parseInt(e.target.value);
            voiceVolumeValue.textContent = volume + '%';
            localStorage.setItem('voiceVolume', volume.toString());

            // Apply volume to current and future audio elements
            document.querySelectorAll('audio').forEach(audio => {
                audio.volume = volume / 100;
            });

            // Debounced toast and socket emit
            clearTimeout(voiceVolumeTimeout);
            voiceVolumeTimeout = setTimeout(() => {
                showToast(`Voice volume set to ${volume}%`, 'success');
                const requestData = { volume: volume };
                logRequest('update_voice_volume', requestData);
                socket.emit('update_voice_volume', requestData);
            }, 500);
        });
    }

    // Voice Pitch Slider (Edge TTS only)
    const voicePitchSlider = document.getElementById('voicePitchSlider');
    const voicePitchValue = document.getElementById('voicePitchValue');
    const voicePitchSettingItem = document.getElementById('voicePitchSettingItem');
    let voicePitchTimeout;
    if (voicePitchSlider && voicePitchValue && voicePitchSettingItem) {
        // Load saved value
        const savedPitch = parseInt(localStorage.getItem('voicePitch') || '0');
        voicePitchSlider.value = savedPitch;
        voicePitchValue.textContent = (savedPitch >= 0 ? '+' : '') + savedPitch + 'Hz';

        // Show/hide based on current TTS engine
        const updatePitchVisibility = () => {
            const currentEngine = voiceSelect?.value || localStorage.getItem('ttsEngine') || 'edge-tts';
            if (currentEngine === 'edge-tts') {
                voicePitchSettingItem.style.display = '';
            } else {
                voicePitchSettingItem.style.display = 'none';
            }
        };
        updatePitchVisibility();

        voicePitchSlider.addEventListener('input', (e) => {
            const pitch = parseInt(e.target.value);
            voicePitchValue.textContent = (pitch >= 0 ? '+' : '') + pitch + 'Hz';
            localStorage.setItem('voicePitch', pitch.toString());

            // Debounced toast and socket emit
            clearTimeout(voicePitchTimeout);
            voicePitchTimeout = setTimeout(() => {
                showToast(`Voice pitch set to ${(pitch >= 0 ? '+' : '')}${pitch}Hz`, 'success');
                const pitchStr = (pitch >= 0 ? '+' : '') + pitch + 'Hz';
                const requestData = { pitch: pitchStr };
                logRequest('update_voice_pitch', requestData);
                socket.emit('update_voice_pitch', requestData);
            }, 500);
        });

        // Update visibility when TTS engine changes
        if (voiceSelect) {
            voiceSelect.addEventListener('change', updatePitchVisibility);
        }
    }

    // Edge Voice Selector
    const edgeVoiceSelect = document.getElementById('edgeVoiceSelect');
    const edgeVoiceSettingItem = document.getElementById('edgeVoiceSettingItem');
    if (edgeVoiceSelect && edgeVoiceSettingItem) {
        // Load saved voice
        const savedVoice = localStorage.getItem('edgeVoice') || 'en-US-JennyNeural';
        edgeVoiceSelect.value = savedVoice;

        // Show/hide based on current TTS engine
        const updateEdgeVoiceVisibility = () => {
            const currentEngine = voiceSelect?.value || localStorage.getItem('ttsEngine') || 'edge-tts';
            if (currentEngine === 'edge-tts') {
                edgeVoiceSettingItem.style.display = '';
            } else {
                edgeVoiceSettingItem.style.display = 'none';
            }
        };

        edgeVoiceSelect.addEventListener('change', (e) => {
            const voice = e.target.value;
            localStorage.setItem('edgeVoice', voice);
            showToast('Edge TTS voice changed', 'success');

            // Emit to server
            const requestData = { voice: voice };
            logRequest('update_edge_voice', requestData);
            socket.emit('update_edge_voice', requestData);
        });

        // Update visibility on load and when engine changes
        updateEdgeVoiceVisibility();
        if (voiceSelect) {
            voiceSelect.addEventListener('change', updateEdgeVoiceVisibility);
        }

        // Voice Search
        const voiceSearchInput = document.getElementById('voiceSearchInput');
        if (voiceSearchInput) {
            voiceSearchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                const options = edgeVoiceSelect.querySelectorAll('option');

                options.forEach(option => {
                    const text = option.textContent.toLowerCase();
                    const value = option.value.toLowerCase();
                    const matches = text.includes(searchTerm) || value.includes(searchTerm);
                    option.style.display = matches ? '' : 'none';
                });

                // Hide empty optgroups
                const optgroups = edgeVoiceSelect.querySelectorAll('optgroup');
                optgroups.forEach(group => {
                    const visibleOptions = Array.from(group.querySelectorAll('option')).filter(opt => opt.style.display !== 'none');
                    group.style.display = visibleOptions.length > 0 ? '' : 'none';
                });
            });
        }

        // Voice Preview
        const voicePreviewBtn = document.getElementById('voicePreviewBtn');
        if (voicePreviewBtn) {
            voicePreviewBtn.addEventListener('click', () => {
                const selectedVoice = edgeVoiceSelect.value;
                if (selectedVoice) {
                    const previewText = "Hello! This is a preview of this voice. How do I sound?";
                    showToast('Playing voice preview...', 'info');

                    // Request preview from server
                    const requestData = {
                        text: previewText,
                        voice: selectedVoice
                    };
                    logRequest('preview_voice', requestData);
                    socket.emit('preview_voice', requestData);
                }
            });
        }

        // Voice Favorites
        const voiceFavoriteBtn = document.getElementById('voiceFavoriteBtn');
        if (voiceFavoriteBtn) {
            // Load favorites
            let favorites = JSON.parse(localStorage.getItem('voiceFavorites') || '[]');

            // Update favorites optgroup
            function updateFavoritesOptgroup() {
                const favoritesGroup = edgeVoiceSelect.querySelector('optgroup[label="⭐ Favorites"]');
                if (favoritesGroup) {
                    favoritesGroup.innerHTML = '';
                    favorites.forEach(voiceValue => {
                        const originalOption = edgeVoiceSelect.querySelector(`option[value="${voiceValue}"]`);
                        if (originalOption && originalOption.parentElement.label !== '⭐ Favorites') {
                            const favOption = originalOption.cloneNode(true);
                            favoritesGroup.appendChild(favOption);
                        }
                    });
                }
            }

            // Update button state
            function updateFavoriteButtonState() {
                const selectedVoice = edgeVoiceSelect.value;
                if (favorites.includes(selectedVoice)) {
                    voiceFavoriteBtn.classList.add('active');
                    voiceFavoriteBtn.title = 'Remove from favorites';
                } else {
                    voiceFavoriteBtn.classList.remove('active');
                    voiceFavoriteBtn.title = 'Add to favorites';
                }
            }

            // Toggle favorite
            voiceFavoriteBtn.addEventListener('click', () => {
                const selectedVoice = edgeVoiceSelect.value;
                if (!selectedVoice) return;

                if (favorites.includes(selectedVoice)) {
                    // Remove from favorites
                    favorites = favorites.filter(v => v !== selectedVoice);
                    showToast('Removed from favorites', 'success');
                } else {
                    // Add to favorites
                    favorites.push(selectedVoice);
                    showToast('Added to favorites', 'success');
                }

                // Save and update
                localStorage.setItem('voiceFavorites', JSON.stringify(favorites));
                updateFavoritesOptgroup();
                updateFavoriteButtonState();
            });

            // Update on selection change
            edgeVoiceSelect.addEventListener('change', updateFavoriteButtonState);

            // Initialize
            updateFavoritesOptgroup();
            updateFavoriteButtonState();
        }
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

    // Progressive Settings Disclosure
    setupProgressiveSettings();

    // Conversation Search Feature
    setupConversationSearch();

    // Export Conversation Feature
    setupExportFeature();

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
            showToast(`Theme changed to ${theme}`, 'success');
        });
    });

    // Font size slider
    const fontSlider = document.getElementById('fontSlider');
    if (fontSlider) {
        let fontSizeTimeout;
        fontSlider.addEventListener('input', (e) => {
            const size = e.target.value;
            document.documentElement.style.fontSize = `${size}px`;
            localStorage.setItem('fontSize', size);

            // Debounce toast notification
            clearTimeout(fontSizeTimeout);
            fontSizeTimeout = setTimeout(() => {
                showToast(`Font size set to ${size}px`, 'success');
            }, 500);
        });
    }

    // Send on Enter checkbox
    const sendOnEnter = document.getElementById('sendOnEnter');
    if (sendOnEnter) {
        sendOnEnter.addEventListener('change', (e) => {
            localStorage.setItem('sendOnEnter', e.target.checked);
            showToast(`Send on Enter ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
        });
    }

    // Sound effects checkbox
    const soundEffects = document.getElementById('soundEffects');
    if (soundEffects) {
        soundEffects.addEventListener('change', (e) => {
            localStorage.setItem('soundEffects', e.target.checked);
            showToast(`Sound effects ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
        });
    }

    // Display Options - Show Timestamps
    const showTimestamps = document.getElementById('showTimestamps');
    if (showTimestamps) {
        const savedTimestamps = localStorage.getItem('showTimestamps');
        if (savedTimestamps === 'false') {
            showTimestamps.checked = false;
            document.body.classList.add('hide-timestamps');
        }

        showTimestamps.addEventListener('change', (e) => {
            localStorage.setItem('showTimestamps', e.target.checked);
            if (e.target.checked) {
                document.body.classList.remove('hide-timestamps');
                showToast('Timestamps shown', 'success');
            } else {
                document.body.classList.add('hide-timestamps');
                showToast('Timestamps hidden', 'success');
            }
        });
    }

    // Display Options - Show Metrics
    const showMetrics = document.getElementById('showMetrics');
    if (showMetrics) {
        const savedMetrics = localStorage.getItem('showMetrics');
        if (savedMetrics === 'false') {
            showMetrics.checked = false;
            document.body.classList.add('hide-metrics');
        }

        showMetrics.addEventListener('change', (e) => {
            localStorage.setItem('showMetrics', e.target.checked);
            if (e.target.checked) {
                document.body.classList.remove('hide-metrics');
                showToast('Performance metrics shown', 'success');
            } else {
                document.body.classList.add('hide-metrics');
                showToast('Performance metrics hidden', 'success');
            }
        });
    }

    // Display Options - Compact View
    const compactView = document.getElementById('compactView');
    if (compactView) {
        const savedCompact = localStorage.getItem('compactView');
        if (savedCompact === 'true') {
            compactView.checked = true;
            document.body.classList.add('compact-view');
        }

        compactView.addEventListener('change', (e) => {
            localStorage.setItem('compactView', e.target.checked);
            if (e.target.checked) {
                document.body.classList.add('compact-view');
                showToast('Compact view enabled', 'success');
            } else {
                document.body.classList.remove('compact-view');
                showToast('Normal view enabled', 'success');
            }
        });
    }

    // Display Options - Enable Animations
    const enableAnimations = document.getElementById('enableAnimations');
    if (enableAnimations) {
        const savedAnimations = localStorage.getItem('enableAnimations');
        if (savedAnimations === 'false') {
            enableAnimations.checked = false;
            document.body.classList.add('no-animations');
        }

        enableAnimations.addEventListener('change', (e) => {
            localStorage.setItem('enableAnimations', e.target.checked);
            if (e.target.checked) {
                document.body.classList.remove('no-animations');
                showToast('Animations enabled', 'success');
            } else {
                document.body.classList.add('no-animations');
                showToast('Animations disabled', 'success');
            }
        });
    }

    // Auto-scroll toggle
    const autoScrollCheckbox = document.getElementById('autoScroll');
    if (autoScrollCheckbox) {
        const savedAutoScroll = localStorage.getItem('autoScroll');
        if (savedAutoScroll === 'false') {
            autoScrollCheckbox.checked = false;
            window.autoScrollEnabled = false;
        } else {
            window.autoScrollEnabled = true;
        }

        autoScrollCheckbox.addEventListener('change', (e) => {
            window.autoScrollEnabled = e.target.checked;
            localStorage.setItem('autoScroll', e.target.checked);
            showToast(`Auto-scroll ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
        });
    }

    // Scroll to Bottom Button
    setupScrollToBottom();
}

/**
 * Setup scroll-to-bottom button
 */
function setupScrollToBottom() {
    const chatMessages = document.getElementById('chatMessages');
    const scrollBtn = document.getElementById('scrollToBottomBtn');

    if (!chatMessages || !scrollBtn) return;

    let userHasScrolledUp = false;

    // Show/hide button based on scroll position
    function updateScrollButton() {
        const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;

        if (!isNearBottom && !userHasScrolledUp) {
            userHasScrolledUp = true;
            scrollBtn.classList.add('show');
        } else if (isNearBottom && userHasScrolledUp) {
            userHasScrolledUp = false;
            scrollBtn.classList.remove('show');
        }
    }

    // Scroll detection
    chatMessages.addEventListener('scroll', updateScrollButton);

    // Click to scroll to bottom
    scrollBtn.addEventListener('click', () => {
        chatMessages.scrollTo({
            top: chatMessages.scrollHeight,
            behavior: 'smooth'
        });
        userHasScrolledUp = false;
        scrollBtn.classList.remove('show');
    });

    // Export function for use when adding messages
    window.scrollToBottomIfEnabled = function() {
        if (window.autoScrollEnabled !== false && !userHasScrolledUp) {
            chatMessages.scrollTo({
                top: chatMessages.scrollHeight,
                behavior: 'smooth'
            });
        }
    };
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

        // Initialize audio visualization (Feature 2.1)
        initAudioVisualization(audioStream);

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

    // Stop audio visualization (Feature 2.1)
    stopAudioVisualization();

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
 * Stop currently playing audio
 */
function stopAudio() {
    // Stop current audio if playing
    if (currentAudio) {
        console.log('Stopping audio playback');
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }

    // Clear any pending audio
    if (window.pendingAudio) {
        window.pendingAudio = null;
    }

    // Clear audio queue (future-proof)
    audioQueue = [];
    isPlayingAudio = false;

    // Remove speaking class from all messages
    document.querySelectorAll('.message.speaking').forEach(msg => {
        msg.classList.remove('speaking');
    });

    // Update status
    updateStatus('Ready', 'ready');

    // Show toast notification
    showToast('Audio playback stopped', 'info', 1500);
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

        // Stop any currently playing audio first
        if (currentAudio) {
            console.log('Stopping previous audio to play new response');
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio = null;
        }

        // Create and play audio directly - simple approach that works
        const audio = new Audio(audioDataUrl);

        // Mark as TTS audio for mini-player
        audio.dataset = audio.dataset || {};
        audio.dataset.ttsAudio = 'true';

        // Apply voice volume from settings
        const savedVolume = parseInt(localStorage.getItem('voiceVolume') || '100');
        audio.volume = savedVolume / 100;

        currentAudio = audio; // Track this audio element

        // Show mini-player
        if (typeof showMiniPlayer === 'function') {
            showMiniPlayer(audio, '');
        }

        // Clear reference when audio finishes
        audio.addEventListener('ended', () => {
            console.log('Audio playback ended');
            if (currentAudio === audio) {
                currentAudio = null;
                updateStatus('Ready', 'ready');

                // Hide mini-player
                if (typeof hideMiniPlayer === 'function') {
                    hideMiniPlayer();
                }
            }
        });

        // Clear reference on error
        audio.addEventListener('error', (e) => {
            console.error('Audio error:', e);
            if (currentAudio === audio) {
                currentAudio = null;
                updateStatus('Ready', 'ready');

                // Hide mini-player
                if (typeof hideMiniPlayer === 'function') {
                    hideMiniPlayer();
                }
            }
        });

        // Play the audio immediately
        audio.play().then(() => {
            console.log('Audio playing successfully');
            updateStatus('Playing audio...', 'ready');
        }).catch(err => {
            console.error('Audio playback error:', err);
            // Clear reference if play failed
            if (currentAudio === audio) {
                currentAudio = null;
            }

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
        // Clear reference if exception occurred
        if (currentAudio) {
            currentAudio = null;
        }
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
        // Read original text from data attribute first, fallback to textContent
        const text = messageContent?.getAttribute('data-original-text') || messageContent?.textContent || '';

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
    contentWrapper.className = 'message-wrapper';

    // Add message content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // Render markdown for assistant messages, plain text for user messages
    if (role === 'assistant') {
        contentDiv.innerHTML = renderMarkdown(text);
        // Add copy buttons to code blocks after rendering
        setTimeout(() => addCopyButtonsToCodeBlocks(contentDiv), 0);
    } else {
        contentDiv.textContent = text;
    }

    // Store original text for replay functionality
    contentDiv.setAttribute('data-original-text', text);

    // Add action buttons for assistant messages
    if (role === 'assistant') {
        const actionButtons = document.createElement('div');
        actionButtons.className = 'message-actions';
        actionButtons.innerHTML = `
            <button class="message-action-btn copy-btn" title="Copy message" aria-label="Copy message">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
            </button>
            <button class="message-action-btn regenerate-btn" title="Regenerate response" aria-label="Regenerate response">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="1 4 1 10 7 10"/>
                    <polyline points="23 20 23 14 17 14"/>
                    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                </svg>
            </button>
        `;

        // Add event listeners
        const copyBtn = actionButtons.querySelector('.copy-btn');
        const regenerateBtn = actionButtons.querySelector('.regenerate-btn');

        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(text);
                showToast('Message copied to clipboard!', 'success');
            } catch (err) {
                console.error('Failed to copy:', err);
                showToast('Failed to copy message', 'error');
            }
        });

        regenerateBtn.addEventListener('click', () => {
            // Find the previous user message
            const messages = Array.from(document.querySelectorAll('.message.user'));
            if (messages.length > 0) {
                const lastUserMessage = messages[messages.length - 1];
                const userText = lastUserMessage.querySelector('.message-content').textContent;

                // Send the message again
                if (socket) {
                    showToast('Regenerating response...', 'info');
                    const requestData = { text: userText, enable_tts: ttsEnabled };
                    socket.emit('process_text', requestData);
                }
            }
        });

        contentWrapper.appendChild(actionButtons);
    }

    // Add timestamp
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'message-time';
    const now = new Date();
    timestampDiv.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Add speaker button for assistant messages
    if (role === 'assistant') {
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

        // Add reactions to assistant messages (Phase 3 Feature 3.5)
        if (role === 'assistant') {
            const messageId = 'msg-' + Date.now() + '-' + Math.random();
            messageDiv.dataset.messageId = messageId;

            // Add reactions after a short delay to ensure DOM is ready
            setTimeout(() => {
                if (typeof addReactionButtons === 'function') {
                    addReactionButtons(messageDiv, messageId);
                }

                // Observe for virtual scrolling (Phase 3 Feature 3.3)
                if (typeof observeNewMessage === 'function') {
                    observeNewMessage(messageDiv);
                }
            }, 50);
        }

        // Play sound effect if enabled
        // Commented out: Sound effects not implemented, playSound function doesn't exist
        // const soundEnabled = localStorage.getItem('soundEffects') === 'true';
        // if (soundEnabled) {
        //     playSound(role === 'user' ? 'send' : 'receive');
        // }

        // Scroll to bottom if enabled
        if (typeof window.scrollToBottomIfEnabled === 'function') {
            setTimeout(() => window.scrollToBottomIfEnabled(), 100);
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
    currentResponseDiv.innerHTML = renderMarkdown(currentResponse);

    // Add copy buttons to any new code blocks
    addCopyButtonsToCodeBlocks(currentResponseDiv);

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
        // Render the complete response as markdown
        currentResponseDiv.innerHTML = renderMarkdown(fullText);

        // Add copy buttons to code blocks
        addCopyButtonsToCodeBlocks(currentResponseDiv);

        // Store original text for replay functionality
        currentResponseDiv.setAttribute('data-original-text', fullText);

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
                    ${timeStr} • ${currentModel}<br>
                    <span style="font-size: 11px; opacity: 0.7;">${totalSec}s total • ${firstSec}s first • ${tokensPerSecond} tokens/s</span>
                `;
            } else {
                const now = new Date();
                timestampDiv.innerHTML = `
                    ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${currentModel}
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
 * Enhanced error templates with actionable steps
 */
const errorTemplates = {
    microphone: {
        title: 'Microphone Access Denied',
        icon: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>`,
        getMessage: (details) => `Unable to access your microphone. ${details || 'Permission was denied.'}`,
        actions: [
            { label: 'Grant Permission', action: 'retry' },
            { label: 'Check Browser Settings', action: 'help', url: 'https://support.google.com/chrome/answer/2693767' }
        ]
    },
    model: {
        title: 'Model Error',
        icon: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
            <circle cx="12" cy="12" r="2" fill="currentColor"/>
        </svg>`,
        getMessage: (details) => `Failed to load or switch the AI model. ${details || 'The model may be unavailable.'}`,
        actions: [
            { label: 'Try Again', action: 'retry' },
            { label: 'Choose Different Model', action: 'openSettings' }
        ]
    },
    connection: {
        title: 'Connection Lost',
        icon: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
            <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <line x1="12" y1="20" x2="12.01" y2="20"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>`,
        getMessage: (details) => `Lost connection to the server. ${details || 'Attempting to reconnect...'}`,
        actions: [
            { label: 'Reconnect Now', action: 'reconnect' },
            { label: 'Check Server Status', action: 'checkServer' }
        ]
    },
    server: {
        title: 'Server Error',
        icon: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/>
            <line x1="6" y1="18" x2="6.01" y2="18"/>
            <path d="M12 8l4 4-4 4"/>
        </svg>`,
        getMessage: (details) => `The server encountered an error. ${details || 'Please try again.'}`,
        actions: [
            { label: 'Retry Request', action: 'retry' },
            { label: 'Clear Conversation', action: 'clearChat' }
        ]
    },
    general: {
        title: 'Error',
        icon: `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>`,
        getMessage: (details) => details || 'An unexpected error occurred.',
        actions: [
            { label: 'Try Again', action: 'retry' }
        ]
    }
};

/**
 * Show enhanced error message with actionable steps
 * @param {string} message - Error message or details
 * @param {string} type - Error type: 'microphone', 'model', 'connection', 'server', 'general'
 * @param {Function} retryCallback - Optional callback for retry action
 */
function showEnhancedError(message, type = 'general', retryCallback = null) {
    const template = errorTemplates[type] || errorTemplates.general;
    const messages = document.getElementById('messages');

    if (!messages) return;

    // Hide welcome if showing
    const welcome = document.getElementById('welcome');
    if (welcome) welcome.style.display = 'none';
    messages.classList.add('active');

    // Create error card
    const errorCard = document.createElement('div');
    errorCard.className = 'error-card';

    const actionsHTML = template.actions.map(action => {
        return `<button class="error-action-btn" data-action="${action.action}" ${action.url ? `data-url="${action.url}"` : ''}>${action.label}</button>`;
    }).join('');

    errorCard.innerHTML = `
        <div class="error-icon">${template.icon}</div>
        <div class="error-content">
            <h3 class="error-title">${template.title}</h3>
            <p class="error-message">${template.getMessage(message)}</p>
            <div class="error-actions">
                ${actionsHTML}
            </div>
        </div>
    `;

    // Add event listeners to action buttons
    errorCard.querySelectorAll('.error-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const url = btn.dataset.url;

            switch(action) {
                case 'retry':
                    if (retryCallback) retryCallback();
                    errorCard.remove();
                    break;
                case 'reconnect':
                    if (socket) {
                        socket.disconnect();
                        setTimeout(() => initializeWebSocket(), 500);
                    }
                    errorCard.remove();
                    break;
                case 'openSettings':
                    document.getElementById('settingsBtn')?.click();
                    errorCard.remove();
                    break;
                case 'clearChat':
                    if (confirm('Clear conversation history?')) {
                        clearChatDisplay();
                        errorCard.remove();
                    }
                    break;
                case 'checkServer':
                    showToast('Check if LM Studio or Ollama is running', 'info', 3000);
                    break;
                case 'help':
                    if (url) window.open(url, '_blank');
                    break;
            }
        });
    });

    messages.appendChild(errorCard);

    // Scroll to show error
    const chatContainer = document.getElementById('chatContainer');
    if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Also show toast for quick notification
    showToast(template.title, 'error', 3000);
}

/**
 * Show simple error message (legacy compatibility)
 */
function showError(message) {
    // Detect error type from message
    let type = 'general';
    if (message.toLowerCase().includes('microphone') || message.toLowerCase().includes('recording')) {
        type = 'microphone';
    } else if (message.toLowerCase().includes('model')) {
        type = 'model';
    } else if (message.toLowerCase().includes('connection') || message.toLowerCase().includes('disconnect')) {
        type = 'connection';
    } else if (message.toLowerCase().includes('server')) {
        type = 'server';
    }

    showEnhancedError(message, type);
}

/**
 * Show stop generation button
 */
function showStopGenerationButton() {
    const stopBtn = document.getElementById('stopGenerationBtn');
    if (stopBtn) {
        stopBtn.classList.add('show');
    }
}

/**
 * Hide stop generation button
 */
function hideStopGenerationButton() {
    const stopBtn = document.getElementById('stopGenerationBtn');
    if (stopBtn) {
        stopBtn.classList.remove('show');
    }
}

/**
 * Stop LLM response generation
 */
function stopGeneration() {
    if (socket && isGenerating) {
        socket.emit('stop_generation', {});
        isGenerating = false;
        hideStopGenerationButton();
        showToast('Stopped generation', 'info');

        // Complete whatever response we have so far
        if (currentResponse) {
            completeResponse(currentResponse);
        }
    }
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

            // Render markdown for assistant messages, plain text for user messages
            if (msg.role === 'assistant') {
                contentDiv.innerHTML = renderMarkdown(msg.content);
            } else {
                contentDiv.textContent = msg.content;
            }

            // Store original text for replay functionality
            contentDiv.setAttribute('data-original-text', msg.content);

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
 * Update model display in all locations
 * Ensures main page footer and settings dropdown stay synchronized
 * @param {string} modelName - The model name to display
 */
function updateModelDisplay(modelName) {
    if (!modelName) return;

    // Update JavaScript variable
    currentModel = modelName;

    // Update main page footer indicator
    const modelIndicator = document.getElementById('modelIndicator');
    if (modelIndicator) {
        modelIndicator.textContent = modelName;
    }

    // Update settings dropdown
    const modelSelect = document.getElementById('modelSelect');
    if (modelSelect) {
        modelSelect.value = modelName;
    }

    // Save to localStorage
    localStorage.setItem('selectedModel', modelName);

    console.log('Model display updated to:', modelName);
}

/**
 * Load available models
 */
async function loadModels() {
    try {
        const response = await fetch('/api/models');
        const data = await response.json();

        const modelSelect = document.getElementById('modelSelect');
        modelSelect.innerHTML = '';

        // Populate dropdown with available models
        data.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            modelSelect.appendChild(option);
        });

        // Use backend's current model as single source of truth
        const actualCurrentModel = data.current || (data.models.length > 0 ? data.models[0] : null);

        if (actualCurrentModel) {
            // Update all displays using central function
            updateModelDisplay(actualCurrentModel);
        }
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
 * Sync AI settings from localStorage to backend on connect
 * Ensures user's customized settings persist across page reloads and model switches
 */
function syncAISettingsToBackend() {
    if (!socket || !socket.connected) {
        console.log('Cannot sync AI settings: socket not connected');
        return;
    }

    console.log('Syncing AI settings from localStorage to backend...');

    // Send temperature
    const temp = localStorage.getItem('aiTemperature');
    if (temp) {
        const temperature = parseFloat(temp);
        socket.emit('update_temperature', { temperature });
        console.log(`Synced temperature: ${temperature}`);
    }

    // Send max tokens
    const maxTokens = localStorage.getItem('aiMaxTokens');
    if (maxTokens) {
        const max_tokens = parseInt(maxTokens);
        socket.emit('update_max_tokens', { max_tokens });
        console.log(`Synced max tokens: ${max_tokens}`);
    }

    // Send system prompt (CRITICAL: This fixes system prompt not persisting)
    const systemPrompt = localStorage.getItem('aiSystemPrompt');
    if (systemPrompt) {
        socket.emit('update_system_prompt', { system_prompt: systemPrompt });
        console.log(`Synced system prompt (${systemPrompt.length} chars)`);
    }

    console.log('AI settings sync complete');
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
        let tempDebounce;
        temperatureSlider.addEventListener('input', (e) => {
            const temp = e.target.value;
            temperatureValue.textContent = temp;
            localStorage.setItem('aiTemperature', temp);

            // Send to backend
            if (socket && socket.connected) {
                const requestData = { temperature: parseFloat(temp) };
                logRequest('update_temperature', requestData);
                socket.emit('update_temperature', requestData);

                // Debounced toast
                clearTimeout(tempDebounce);
                tempDebounce = setTimeout(() => {
                    showToast(`Temperature set to ${temp}`, 'success');
                }, 500);
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
                showToast(`Max tokens set to ${e.target.value}`, 'success');
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
                    showToast('System prompt updated', 'success');
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

// ============================================
// AUDIO LEVEL VISUALIZATION (Feature 2.1)
// ============================================

/**
 * Initialize audio visualization
 */
function initAudioVisualization(stream) {
    try {
        // Create AudioContext (with fallback for older browsers)
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            console.warn('AudioContext not supported');
            return;
        }

        audioContext = new AudioContextClass();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 64; // Small FFT for better performance
        analyser.smoothingTimeConstant = 0.8;

        // Connect microphone stream to analyser
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        // Get audio bar elements
        const visualizer = document.getElementById('audioVisualizer');
        if (visualizer) {
            audioBars = Array.from(visualizer.querySelectorAll('.audio-bar'));
            visualizer.style.display = 'flex';
        }

        // Start animation
        animateAudioBars();

    } catch (error) {
        console.error('Error initializing audio visualization:', error);
    }
}

/**
 * Animate audio bars based on frequency data
 */
function animateAudioBars() {
    if (!analyser || audioBars.length === 0) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    // Update each bar based on frequency data
    audioBars.forEach((bar, index) => {
        // Sample different frequency ranges for each bar
        const dataIndex = Math.floor((index / audioBars.length) * dataArray.length);
        const value = dataArray[dataIndex];

        // Scale value to height (6px to 24px)
        const height = Math.max(6, (value / 255) * 24);
        bar.style.height = `${height}px`;

        // Adjust opacity based on volume
        const opacity = 0.4 + (value / 255) * 0.6;
        bar.style.opacity = opacity;
    });

    // Continue animation at 60fps
    animationFrameId = requestAnimationFrame(animateAudioBars);
}

/**
 * Stop audio visualization
 */
function stopAudioVisualization() {
    // Cancel animation
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // Close audio context
    if (audioContext) {
        audioContext.close();
        audioContext = null;
        analyser = null;
    }

    // Hide visualizer
    const visualizer = document.getElementById('audioVisualizer');
    if (visualizer) {
        visualizer.style.display = 'none';
    }

    // Reset bars
    audioBars = [];
}

// ============================================
// PROGRESSIVE SETTINGS DISCLOSURE (Feature 2.4)
// ============================================

/**
 * Setup progressive settings disclosure
 */
function setupProgressiveSettings() {
    const basicModeBtn = document.getElementById('basicModeBtn');
    const advancedModeBtn = document.getElementById('advancedModeBtn');
    const settingsContent = document.querySelector('.settings-content');

    if (!basicModeBtn || !advancedModeBtn || !settingsContent) return;

    // One-time migration: upgrade users from basic to advanced mode
    if (localStorage.getItem('settingsMode') === 'basic') {
        localStorage.setItem('settingsMode', 'advanced');
    }

    // Load saved mode preference
    const savedMode = localStorage.getItem('settingsMode') || 'advanced';

    // Apply saved mode
    if (savedMode === 'advanced') {
        basicModeBtn.classList.remove('active');
        advancedModeBtn.classList.add('active');
        settingsContent.classList.add('show-advanced');
    } else {
        basicModeBtn.classList.add('active');
        advancedModeBtn.classList.remove('active');
        settingsContent.classList.remove('show-advanced');
    }

    // Basic mode button
    basicModeBtn.addEventListener('click', () => {
        basicModeBtn.classList.add('active');
        advancedModeBtn.classList.remove('active');
        settingsContent.classList.remove('show-advanced');
        localStorage.setItem('settingsMode', 'basic');
        showToast('Basic mode enabled', 'info');
    });

    // Advanced mode button
    advancedModeBtn.addEventListener('click', () => {
        basicModeBtn.classList.remove('active');
        advancedModeBtn.classList.add('active');
        settingsContent.classList.add('show-advanced');
        localStorage.setItem('settingsMode', 'advanced');
        showToast('Advanced mode enabled', 'info');
    });
}

// ============================================
// CONVERSATION SEARCH FEATURE (Feature 2.2)
// ============================================

let searchDebounceTimeout = null;

/**
 * Perform search in conversation
 */
function performConversationSearch(query) {
    const messageElements = document.querySelectorAll('#messages .message');
    const searchWrapper = document.getElementById('conversationSearchWrapper');
    const clearBtn = document.getElementById('clearSearchBtn');

    // Clear previous highlights
    messageElements.forEach(msgEl => {
        const contentEl = msgEl.querySelector('.message-content');
        if (contentEl) {
            // Remove existing highlights
            const highlightedElements = contentEl.querySelectorAll('mark.search-highlight');
            highlightedElements.forEach(mark => {
                const parent = mark.parentNode;
                parent.replaceChild(document.createTextNode(mark.textContent), mark);
                parent.normalize();
            });
        }
        msgEl.style.display = '';
    });

    // If query is empty, show all messages
    if (!query || query.trim() === '') {
        if (clearBtn) clearBtn.style.display = 'none';
        return;
    }

    // Show clear button
    if (clearBtn) clearBtn.style.display = 'flex';

    const queryLower = query.toLowerCase();
    let matchCount = 0;

    messageElements.forEach(msgEl => {
        const contentEl = msgEl.querySelector('.message-content');
        if (!contentEl) return;

        const originalText = contentEl.textContent;
        const textLower = originalText.toLowerCase();

        if (textLower.includes(queryLower)) {
            matchCount++;
            msgEl.style.display = '';

            // Highlight matches (case-insensitive)
            const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
            highlightText(contentEl, regex);
        } else {
            // Hide non-matching messages
            msgEl.style.display = 'none';
        }
    });

    // Show toast with match count
    if (matchCount > 0) {
        showToast(`Found ${matchCount} message${matchCount !== 1 ? 's' : ''}`, 'info');
    } else {
        showToast('No matches found', 'warning');
    }
}

/**
 * Escape special regex characters
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Highlight text in element
 */
function highlightText(element, regex) {
    const walk = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    const nodesToReplace = [];
    let node;

    while (node = walk.nextNode()) {
        if (node.nodeValue && regex.test(node.nodeValue)) {
            nodesToReplace.push(node);
        }
    }

    nodesToReplace.forEach(textNode => {
        const fragment = document.createDocumentFragment();
        const text = textNode.nodeValue;
        let lastIndex = 0;
        let match;

        // Reset regex
        regex.lastIndex = 0;

        while ((match = regex.exec(text)) !== null) {
            // Add text before match
            if (match.index > lastIndex) {
                fragment.appendChild(
                    document.createTextNode(text.substring(lastIndex, match.index))
                );
            }

            // Add highlighted match
            const mark = document.createElement('mark');
            mark.className = 'search-highlight';
            mark.textContent = match[0];
            fragment.appendChild(mark);

            lastIndex = match.index + match[0].length;
        }

        // Add remaining text
        if (lastIndex < text.length) {
            fragment.appendChild(
                document.createTextNode(text.substring(lastIndex))
            );
        }

        textNode.parentNode.replaceChild(fragment, textNode);
    });
}

/**
 * Clear conversation search
 */
function clearConversationSearch() {
    const searchInput = document.getElementById('conversationSearch');
    const clearBtn = document.getElementById('clearSearchBtn');

    if (searchInput) {
        searchInput.value = '';
    }
    if (clearBtn) {
        clearBtn.style.display = 'none';
    }

    // Clear all highlights and show all messages
    performConversationSearch('');
}

/**
 * Hide conversation search wrapper
 */
function hideConversationSearch() {
    const searchWrapper = document.getElementById('conversationSearchWrapper');
    if (searchWrapper) {
        searchWrapper.style.display = 'none';
    }
    // Also clear the search
    clearConversationSearch();
}

/**
 * Toggle conversation search visibility
 */
function toggleConversationSearch() {
    const searchWrapper = document.getElementById('conversationSearchWrapper');
    const searchInput = document.getElementById('conversationSearch');

    if (!searchWrapper) return;

    if (searchWrapper.style.display === 'none' || !searchWrapper.style.display) {
        // Show search
        searchWrapper.style.display = 'flex';
        // Focus the search input
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 100);
        }
    } else {
        // Hide search
        hideConversationSearch();
    }
}

/**
 * Setup conversation search feature
 */
function setupConversationSearch() {
    const searchInput = document.getElementById('conversationSearch');
    const clearBtn = document.getElementById('clearSearchBtn');
    const searchWrapper = document.getElementById('conversationSearchWrapper');

    if (!searchInput || !searchWrapper) return;

    // Search box is hidden by default, shown via toggle button
    // (Auto-show MutationObserver removed - now manual activation only)

    // Search input with debounce
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value;

        // Debounce search (300ms)
        clearTimeout(searchDebounceTimeout);
        searchDebounceTimeout = setTimeout(() => {
            performConversationSearch(query);
        }, 300);
    });

    // Clear button
    if (clearBtn) {
        clearBtn.addEventListener('click', clearConversationSearch);
    }

    // Close button - hides the entire search wrapper
    const closeBtn = document.getElementById('closeSearchBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', hideConversationSearch);
    }

    // Hide search wrapper on Escape key
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideConversationSearch();
        }
    });
}

// ============================================
// EXPORT CONVERSATION FEATURE (Feature 2.3)
// ============================================

/**
 * Get all messages for export
 */
function getMessagesForExport() {
    const messages = [];
    const messageElements = document.querySelectorAll('#messages .message');

    messageElements.forEach(msgEl => {
        const role = msgEl.classList.contains('user') ? 'user' : 'assistant';
        const contentEl = msgEl.querySelector('.message-content');
        const timestampEl = msgEl.querySelector('.message-time');

        if (contentEl) {
            messages.push({
                role: role,
                content: contentEl.textContent.trim(),
                timestamp: timestampEl ? timestampEl.textContent : new Date().toLocaleTimeString()
            });
        }
    });

    return messages;
}

/**
 * Generate filename with timestamp
 */
function generateFilename(extension) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    return `conversation-${year}-${month}-${day}-${hours}${minutes}.${extension}`;
}

/**
 * Download file using Blob API
 */
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Export conversation as Markdown
 */
function exportAsMarkdown() {
    const messages = getMessagesForExport();

    if (messages.length === 0) {
        showToast('No messages to export', 'warning');
        return;
    }

    let markdown = `# AssistedVoice Conversation\n\n`;
    markdown += `**Exported:** ${new Date().toLocaleString()}\n\n`;
    markdown += `**Model:** ${currentModel || 'Unknown'}\n\n`;
    markdown += `---\n\n`;

    messages.forEach((msg, index) => {
        const roleLabel = msg.role === 'user' ? 'You' : 'Assistant';
        markdown += `## ${roleLabel} (${msg.timestamp})\n\n`;
        markdown += `${msg.content}\n\n`;

        if (index < messages.length - 1) {
            markdown += `---\n\n`;
        }
    });

    const filename = generateFilename('md');
    downloadFile(markdown, filename, 'text/markdown');
    showToast(`Exported ${messages.length} messages as Markdown`, 'success');
    closeExportModal();
}

/**
 * Export conversation as JSON
 */
function exportAsJSON() {
    const messages = getMessagesForExport();

    if (messages.length === 0) {
        showToast('No messages to export', 'warning');
        return;
    }

    const exportData = {
        metadata: {
            exportDate: new Date().toISOString(),
            model: currentModel || 'Unknown',
            messageCount: messages.length
        },
        messages: messages
    };

    const json = JSON.stringify(exportData, null, 2);
    const filename = generateFilename('json');
    downloadFile(json, filename, 'application/json');
    showToast(`Exported ${messages.length} messages as JSON`, 'success');
    closeExportModal();
}

/**
 * Export conversation as Plain Text
 */
function exportAsPlainText() {
    const messages = getMessagesForExport();

    if (messages.length === 0) {
        showToast('No messages to export', 'warning');
        return;
    }

    let text = `AssistedVoice Conversation\n`;
    text += `Exported: ${new Date().toLocaleString()}\n`;
    text += `Model: ${currentModel || 'Unknown'}\n`;
    text += `\n${'='.repeat(60)}\n\n`;

    messages.forEach((msg, index) => {
        const roleLabel = msg.role === 'user' ? 'YOU' : 'ASSISTANT';
        text += `[${roleLabel}] ${msg.timestamp}\n`;
        text += `${msg.content}\n`;

        if (index < messages.length - 1) {
            text += `\n${'-'.repeat(60)}\n\n`;
        }
    });

    const filename = generateFilename('txt');
    downloadFile(text, filename, 'text/plain');
    showToast(`Exported ${messages.length} messages as Plain Text`, 'success');
    closeExportModal();
}

/**
 * Open export modal
 */
function openExportModal() {
    const modal = document.getElementById('exportModal');
    const overlay = document.getElementById('overlay');

    if (modal) {
        modal.style.display = 'flex';
    }
    if (overlay) {
        overlay.classList.add('show');
    }
}

/**
 * Close export modal
 */
function closeExportModal() {
    const modal = document.getElementById('exportModal');
    const overlay = document.getElementById('overlay');

    if (modal) {
        modal.style.display = 'none';
    }
    if (overlay) {
        overlay.classList.remove('show');
    }
}

/**
 * Setup export conversation feature
 */
function setupExportFeature() {
    // Export button in menu
    const exportBtn = document.getElementById('exportChatBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            openExportModal();
        });
    }

    // Close modal button
    const closeBtn = document.getElementById('closeExportModal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeExportModal);
    }

    // Export format buttons
    const markdownBtn = document.getElementById('exportMarkdownBtn');
    const jsonBtn = document.getElementById('exportJSONBtn');
    const plainTextBtn = document.getElementById('exportPlainTextBtn');

    if (markdownBtn) {
        markdownBtn.addEventListener('click', exportAsMarkdown);
    }
    if (jsonBtn) {
        jsonBtn.addEventListener('click', exportAsJSON);
    }
    if (plainTextBtn) {
        plainTextBtn.addEventListener('click', exportAsPlainText);
    }

    // Close modal when clicking overlay (only if export modal is open)
    const overlay = document.getElementById('overlay');
    if (overlay) {
        overlay.addEventListener('click', () => {
            const exportModal = document.getElementById('exportModal');
            if (exportModal && exportModal.style.display === 'flex') {
                closeExportModal();
            }
        });
    }

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('exportModal');
            if (modal && modal.style.display === 'flex') {
                closeExportModal();
            }
        }
    });
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
// ============================================
// PHASE 3: Advanced Features Implementation
// ============================================

// ============================================
// Feature 3.5: Message Reactions/Ratings
// ============================================

/**
 * Initialize message reactions system
 */
function initializeMessageReactions() {
    // Load reactions from localStorage
    const reactions = JSON.parse(localStorage.getItem('messageReactions') || '{}');
    return reactions;
}

/**
 * Save reaction to localStorage
 */
function saveReaction(messageId, reactionType) {
    const reactions = initializeMessageReactions();

    if (!reactions[messageId]) {
        reactions[messageId] = { thumbsUp: 0, thumbsDown: 0 };
    }

    // Toggle reaction
    if (reactionType === 'thumbsUp') {
        reactions[messageId].thumbsUp = reactions[messageId].thumbsUp === 1 ? 0 : 1;
        reactions[messageId].thumbsDown = 0; // Clear opposite reaction
    } else if (reactionType === 'thumbsDown') {
        reactions[messageId].thumbsDown = reactions[messageId].thumbsDown === 1 ? 0 : 1;
        reactions[messageId].thumbsUp = 0; // Clear opposite reaction
    }

    localStorage.setItem('messageReactions', JSON.stringify(reactions));
    return reactions[messageId];
}

/**
 * Add reaction buttons to assistant messages
 */
function addReactionButtons(messageElement, messageId) {
    // Only add to assistant messages
    if (!messageElement.classList.contains('assistant')) {
        return;
    }

    // Check if reactions already exist
    if (messageElement.querySelector('.message-reactions')) {
        return;
    }

    const reactions = initializeMessageReactions();
    const messageReaction = reactions[messageId] || { thumbsUp: 0, thumbsDown: 0 };

    const reactionContainer = document.createElement('div');
    reactionContainer.className = 'message-reactions';
    reactionContainer.innerHTML = `
        <button class="reaction-btn thumbs-up ` + (messageReaction.thumbsUp ? 'active' : '') + `" data-reaction="thumbsUp" title="Helpful">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
            </svg>
            ` + (messageReaction.thumbsUp > 0 ? `<span class="reaction-count">` + messageReaction.thumbsUp + `</span>` : '') + `
        </button>
        <button class="reaction-btn thumbs-down ` + (messageReaction.thumbsDown ? 'active' : '') + `" data-reaction="thumbsDown" title="Not helpful">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
            </svg>
            ` + (messageReaction.thumbsDown > 0 ? `<span class="reaction-count">` + messageReaction.thumbsDown + `</span>` : '') + `
        </button>
    `;

    // Add click handlers
    const thumbsUpBtn = reactionContainer.querySelector('.thumbs-up');
    const thumbsDownBtn = reactionContainer.querySelector('.thumbs-down');

    thumbsUpBtn.addEventListener('click', () => handleReactionClick(messageId, 'thumbsUp', thumbsUpBtn, thumbsDownBtn));
    thumbsDownBtn.addEventListener('click', () => handleReactionClick(messageId, 'thumbsDown', thumbsUpBtn, thumbsDownBtn));

    // Insert before message-time
    const messageContent = messageElement.querySelector('.message-content');
    if (messageContent) {
        messageContent.appendChild(reactionContainer);
    }
}

/**
 * Handle reaction button click
 */
function handleReactionClick(messageId, reactionType, thumbsUpBtn, thumbsDownBtn) {
    const newReaction = saveReaction(messageId, reactionType);

    // Update UI with animation
    const clickedBtn = reactionType === 'thumbsUp' ? thumbsUpBtn : thumbsDownBtn;
    const otherBtn = reactionType === 'thumbsUp' ? thumbsDownBtn : thumbsUpBtn;

    // Animate click
    clickedBtn.style.transform = 'scale(1.2)';
    setTimeout(() => {
        clickedBtn.style.transform = 'scale(1)';
    }, 200);

    // Update active states
    if (newReaction.thumbsUp === 1) {
        thumbsUpBtn.classList.add('active');
        thumbsDownBtn.classList.remove('active');
    } else if (newReaction.thumbsDown === 1) {
        thumbsDownBtn.classList.add('active');
        thumbsUpBtn.classList.remove('active');
    } else {
        thumbsUpBtn.classList.remove('active');
        thumbsDownBtn.classList.remove('active');
    }

    // Update counts
    updateReactionCount(thumbsUpBtn, newReaction.thumbsUp);
    updateReactionCount(thumbsDownBtn, newReaction.thumbsDown);

    // Optional: Send analytics to backend (future enhancement)
    console.log('Reaction saved: ' + messageId + ' - ' + reactionType, newReaction);
}

/**
 * Update reaction count display
 */
function updateReactionCount(button, count) {
    let countSpan = button.querySelector('.reaction-count');

    if (count > 0) {
        if (!countSpan) {
            countSpan = document.createElement('span');
            countSpan.className = 'reaction-count';
            button.appendChild(countSpan);
        }
        countSpan.textContent = count;
    } else {
        if (countSpan) {
            countSpan.remove();
        }
    }
}

// ============================================
// Feature 3.4: Mobile Swipe Gestures
// ============================================

let swipeIndicator = null;

/**
 * Initialize swipe gestures for mobile
 */
function initializeSwipeGestures() {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let currentTouchedElement = null;
    let longPressTimeout = null;

    messagesContainer.addEventListener('touchstart', (e) => {
        const messageElement = e.target.closest('.message');
        if (!messageElement) return;

        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
        currentTouchedElement = messageElement;

        // Long-press detection
        longPressTimeout = setTimeout(() => {
            showMessageContextMenu(messageElement, e.touches[0].clientX, e.touches[0].clientY);
            vibrate(50);
        }, 500);
    });

    messagesContainer.addEventListener('touchmove', (e) => {
        if (!currentTouchedElement) return;

        clearTimeout(longPressTimeout);

        const touchX = e.touches[0].clientX;
        const touchY = e.touches[0].clientY;
        const deltaX = touchX - touchStartX;
        const deltaY = touchY - touchStartY;

        // Ignore vertical scrolling
        if (Math.abs(deltaY) > Math.abs(deltaX)) {
            return;
        }

        // Prevent page scroll during horizontal swipe
        if (Math.abs(deltaX) > 10) {
            e.preventDefault();
        }

        // Show swipe indicator
        if (Math.abs(deltaX) > 30) {
            showSwipeIndicator(currentTouchedElement, deltaX);
        }

        // Apply transform
        currentTouchedElement.style.transform = 'translateX(' + deltaX + 'px)';
        currentTouchedElement.style.transition = 'none';
    });

    messagesContainer.addEventListener('touchend', (e) => {
        clearTimeout(longPressTimeout);

        if (!currentTouchedElement) return;

        const touchX = e.changedTouches[0].clientX;
        const deltaX = touchX - touchStartX;
        const touchDuration = Date.now() - touchStartTime;

        // Reset transform with animation
        currentTouchedElement.style.transition = 'transform 0.3s ease';
        currentTouchedElement.style.transform = 'translateX(0)';

        // Handle swipe actions
        if (Math.abs(deltaX) > 100 && touchDuration < 500) {
            if (deltaX < 0) {
                // Swipe left: Delete confirmation
                handleSwipeDelete(currentTouchedElement);
                vibrate(10);
            } else {
                // Swipe right: Copy to clipboard
                handleSwipeCopy(currentTouchedElement);
                vibrate(10);
            }
        }

        // Hide swipe indicator
        hideSwipeIndicator();

        setTimeout(() => {
            if (currentTouchedElement) {
                currentTouchedElement.style.transition = '';
            }
        }, 300);

        currentTouchedElement = null;
    });

    messagesContainer.addEventListener('touchcancel', () => {
        clearTimeout(longPressTimeout);
        hideSwipeIndicator();
        if (currentTouchedElement) {
            currentTouchedElement.style.transition = 'transform 0.3s ease';
            currentTouchedElement.style.transform = 'translateX(0)';
            currentTouchedElement = null;
        }
    });
}

/**
 * Show swipe indicator
 */
function showSwipeIndicator(messageElement, deltaX) {
    if (!swipeIndicator) {
        swipeIndicator = document.createElement('div');
        swipeIndicator.className = 'swipe-indicator';
        document.body.appendChild(swipeIndicator);
    }

    const rect = messageElement.getBoundingClientRect();
    swipeIndicator.style.top = (rect.top + rect.height / 2 - 20) + 'px';

    if (deltaX < 0) {
        // Left swipe - delete
        swipeIndicator.style.left = (rect.right - 60) + 'px';
        swipeIndicator.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff3b30" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        swipeIndicator.style.background = 'rgba(255, 59, 48, 0.2)';
    } else {
        // Right swipe - copy
        swipeIndicator.style.left = (rect.left + 20) + 'px';
        swipeIndicator.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#007aff" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        swipeIndicator.style.background = 'rgba(0, 122, 255, 0.2)';
    }

    swipeIndicator.classList.add('show');
}

/**
 * Hide swipe indicator
 */
function hideSwipeIndicator() {
    if (swipeIndicator) {
        swipeIndicator.classList.remove('show');
    }
}

/**
 * Handle swipe delete action
 */
function handleSwipeDelete(messageElement) {
    const messageText = messageElement.querySelector('.message-content')?.textContent || '';
    const preview = messageText.substring(0, 50) + (messageText.length > 50 ? '...' : '');

    if (confirm('Delete message: "' + preview + '"?')) {
        messageElement.style.opacity = '0';
        messageElement.style.transform = 'translateX(-100%)';
        setTimeout(() => {
            messageElement.remove();
            showToast('Message deleted', 'success');
        }, 300);
    }
}

/**
 * Handle swipe copy action
 */
function handleSwipeCopy(messageElement) {
    const messageText = messageElement.querySelector('.message-content')?.textContent || '';

    navigator.clipboard.writeText(messageText).then(() => {
        showToast('Copied to clipboard', 'success');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
}

/**
 * Show context menu for message
 */
function showMessageContextMenu(messageElement, x, y) {
    const messageText = messageElement.querySelector('.message-content')?.textContent || '';

    // Remove existing context menu
    const existingMenu = document.querySelector('.message-context-menu');
    if (existingMenu) {
        existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'message-context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.innerHTML = `
        <button class="context-menu-item" data-action="copy">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy
        </button>
        <button class="context-menu-item" data-action="delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Delete
        </button>
    `;

    document.body.appendChild(menu);

    // Position adjustment to keep on screen
    setTimeout(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
        }
    }, 0);

    // Handle menu actions
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;

            if (action === 'copy') {
                navigator.clipboard.writeText(messageText).then(() => {
                    showToast('Copied to clipboard', 'success');
                });
            } else if (action === 'delete') {
                handleSwipeDelete(messageElement);
            }

            menu.remove();
        });
    });

    // Close menu on outside click
    setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        });
    }, 100);
}

/**
 * Vibrate device (if supported)
 */
function vibrate(duration) {
    if (navigator.vibrate) {
        navigator.vibrate(duration);
    }
}

// ============================================
// Feature 3.2: Advanced Audio Controls
// ============================================

let miniPlayerVisible = false;
let miniPlayerAudio = null;
let playbackSpeed = 1.0;

/**
 * Show mini-player during TTS playback
 */
function showMiniPlayer(audioElement, messageText) {
    miniPlayerAudio = audioElement;

    let miniPlayer = document.getElementById('miniPlayer');

    if (!miniPlayer) {
        miniPlayer = document.createElement('div');
        miniPlayer.id = 'miniPlayer';
        miniPlayer.className = 'mini-player';
        miniPlayer.innerHTML = `
            <div class="mini-player-header">
                <span class="mini-player-title">Now Playing</span>
                <button class="mini-player-close" title="Close">✕</button>
            </div>
            <div class="mini-player-controls">
                <button class="mini-player-btn skip-backward" title="Skip backward 5s">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="11 19 2 12 11 5 11 19"/>
                        <polygon points="22 19 13 12 22 5 22 19"/>
                    </svg>
                    <span class="skip-label">5s</span>
                </button>
                <button class="mini-player-btn play-pause" title="Play/Pause">
                    <svg class="play-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    <svg class="pause-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
                        <rect x="6" y="4" width="4" height="16"/>
                        <rect x="14" y="4" width="4" height="16"/>
                    </svg>
                </button>
                <button class="mini-player-btn skip-forward" title="Skip forward 5s">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="13 19 22 12 13 5 13 19"/>
                        <polygon points="2 19 11 12 2 5 2 19"/>
                    </svg>
                    <span class="skip-label">5s</span>
                </button>
                <select class="mini-player-speed" title="Playback speed">
                    <option value="0.5">0.5x</option>
                    <option value="0.75">0.75x</option>
                    <option value="1" selected>1x</option>
                    <option value="1.25">1.25x</option>
                    <option value="1.5">1.5x</option>
                    <option value="2">2x</option>
                </select>
            </div>
            <div class="mini-player-progress-container">
                <input type="range" class="mini-player-progress" min="0" max="100" value="0" step="0.1">
                <div class="mini-player-time">
                    <span class="current-time">0:00</span>
                    <span class="duration">0:00</span>
                </div>
            </div>
        `;
        document.body.appendChild(miniPlayer);

        // Event listeners
        setupMiniPlayerControls(miniPlayer);
    }

    // Reset and show
    miniPlayer.querySelector('.mini-player-progress').value = 0;
    miniPlayer.querySelector('.current-time').textContent = '0:00';
    miniPlayer.classList.add('show');
    miniPlayerVisible = true;

    // Update duration when metadata loads
    audioElement.addEventListener('loadedmetadata', () => {
        const duration = formatTime(audioElement.duration);
        miniPlayer.querySelector('.duration').textContent = duration;
        miniPlayer.querySelector('.mini-player-progress').max = audioElement.duration;
    });

    // Update progress
    audioElement.addEventListener('timeupdate', () => {
        if (!miniPlayerVisible) return;

        const currentTime = audioElement.currentTime;
        const duration = audioElement.duration;

        miniPlayer.querySelector('.mini-player-progress').value = currentTime;
        miniPlayer.querySelector('.current-time').textContent = formatTime(currentTime);

        // Update play/pause icon
        const playIcon = miniPlayer.querySelector('.play-icon');
        const pauseIcon = miniPlayer.querySelector('.pause-icon');
        if (audioElement.paused) {
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
        } else {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
        }
    });

    // Hide when ended
    audioElement.addEventListener('ended', () => {
        hideMiniPlayer();
    });
}

/**
 * Hide mini-player
 */
function hideMiniPlayer() {
    const miniPlayer = document.getElementById('miniPlayer');
    if (miniPlayer) {
        miniPlayer.classList.remove('show');
    }
    miniPlayerVisible = false;
    miniPlayerAudio = null;
}

/**
 * Setup mini-player controls
 */
function setupMiniPlayerControls(miniPlayer) {
    // Play/Pause
    miniPlayer.querySelector('.play-pause').addEventListener('click', () => {
        if (miniPlayerAudio) {
            if (miniPlayerAudio.paused) {
                miniPlayerAudio.play();
            } else {
                miniPlayerAudio.pause();
            }
        }
    });

    // Skip backward
    miniPlayer.querySelector('.skip-backward').addEventListener('click', () => {
        if (miniPlayerAudio) {
            miniPlayerAudio.currentTime = Math.max(0, miniPlayerAudio.currentTime - 5);
        }
    });

    // Skip forward
    miniPlayer.querySelector('.skip-forward').addEventListener('click', () => {
        if (miniPlayerAudio) {
            miniPlayerAudio.currentTime = Math.min(miniPlayerAudio.duration, miniPlayerAudio.currentTime + 5);
        }
    });

    // Playback speed
    miniPlayer.querySelector('.mini-player-speed').addEventListener('change', (e) => {
        playbackSpeed = parseFloat(e.target.value);
        if (miniPlayerAudio) {
            miniPlayerAudio.playbackRate = playbackSpeed;
        }
    });

    // Progress bar
    miniPlayer.querySelector('.mini-player-progress').addEventListener('input', (e) => {
        if (miniPlayerAudio) {
            miniPlayerAudio.currentTime = parseFloat(e.target.value);
        }
    });

    // Close button
    miniPlayer.querySelector('.mini-player-close').addEventListener('click', () => {
        if (miniPlayerAudio) {
            miniPlayerAudio.pause();
        }
        hideMiniPlayer();
    });
}

/**
 * Format time in mm:ss
 */
function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins + ':' + secs.toString().padStart(2, '0');
}

// ============================================
// Feature 3.1: VAD Visualization
// ============================================

/**
 * Initialize VAD status indicator
 */
function initializeVADVisualization() {
    const voiceBtn = document.getElementById('voiceBtn');
    if (!voiceBtn) return;

    // Create VAD status badge
    const vadBadge = document.createElement('div');
    vadBadge.id = 'vadStatusBadge';
    vadBadge.className = 'vad-status-badge';
    vadBadge.innerHTML = '<span class="vad-dot"></span>';
    voiceBtn.parentElement.insertBefore(vadBadge, voiceBtn);

    // Listen for VAD events from backend
    if (socket) {
        socket.on('vad_listening', () => {
            updateVADStatus('listening');
        });

        socket.on('vad_speech_detected', () => {
            updateVADStatus('speech');
        });

        socket.on('vad_silence_detected', () => {
            updateVADStatus('silence');
        });
    }
}

/**
 * Update VAD status display
 */
function updateVADStatus(status) {
    const vadBadge = document.getElementById('vadStatusBadge');
    if (!vadBadge) return;

    // Remove all status classes
    vadBadge.classList.remove('listening', 'speech', 'silence');

    // Add new status
    vadBadge.classList.add(status);

    // Update tooltip
    const tooltips = {
        listening: 'Listening...',
        speech: 'Speech detected',
        silence: 'Silence detected'
    };
    vadBadge.title = tooltips[status] || '';
}

// ============================================
// Feature 3.3: Virtual Scrolling
// ============================================

let virtualScrollEnabled = false;
let visibleMessages = new Set();
let intersectionObserver = null;

/**
 * Initialize virtual scrolling for performance
 */
function initializeVirtualScrolling() {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;

    // Check if we need virtual scrolling (50+ messages)
    const checkVirtualScrollNeed = () => {
        const messageCount = messagesContainer.children.length;
        if (messageCount >= 50 && !virtualScrollEnabled) {
            enableVirtualScrolling();
        } else if (messageCount < 50 && virtualScrollEnabled) {
            disableVirtualScrolling();
        }
    };

    // Create intersection observer
    intersectionObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const messageId = entry.target.dataset.messageId;

            if (entry.isIntersecting) {
                visibleMessages.add(messageId);
                renderMessage(entry.target);
            } else {
                visibleMessages.delete(messageId);
                unrenderMessage(entry.target);
            }
        });
    }, {
        root: messagesContainer.parentElement, // chat-container
        rootMargin: '400px 0px', // Buffer zone
        threshold: 0
    });

    // Check on message additions
    const observer = new MutationObserver(() => {
        checkVirtualScrollNeed();
    });

    observer.observe(messagesContainer, { childList: true });

    // Initial check
    checkVirtualScrollNeed();
}

/**
 * Enable virtual scrolling
 */
function enableVirtualScrolling() {
    virtualScrollEnabled = true;
    console.log('Virtual scrolling enabled');

    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;

    // Observe all messages
    Array.from(messagesContainer.children).forEach((message, index) => {
        if (!message.dataset.messageId) {
            message.dataset.messageId = 'msg-' + Date.now() + '-' + index;
        }

        // Store original content
        if (!message.dataset.originalContent) {
            message.dataset.originalContent = message.innerHTML;
        }

        intersectionObserver.observe(message);
    });
}

/**
 * Disable virtual scrolling
 */
function disableVirtualScrolling() {
    virtualScrollEnabled = false;
    console.log('Virtual scrolling disabled');

    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer || !intersectionObserver) return;

    // Restore all messages
    Array.from(messagesContainer.children).forEach(message => {
        intersectionObserver.unobserve(message);
        renderMessage(message);
    });
}

/**
 * Render message content
 */
function renderMessage(messageElement) {
    if (!messageElement.dataset.originalContent) return;

    // Only restore if currently showing placeholder
    if (messageElement.classList.contains('virtual-placeholder')) {
        messageElement.innerHTML = messageElement.dataset.originalContent;
        messageElement.classList.remove('virtual-placeholder');
    }
}

/**
 * Unrender message (replace with placeholder)
 */
function unrenderMessage(messageElement) {
    if (!virtualScrollEnabled) return;

    // Store content if not already stored
    if (!messageElement.dataset.originalContent) {
        messageElement.dataset.originalContent = messageElement.innerHTML;
    }

    // Get message height
    const height = messageElement.offsetHeight;

    // Replace with placeholder
    messageElement.innerHTML = '<div style="height: ' + height + 'px;"></div>';
    messageElement.classList.add('virtual-placeholder');
}

/**
 * Observe new message for virtual scrolling
 */
function observeNewMessage(messageElement) {
    if (!virtualScrollEnabled || !intersectionObserver) return;

    // Assign ID if not present
    if (!messageElement.dataset.messageId) {
        messageElement.dataset.messageId = 'msg-' + Date.now() + '-' + Math.random();
    }

    // Store original content
    messageElement.dataset.originalContent = messageElement.innerHTML;

    // Observe
    intersectionObserver.observe(messageElement);
}

// ============================================
// Initialization on DOM ready
// ============================================

// Wait for DOM to be ready before initializing Phase 3 features
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePhase3Features);
} else {
    // DOM already loaded
    initializePhase3Features();
}

function initializePhase3Features() {
    console.log('Initializing Phase 3 Advanced Features...');

    // Feature 3.5: Message Reactions
    initializeMessageReactions();

    // Feature 3.4: Mobile Swipe Gestures
    initializeSwipeGestures();

    // Feature 3.2: Advanced Audio Controls (initialized when audio plays)

    // Feature 3.1: VAD Visualization
    setTimeout(() => {
        initializeVADVisualization();
    }, 500); // Wait for socket to be ready

    // Feature 3.3: Virtual Scrolling
    initializeVirtualScrolling();

    console.log('Phase 3 Advanced Features initialized');
}

// ============================================
// ONBOARDING TUTORIAL (Feature 2.5)
// ============================================

const tutorialSteps = [
    {
        title: 'Welcome to AssistedVoice!',
        description: 'This quick tour will show you how to use your AI voice assistant.',
        target: null
    },
    {
        title: 'Voice Button',
        description: 'Click and hold this button to record your voice. Release to send your message to the AI.',
        target: '#voiceBtn'
    },
    {
        title: 'Text Input',
        description: 'You can also type messages here if you prefer. Press Enter or click the send button.',
        target: '#textInput'
    },
    {
        title: 'Settings',
        description: 'Click here to access settings where you can change models, voice options, and more.',
        target: '#settingsBtn'
    },
    {
        title: 'Model Selection',
        description: 'Choose from different AI models on the welcome screen. Each has different capabilities!',
        target: '.model-grid'
    },
    {
        title: 'All Set!',
        description: 'You\'re ready to start! Select a model to begin your conversation. You can replay this tutorial anytime from settings.',
        target: null
    }
];

let currentTutorialStep = 0;

function startTutorial() {
    currentTutorialStep = 0;
    showTutorialStep(0);
}

function showTutorialStep(stepIndex) {
    const overlay = document.getElementById('tutorialOverlay');
    const spotlight = document.getElementById('tutorialSpotlight');
    const content = document.getElementById('tutorialContent');
    const stepCounter = document.getElementById('tutorialStepCounter');
    const title = document.getElementById('tutorialTitle');
    const description = document.getElementById('tutorialDescription');
    const nextBtn = document.getElementById('tutorialNext');

    if (!overlay || stepIndex >= tutorialSteps.length) {
        closeTutorial();
        return;
    }

    const step = tutorialSteps[stepIndex];
    currentTutorialStep = stepIndex;

    stepCounter.textContent = `Step ${stepIndex + 1} of ${tutorialSteps.length}`;
    title.textContent = step.title;
    description.textContent = step.description;

    if (stepIndex === tutorialSteps.length - 1) {
        nextBtn.textContent = 'Get Started';
    } else {
        nextBtn.textContent = 'Next';
    }

    overlay.style.display = 'block';

    if (step.target) {
        const targetElement = document.querySelector(step.target);
        if (targetElement) {
            const rect = targetElement.getBoundingClientRect();
            spotlight.style.top = `${rect.top - 8}px`;
            spotlight.style.left = `${rect.left - 8}px`;
            spotlight.style.width = `${rect.width + 16}px`;
            spotlight.style.height = `${rect.height + 16}px`;
            spotlight.style.display = 'block';
            targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    } else {
        spotlight.style.display = 'none';
    }
}

function nextTutorialStep() {
    if (currentTutorialStep < tutorialSteps.length - 1) {
        showTutorialStep(currentTutorialStep + 1);
    } else {
        closeTutorial();
    }
}

function closeTutorial() {
    const overlay = document.getElementById('tutorialOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
    localStorage.setItem('hasSeenTutorial', 'true');
}

function setupTutorial() {
    const nextBtn = document.getElementById('tutorialNext');
    const skipBtn = document.getElementById('tutorialSkip');

    if (nextBtn) {
        nextBtn.addEventListener('click', nextTutorialStep);
    }

    if (skipBtn) {
        skipBtn.addEventListener('click', closeTutorial);
    }

    const hasSeenTutorial = localStorage.getItem('hasSeenTutorial');
    if (!hasSeenTutorial) {
        setTimeout(() => {
            startTutorial();
        }, 1000);
    }
}
