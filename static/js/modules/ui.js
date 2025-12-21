/**
 * UI handling module for AssistedVoice
 */
import { state } from './state.js';
import {
    logRequest,
    renderMarkdown,
    addCopyButtonsToCodeBlocks,
    showToast
} from './utils.js';
import {
    startRecording,
    stopRecording,
    toggleLiveMode,
    toggleMute,
    playAudioData,
    stopAudio
} from './audio.js';
import { emit, initializeWebSocket } from './websocket.js';

// Register UI functions to state for other modules to use
export function registerUIFunctions() {
    state.ui = {
        updateStatus,
        appendToCurrentResponse,
        completeResponse,
        showTypingIndicator,
        showStopGenerationButton,
        hideStopGenerationButton,
        showError,
        showEnhancedError,
        updateVADStatus,
        showMiniPlayer,
        hideMiniPlayer,
        clearLiveUI,
        showAudioPlayingIndicator,
        showClickToPlayMessage
    };
}

/**
 * Initialize UI and Event Listeners
 */
export function initializeUI() {
    setupEventListeners();
    setupSettingsListeners();
    setupTheme();
    setupModelSelection();
    setupTTSControls();
    initializeRouting();

    // Load initial state
    loadSettings();
    loadConversation();
    loadChatHistory();

    // Load available models from backend
    loadAvailableModels();

    // Initialize advanced features
    initializePhase3Features();

    // Setup tutorial
    setupTutorial();

    // Setup export and search
    setupExportFeature();
    setupConversationSearch();
    setupShortcutsModal();

    // Setup progressive settings
    setupProgressiveSettings();

    // Check for mobile
    checkMobile();
    window.addEventListener('resize', checkMobile);
}

/**
 * Setup global event listeners
 */
/**
 * Setup global event listeners
 */
function setupEventListeners() {
    console.log('Setting up event listeners...');
    // Voice button
    const voiceBtn = document.getElementById('voiceBtn');
    if (voiceBtn) {
        console.log('Voice button found, adding listener');
        voiceBtn.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click only
                if (state.isRecording) {
                    stopRecording();
                } else {
                    startRecording();
                }
            }
        });

        // Touch support for mobile
        voiceBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            if (state.isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        });
    } else {
        console.error('Voice button NOT found');
    }

    // Text input
    const textInput = document.getElementById('textInput');
    const sendButton = document.getElementById('sendBtn');

    if (textInput) {
        console.log('Text input found');
        textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendTextMessage();
            }
        });

        // Auto-resize textarea
        textInput.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            if (this.value === '') {
                this.style.height = '';
            }
        });
    } else {
        console.error('Text input NOT found');
    }

    if (sendButton) {
        console.log('Send button found, adding listener');
        sendButton.addEventListener('click', sendTextMessage);
    } else {
        console.error('Send button NOT found');
    }

    // Test Audio button
    const testAudioBtn = document.getElementById('testAudioBtn');
    if (testAudioBtn) {
        testAudioBtn.addEventListener('click', () => {
            try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = 440;
                gain.gain.value = 0.1;
                osc.start();
                osc.stop(ctx.currentTime + 0.3);
                showToast('Playing test sound...', 'info');
            } catch (e) {
                showToast('Browser audio failed: ' + e.message, 'error');
                console.error('Test audio error:', e);
            }
        });
    }

    // Stop generation button
    const stopBtn = document.getElementById('stopGenerationBtn');
    if (stopBtn) {
        stopBtn.addEventListener('click', stopGeneration);
    }

    // Mute button
    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
        muteBtn.addEventListener('click', toggleMute);
    }

    // Live mode button
    const liveModeBtn = document.getElementById('liveModeBtn');
    if (liveModeBtn) {
        liveModeBtn.addEventListener('click', toggleLiveMode);
    }

    // New chat button
    const newChatBtn = document.getElementById('newChatBtn');
    if (newChatBtn) {
        newChatBtn.addEventListener('click', () => {
            startNewChat();
            // Close the menu after starting new chat
            const sideMenu = document.getElementById('sideMenu');
            const overlay = document.getElementById('overlay');
            if (sideMenu) sideMenu.classList.remove('open');
            if (overlay) overlay.classList.remove('active');
        });
    }

    // Clear chat button (from menu)
    const clearChatBtn = document.getElementById('clearChatBtn');
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', () => {
            clearCurrentConversation();
            // Close the menu after clearing
            const sideMenu = document.getElementById('sideMenu');
            const overlay = document.getElementById('overlay');
            if (sideMenu) sideMenu.classList.remove('open');
            if (overlay) overlay.classList.remove('active');
        });
    }

    // Clear conversation button
    const clearBtn = document.getElementById('clearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearCurrentConversation);
    }

    // Mobile menu toggle
    const menuToggle = document.getElementById('menuBtn');
    const sideMenu = document.getElementById('sideMenu');
    const overlay = document.getElementById('overlay');
    const closeMenuBtn = document.getElementById('closeMenu');

    if (menuToggle) console.log('Menu toggle found');
    else console.error('Menu toggle NOT found');

    if (menuToggle && sideMenu && overlay) {
        console.log('Adding menu listeners');
        menuToggle.addEventListener('click', () => {
            console.log('Menu clicked');
            sideMenu.classList.add('open');
            overlay.classList.add('active');
        });

        const closeMenu = () => {
            sideMenu.classList.remove('open');
            overlay.classList.remove('active');
        };

        if (closeMenuBtn) closeMenuBtn.addEventListener('click', closeMenu);
        overlay.addEventListener('click', closeMenu);
    }

    // Image upload button
    const imageUploadBtn = document.getElementById('imageUploadBtn');
    const imageInput = document.getElementById('imageInput');

    if (imageUploadBtn && imageInput) {
        imageUploadBtn.addEventListener('click', () => {
            imageInput.click();
        });

        imageInput.addEventListener('change', handleImageUpload);
    }
}

function setupModelSelection() {
    console.log('Setting up model selection listeners...');

    // Delegate click listener for model buttons (since they might be dynamic)
    const modelGrid = document.querySelector('.model-grid');
    if (modelGrid) {
        modelGrid.addEventListener('click', (e) => {
            const btn = e.target.closest('.model-btn');
            if (!btn) return;

            // Remove active class from all
            const modelBtns = document.querySelectorAll('.model-btn');
            modelBtns.forEach(b => b.classList.remove('active'));

            // Add active class to current
            btn.classList.add('active');

            // Get model
            const model = btn.dataset.model;

            console.log(`Model selected from welcome screen: ${model}`);

            // Emit change event to backend
            emit('change_model', { model: model });

            // Optimistic UI update
            state.currentModel = model;

            // Save to localStorage for persistence
            localStorage.setItem('selectedModel', model);

            updateStatus('Ready', 'ready');

            const modelIndicator = document.getElementById('modelIndicator');
            if (modelIndicator) modelIndicator.textContent = model;

            // Update dropdown if exists
            const modelSelect = document.getElementById('modelSelect');
            if (modelSelect) modelSelect.value = model;

            // Update upload button visibility
            updateUploadButtonVisibility();

            // Show toast
            const modelName = btn.querySelector('.model-name').textContent;
            showToast(`Switching to ${modelName}...`, 'info');

            // Hide welcome, show messages
            const welcome = document.getElementById('welcome');
            const messages = document.getElementById('messages');
            if (welcome) welcome.style.display = 'none';
            if (messages) messages.classList.add('active');

            // Focus input
            const input = document.getElementById('textInput');
            if (input) input.focus();
        });
    }

    // Setup settings model dropdown change listener
    const modelSelect = document.getElementById('modelSelect');
    if (modelSelect) {
        modelSelect.addEventListener('change', async (e) => {
            const selectedModel = e.target.value;
            if (!selectedModel) return;

            console.log(`Switching to model: ${selectedModel}`);

            // Update state
            state.currentModel = selectedModel;

            // Save to localStorage for persistence
            localStorage.setItem('selectedModel', selectedModel);

            // Show loading feedback
            showToast(`Switching to ${selectedModel}...`, 'info', 2000);

            // Emit model change event to backend
            emit('change_model', { model: selectedModel });

            const modelIndicator = document.getElementById('modelIndicator');
            if (modelIndicator) modelIndicator.textContent = selectedModel;

            // Update upload button visibility
            updateUploadButtonVisibility();
        });
        console.log('Model dropdown listener added');
    }

    // Setup Whisper model dropdown change listener
    const whisperSelect = document.getElementById('whisperSelect');
    if (whisperSelect) {
        whisperSelect.addEventListener('change', (e) => {
            const model = e.target.value;
            if (!model) return;
            console.log(`Switching Whisper model to: ${model}`);
            emit('change_whisper_model', { model: model });
            showToast(`Switching Whisper model to ${model}...`, 'info', 2000);
        });
    }
}

/**
 * Load available models from backend and populate settings dropdown
 */
export async function loadAvailableModels(retryCount = 0) {
    console.log('Loading available models...');
    const modelSelect = document.getElementById('modelSelect');
    const modelGrid = document.querySelector('.model-grid');
    const maxRetries = 10;
    const retryDelay = 3000; // 3 seconds

    if (!modelSelect) {
        console.error('Model select dropdown not found');
        return;
    }

    try {
        // Show loading state if first time or currently loading
        if (retryCount === 0) {
            modelSelect.innerHTML = '<option value="">Loading models...</option>';
            modelSelect.disabled = true;
        }

        // Fetch models from backend
        const response = await fetch('/api/models');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // If backend says "Loading..." or returns empty list during initialization
        if (data.current === "Loading..." || (data.models.length === 0 && retryCount < maxRetries)) {
            console.log(`Models still loading, retrying in ${retryDelay / 1000}s... (Attempt ${retryCount + 1}/${maxRetries})`);

            // Update UI to show progress
            if (modelSelect.disabled) {
                modelSelect.innerHTML = `<option value="">Models loading... (${retryCount + 1})</option>`;
            }
            if (modelGrid && retryCount === 0) {
                modelGrid.innerHTML = '<p class="status-text">Connecting to AI backend... please wait.</p>';
            }

            setTimeout(() => loadAvailableModels(retryCount + 1), retryDelay);
            return;
        }

        if (!data.models || !Array.isArray(data.models)) {
            throw new Error('Invalid response format from /api/models');
        }

        // List of all available model info
        state.availableModels = data.models;

        // Clear and populate dropdown
        modelSelect.innerHTML = '';

        // Clear welcome grid and quick selector
        if (modelGrid) modelGrid.innerHTML = '';
        const quickSelector = document.getElementById('quickModelSelector');

        if (data.models.length === 0) {
            modelSelect.innerHTML = '<option value="">No models available</option>';
            if (modelGrid) modelGrid.innerHTML = '<p class="error-text">No models available. Please check Ollama/LM Studio.</p>';
            showToast('No models available', 'warning', 3000);
            return;
        }

        // Add models to dropdown and welcome grid
        data.models.forEach(modelInfo => {
            const modelName = modelInfo.name;
            const capabilities = modelInfo.capabilities || [];

            // Add to dropdown
            const option = document.createElement('option');
            option.value = modelName;
            option.textContent = modelName + (capabilities.length ? ` (${capabilities.join(', ')})` : '');
            modelSelect.appendChild(option);

            // Add to welcome grid
            if (modelGrid && modelGrid.children.length < 8) {
                const btn = document.createElement('button');
                btn.className = 'model-btn';
                btn.dataset.model = modelName;

                // Build capability badges
                let badgesHTML = '<div class="capability-badges">';
                capabilities.forEach(cap => {
                    badgesHTML += `<span class="badge badge-${cap}">${cap}</span>`;
                });
                badgesHTML += '</div>';

                // Deterministic icon based on model name
                const isDeepSeek = modelName.toLowerCase().includes('deepseek');
                const isQwen = modelName.toLowerCase().includes('qwen');
                const isLlama = modelName.toLowerCase().includes('llama');
                const isMistral = modelName.toLowerCase().includes('mistral');

                let icon = '';
                let desc = 'AI Model';

                if (isDeepSeek) {
                    desc = 'DeepSeek Model';
                    icon = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>`;
                } else if (isQwen) {
                    desc = 'Qwen Model';
                    icon = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24" /></svg>`;
                } else if (isLlama) {
                    desc = 'Meta Llama';
                    icon = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>`;
                } else if (isMistral) {
                    desc = 'Mistral Model';
                    icon = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>`;
                } else {
                    icon = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>`;
                }

                btn.innerHTML = `
                    <div class="model-icon">${icon}</div>
                    <span class="model-name">${modelName}</span>
                    <span class="model-desc">${desc}</span>
                    ${badgesHTML}
                `;

                modelGrid.appendChild(btn);
            }
        });

        // Setup quick model selector click
        if (quickSelector) {
            quickSelector.onclick = () => {
                const settingsBtn = document.getElementById('settingsBtn');
                if (settingsBtn) settingsBtn.click();

                // Focus the model select and open it if possible
                const modelSelect = document.getElementById('modelSelect');
                if (modelSelect) {
                    setTimeout(() => modelSelect.focus(), 200);
                }
            };
        }

        // Set current model
        const currentModel = data.current || (data.models.length > 0 ? data.models[0].name : null);
        if (currentModel) {
            modelSelect.value = currentModel;
            state.currentModel = currentModel;
            console.log(`Current model set to: ${currentModel}`);

            const modelIndicator = document.getElementById('modelIndicator');
            if (modelIndicator) modelIndicator.textContent = currentModel;

            // Highlight in grid if present
            if (modelGrid) {
                const activeBtn = modelGrid.querySelector(`[data-model="${currentModel}"]`);
                if (activeBtn) activeBtn.classList.add('active');
            }

            // Initial upload button visibility check
            updateUploadButtonVisibility();
        }

        modelSelect.disabled = false;
        console.log(`Loaded ${data.models.length} models successfully`);
        if (retryCount > 0) showToast('Models loaded successfully', 'success');

    } catch (error) {
        console.error('Failed to load models:', error);
        modelSelect.innerHTML = '<option value="">Failed to load models</option>';
        modelSelect.disabled = true;
        if (modelGrid) modelGrid.innerHTML = `<p class="error-text">Failed to load models: ${error.message}</p>`;
        showToast(`Failed to load models: ${error.message}`, 'error', 5000);
    }
}

/**
 * Send text message
 */
function sendTextMessage() {
    const textInput = document.getElementById('textInput');
    const text = textInput.value.trim();

    if (!text && state.pendingImages.length === 0) return;

    // Clear input
    textInput.value = '';
    textInput.style.height = '';

    // Add user message to UI (with images if present)
    addMessage('user', text || 'Describe this image', true, { images: state.pendingImages });

    // Start performance tracking
    state.messageStartTime = Date.now();
    state.firstTokenTime = null;
    state.tokenCount = 0;

    // Send to backend
    const requestData = {
        text: text || 'Describe this image',
        images: state.pendingImages,
        enable_tts: state.ttsEnabled,
        conversation_id: state.currentChatId
    };
    logRequest('process_text', requestData);
    emit('process_text', requestData);

    // Clear pending images
    state.pendingImages = [];
    const previewContainer = document.getElementById('imagePreviewContainer');
    if (previewContainer) {
        previewContainer.innerHTML = '';
        previewContainer.style.display = 'none';
    }
}

/**
 * Handle image file upload
 */
function handleImageUpload(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
        if (!file.type.startsWith('image/')) {
            showToast('Please select image files only', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64Image = e.target.result;
            state.pendingImages.push(base64Image);
            showImagePreview(base64Image, state.pendingImages.length - 1);
        };
        reader.readAsDataURL(file);
    });

    // Clear file input
    event.target.value = '';
}

/**
 * Show image preview thumbnail
 */
function showImagePreview(base64Image, index) {
    const previewContainer = document.getElementById('imagePreviewContainer');
    if (!previewContainer) return;

    previewContainer.style.display = 'flex';

    const thumbnail = document.createElement('div');
    thumbnail.className = 'image-preview-thumbnail';
    thumbnail.dataset.index = index;

    const img = document.createElement('img');
    img.src = base64Image;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'image-preview-remove';
    removeBtn.innerHTML = '×';
    removeBtn.onclick = () => removeImage(index);

    thumbnail.appendChild(img);
    thumbnail.appendChild(removeBtn);
    previewContainer.appendChild(thumbnail);
}

/**
 * Remove image from pending images
 */
function removeImage(index) {
    state.pendingImages.splice(index, 1);

    const previewContainer = document.getElementById('imagePreviewContainer');
    if (!previewContainer) return;

    // Rebuild preview
    previewContainer.innerHTML = '';

    if (state.pendingImages.length === 0) {
        previewContainer.style.display = 'none';
    } else {
        state.pendingImages.forEach((img, idx) => {
            showImagePreview(img, idx);
        });
    }
}


/**
 * Add message to UI
 */
export function addMessage(role, text, save = true, metadata = {}) {
    const messages = document.getElementById('messages');
    const welcome = document.getElementById('welcome');

    if (welcome) {
        welcome.style.display = 'none';
    }

    if (messages) {
        messages.classList.add('active');
    }

    const messageDiv = document.createElement('div');
    // Support live mode message types
    const isLiveTranscript = role === 'live-transcript';
    const isLiveInsight = role === 'live-insight';
    const isPinned = metadata.pinned || false;

    // Set appropriate classes
    if (isLiveTranscript) {
        messageDiv.className = 'message user live-transcript';
    } else if (isLiveInsight) {
        messageDiv.className = `message assistant live-insight${isPinned ? ' pinned' : ''}`;
    } else {
        messageDiv.className = `message ${role}`;
    }

    // Store metadata
    if (isLiveTranscript || isLiveInsight) {
        messageDiv.dataset.liveMode = 'true';
        if (isPinned) messageDiv.dataset.pinned = 'true';
        if (metadata.topic) messageDiv.dataset.topic = metadata.topic;
        if (metadata.keyPoints) messageDiv.dataset.keyPoints = JSON.stringify(metadata.keyPoints);
    }

    // Avatar
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    if (role === 'user' || isLiveTranscript) {
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

    // Content Wrapper
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-wrapper';

    // Content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // Handle live insight formatting
    if (isLiveInsight && metadata.topic && metadata.keyPoints) {
        const topic = metadata.topic;
        const keyPoints = metadata.keyPoints;

        let insightHTML = `<div class="live-insight-content">`;
        insightHTML += `<h4 class="insight-topic">${topic}</h4>`;
        if (keyPoints && keyPoints.length > 0) {
            insightHTML += `<ul class="insight-points">`;
            keyPoints.forEach(point => {
                insightHTML += `<li>${point}</li>`;
            });
            insightHTML += `</ul>`;
        }
        insightHTML += `</div>`;

        contentDiv.innerHTML = insightHTML;
    } else if (role === 'assistant' && !isLiveInsight) {
        contentDiv.innerHTML = renderMarkdown(text);
        setTimeout(() => addCopyButtonsToCodeBlocks(contentDiv), 0);
    } else {
        contentDiv.textContent = text;
    }

    contentDiv.setAttribute('data-original-text', text);

    // Display images if present
    if (metadata.images && metadata.images.length > 0) {
        const imagesContainer = document.createElement('div');
        imagesContainer.className = 'message-images';

        metadata.images.forEach((base64Image) => {
            const img = document.createElement('img');
            img.src = base64Image;
            img.className = 'message-image-thumbnail';
            img.alt = 'Uploaded image';
            img.onclick = () => {
                // Open image in new tab
                const win = window.open();
                win.document.write(`<img src="${base64Image}" style="max-width:100%;height:auto;">`);
            };
            imagesContainer.appendChild(img);
        });

        contentDiv.appendChild(imagesContainer);
    }


    // Pin button for live insights
    if (isLiveInsight) {
        const pinButton = document.createElement('button');
        pinButton.className = `message-action-btn pin-btn${isPinned ? ' pinned' : ''}`;
        pinButton.title = isPinned ? 'Unpin insight' : 'Pin insight';
        pinButton.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <path d="M12 2v6m0 0l4-4m-4 4L8 4m4 4v6m0 0l-3 3m3-3l3 3"/>
                <path d="M12 17v5"/>
            </svg>
        `;

        pinButton.addEventListener('click', () => {
            togglePinInsight(messageDiv);
        });

        const actionButtons = document.createElement('div');
        actionButtons.className = 'message-actions';
        actionButtons.appendChild(pinButton);
        contentWrapper.appendChild(actionButtons);
    }

    // Timestamp
    const timestampDiv = document.createElement('div');
    timestampDiv.className = 'message-time';
    const now = new Date();
    let timestampText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Add badge for live mode messages
    if (isLiveTranscript) {
        timestampText += ' • Live Transcript';
    } else if (isLiveInsight) {
        timestampText += ' • AI Insight';
    }

    timestampDiv.textContent = timestampText;

    // Action buttons for assistant messages (copy, regenerate, speaker) - all in timestamp row
    if (role === 'assistant' && !isLiveInsight) {
        // Copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'message-action-btn copy-btn';
        copyBtn.title = 'Copy message';
        copyBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
        `;
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(text);
                showToast('Message copied!', 'success');
            } catch (err) {
                showToast('Failed to copy', 'error');
            }
        });

        // Regenerate button
        const regenerateBtn = document.createElement('button');
        regenerateBtn.className = 'message-action-btn regenerate-btn';
        regenerateBtn.title = 'Regenerate response';
        regenerateBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="1 4 1 10 7 10"/>
                <polyline points="23 20 23 14 17 14"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
        `;
        regenerateBtn.addEventListener('click', () => {
            const messages = Array.from(document.querySelectorAll('.message.user'));
            if (messages.length > 0) {
                const lastUserMessage = messages[messages.length - 1];
                const userText = lastUserMessage.querySelector('.message-content').textContent;
                showToast('Regenerating...', 'info');
                emit('process_text', { text: userText, enable_tts: state.ttsEnabled });
            }
        });

        // Speaker button
        const speakerBtn = document.createElement('button');
        speakerBtn.className = 'message-speaker-btn';
        speakerBtn.title = 'Read aloud';
        speakerBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
        `;
        speakerBtn.onclick = () => {
            console.log('Speaker button clicked - replaying message:', text.substring(0, 50) + '...');
            emit('replay_text', { text: text, enable_tts: true });
        };

        // Append all buttons to timestamp row
        timestampDiv.appendChild(copyBtn);
        timestampDiv.appendChild(regenerateBtn);
        timestampDiv.appendChild(speakerBtn);
    }

    contentWrapper.appendChild(contentDiv);
    contentWrapper.appendChild(timestampDiv);

    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(contentWrapper);

    if (messages) {
        messages.appendChild(messageDiv);

        // Reactions
        if (role === 'assistant' && !isLiveInsight) {
            const messageId = 'msg-' + Date.now() + '-' + Math.random();
            messageDiv.dataset.messageId = messageId;
            setTimeout(() => {
                addReactionButtons(messageDiv, messageId);
                observeNewMessage(messageDiv);
            }, 50);
        }

        // Scroll
        scrollToBottom();
    }

    if (save) {
        setTimeout(() => {
            saveConversation();
            // Also save to history if this is a user message
            if (role === 'user') {
                const currentConversation = localStorage.getItem('assistedVoiceConversation');
                if (currentConversation) {
                    const data = JSON.parse(currentConversation);
                    if (data.messages && data.messages.length > 0) {
                        saveChatToHistory(data.messages, state.currentChatId);
                    }
                }
            }
        }, 100);
    }
}

/**
 * Toggle pin status for live insight
 */
function togglePinInsight(messageDiv) {
    const isPinned = messageDiv.classList.contains('pinned');

    if (isPinned) {
        messageDiv.classList.remove('pinned');
        messageDiv.dataset.pinned = 'false';
        const pinBtn = messageDiv.querySelector('.pin-btn');
        if (pinBtn) {
            pinBtn.classList.remove('pinned');
            pinBtn.title = 'Pin insight';
            const svg = pinBtn.querySelector('svg');
            if (svg) svg.setAttribute('fill', 'none');
        }
        showToast('Insight unpinned', 'info');
    } else {
        messageDiv.classList.add('pinned');
        messageDiv.dataset.pinned = 'true';
        const pinBtn = messageDiv.querySelector('.pin-btn');
        if (pinBtn) {
            pinBtn.classList.add('pinned');
            pinBtn.title = 'Unpin insight';
            const svg = pinBtn.querySelector('svg');
            if (svg) svg.setAttribute('fill', 'currentColor');
        }
        showToast('Insight pinned', 'success');
    }

    // Save conversation to persist pin status
    saveConversation();
}

/**
 * Append text to current response (streaming)
 */
export function appendToCurrentResponse(text) {
    if (!text || text.trim() === '') return;

    // Remove typing indicator
    const typingIndicator = document.querySelector('.typing-indicator');
    if (typingIndicator) typingIndicator.remove();

    if (!state.currentResponseDiv) {
        // Create new message div
        const messages = document.getElementById('messages');
        const welcome = document.getElementById('welcome');

        if (welcome) welcome.style.display = 'none';
        if (messages) messages.classList.add('active');

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message assistant';

        const avatarDiv = document.createElement('div');
        avatarDiv.className = 'message-avatar';
        avatarDiv.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1-2.73 2.71-2.73 7.08 0 9.79s7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58s9.14-3.47 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z"/>
            </svg>
        `;

        const contentWrapper = document.createElement('div');
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-time';
        timestampDiv.innerHTML = `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${state.currentModel || 'Assistant'}`;

        contentWrapper.appendChild(contentDiv);
        contentWrapper.appendChild(timestampDiv);
        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(contentWrapper);

        if (messages) messages.appendChild(messageDiv);

        state.currentResponseDiv = contentDiv;
    }

    state.currentResponseDiv.innerHTML = renderMarkdown(state.currentResponse);
    addCopyButtonsToCodeBlocks(state.currentResponseDiv);
    scrollToBottom();
}

/**
 * Complete response
 */
export function completeResponse(fullText) {
    const typingIndicator = document.querySelector('.typing-indicator');
    if (typingIndicator) typingIndicator.remove();

    if (!fullText || fullText.trim() === '') {
        state.currentResponseDiv = null;
        return;
    }

    if (state.currentResponseDiv) {
        state.currentResponseDiv.innerHTML = renderMarkdown(fullText);
        addCopyButtonsToCodeBlocks(state.currentResponseDiv);
        state.currentResponseDiv.setAttribute('data-original-text', fullText);

        // Update timestamp with metrics
        let timestampDiv = state.currentResponseDiv.parentElement?.querySelector('.message-time');
        if (timestampDiv) {
            console.log('Metrics debug:', {
                startTime: state.messageStartTime,
                now: Date.now(),
                tokenCount: state.tokenCount
            });

            // Update metrics if available
            if (state.messageStartTime) {
                const totalTime = Date.now() - state.messageStartTime;
                const firstTokenDelay = state.firstTokenTime ? state.firstTokenTime - state.messageStartTime : 0;
                const tokensPerSecond = state.tokenCount > 0 && totalTime > 0 ? (state.tokenCount / (totalTime / 1000)).toFixed(1) : 0;

                timestampDiv.innerHTML = `
                    ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${state.currentModel}<br>
                    <span style="font-size: 11px; opacity: 0.7;">${(totalTime / 1000).toFixed(1)}s total • ${(firstTokenDelay / 1000).toFixed(2)}s first • ${tokensPerSecond} t/s</span>
                `;
            }

            // Add copy button
            const copyBtn = document.createElement('button');
            copyBtn.className = 'message-action-btn copy-btn';
            copyBtn.title = 'Copy message';
            copyBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
            `;
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(fullText);
                    showToast('Message copied!', 'success');
                } catch (err) {
                    showToast('Failed to copy', 'error');
                }
            });

            // Add regenerate button
            const regenerateBtn = document.createElement('button');
            regenerateBtn.className = 'message-action-btn regenerate-btn';
            regenerateBtn.title = 'Regenerate response';
            regenerateBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="1 4 1 10 7 10"/>
                    <polyline points="23 20 23 14 17 14"/>
                    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                </svg>
            `;
            regenerateBtn.addEventListener('click', () => {
                const messages = Array.from(document.querySelectorAll('.message.user'));
                if (messages.length > 0) {
                    const lastUserMessage = messages[messages.length - 1];
                    const userText = lastUserMessage.querySelector('.message-content').textContent;
                    showToast('Regenerating...', 'info');
                    emit('process_text', { text: userText, enable_tts: state.ttsEnabled });
                }
            });

            // Add speaker button
            const speakerBtn = document.createElement('button');
            speakerBtn.className = 'message-speaker-btn';
            speakerBtn.title = 'Read aloud';
            speakerBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg>
            `;
            speakerBtn.onclick = () => {
                console.log('Speaker button clicked - replaying response:', fullText.substring(0, 50) + '...');
                showToast('Requesting audio replay...', 'info');
                emit('replay_text', { text: fullText, enable_tts: true });
            };

            // Append all buttons to timestamp row
            timestampDiv.appendChild(copyBtn);
            timestampDiv.appendChild(regenerateBtn);
            timestampDiv.appendChild(speakerBtn);
            console.log('Action buttons added to completed response');
        }
    }

    state.currentResponseDiv = null;
    saveConversation();
}

/**
 * Show typing indicator
 */
export function showTypingIndicator() {
    const chatContainer = document.getElementById('chatContainer');
    const existing = document.querySelector('.typing-indicator');
    if (existing) existing.remove();

    const welcomeMsg = chatContainer.querySelector('.welcome-message');
    if (welcomeMsg) welcomeMsg.style.display = 'none';

    const typingDiv = document.createElement('div');
    typingDiv.className = 'message assistant-message typing-indicator';
    typingDiv.innerHTML = `
        <div class="message-content">
            <span class="typing-dots">
                <span></span><span></span><span></span>
            </span>
        </div>
    `;

    chatContainer.appendChild(typingDiv);
    scrollToBottom();
}

/**
 * Update status display
 */
export function updateStatus(message, type) {
    const statusText = document.getElementById('statusText');
    const modelIndicator = document.getElementById('modelIndicator');

    if (statusText) {
        statusText.textContent = message;
        statusText.className = `status-text status-${type}`;
    }

    if (type === 'ready' && state.currentModel && modelIndicator) {
        modelIndicator.textContent = state.currentModel;
    }
}

/**
 * Show error message
 */
export function showError(message) {
    showEnhancedError(message, 'general');
}

/**
 * Show enhanced error message
 */
export function showEnhancedError(message, type = 'general', retryCallback = null) {
    const messages = document.getElementById('messages');
    if (!messages) return;

    const welcome = document.getElementById('welcome');
    if (welcome) welcome.style.display = 'none';
    messages.classList.add('active');

    const errorCard = document.createElement('div');
    errorCard.className = 'error-card';

    // Simple error card for now
    errorCard.innerHTML = `
        <div class="error-content">
            <h3 class="error-title">Error</h3>
            <p class="error-message">${message}</p>
        </div>
    `;

    messages.appendChild(errorCard);
    scrollToBottom();
    showToast(message, 'error');
}

/**
 * Stop generation
 */
function stopGeneration() {
    if (state.isGenerating) {
        emit('stop_generation', {});
        state.isGenerating = false;
        hideStopGenerationButton();
        showToast('Stopped generation', 'info');
        if (state.currentResponse) {
            completeResponse(state.currentResponse);
        }
    }
}

export function showStopGenerationButton() {
    const stopBtn = document.getElementById('stopGenerationBtn');
    if (stopBtn) stopBtn.classList.add('show');
}

export function hideStopGenerationButton() {
    const stopBtn = document.getElementById('stopGenerationBtn');
    if (stopBtn) stopBtn.classList.remove('show');
}

/**
 * Scroll to bottom
 */
function scrollToBottom() {
    const chatContainer = document.getElementById('chatContainer');
    if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

/**
 * Load settings
 */
/**
 * Fetch current configuration from backend
 */
async function fetchConfig() {
    try {
        const response = await fetch('/config');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const config = await response.json();
        console.log('Fetched backend config:', config);
        return config;
    } catch (err) {
        console.error('Failed to fetch config from backend:', err);
        return null;
    }
}

async function loadSettings() {
    console.log('Synchronizing settings with backend...');
    const config = await fetchConfig();

    if (config) {
        // Sync TTS Engine
        const engine = config.tts?.engine || 'edge-tts';
        state.currentTTSEngine = engine;
        state.ttsEnabled = (engine !== 'none');
        localStorage.setItem('ttsEngine', engine);

        // Sync LLM Model - backend is source of truth
        const serverType = config.server?.type || 'ollama';
        const model = serverType === 'lm-studio' ?
            config.lm_studio?.model : config.ollama?.model;

        if (model) {
            // Update UI to reflect current backend state
            state.currentModel = model;
            const modelSelect = document.getElementById('modelSelect');
            if (modelSelect) modelSelect.value = model;

            // Save current backend state to localStorage for reference
            localStorage.setItem('selectedModel', model);
        }

        // Sync Whisper Model
        const whisperModel = config.whisper?.model;
        if (whisperModel) {
            const whisperSelect = document.getElementById('whisperSelect');
            if (whisperSelect) whisperSelect.value = whisperModel;
        }

        // Sync TTS Parameters
        if (config.tts?.rate) {
            const rateStr = config.tts.rate.replace('%', '');
            const rate = 1.0 + (parseFloat(rateStr) / 100);
            localStorage.setItem('ttsRate', rate.toFixed(1));
        }
        if (config.tts?.pitch) {
            const pitch = config.tts.pitch.replace('Hz', '').replace('+', '');
            localStorage.setItem('ttsPitch', pitch);
        }
        if (config.tts?.edge_voice) {
            localStorage.setItem('edgeVoice', config.tts.edge_voice);
        }

        // Sync AI Parameters
        const configSection = serverType === 'lm-studio' ? 'lm_studio' : 'ollama';
        const aiConfig = config[configSection];

        if (aiConfig) {
            if (aiConfig.temperature !== undefined) {
                localStorage.setItem('aiTemperature', aiConfig.temperature);
                const tempSlider = document.getElementById('temperatureSlider');
                const tempValue = document.getElementById('temperatureValue');
                if (tempSlider) tempSlider.value = aiConfig.temperature;
                if (tempValue) tempValue.textContent = aiConfig.temperature;
            }
            if (aiConfig.max_tokens !== undefined) {
                localStorage.setItem('aiMaxTokens', aiConfig.max_tokens);
                const maxTokensInput = document.getElementById('maxTokensInput');
                if (maxTokensInput) maxTokensInput.value = aiConfig.max_tokens;
            }
            if (aiConfig.system_prompt !== undefined) {
                localStorage.setItem('aiSystemPrompt', aiConfig.system_prompt);
                const systemPromptTextarea = document.getElementById('systemPromptTextarea');
                if (systemPromptTextarea) systemPromptTextarea.value = aiConfig.system_prompt;
            }
        }

        // Sync Server Settings
        if (config.server) {
            if (config.server.type) localStorage.setItem('serverType', config.server.type);
            if (config.server.host) localStorage.setItem('serverHost', config.server.host);
            if (config.server.port) localStorage.setItem('serverPort', config.server.port);

            const serverTypeSelect = document.getElementById('serverTypeSelect');
            const serverHost = document.getElementById('serverHost');
            const serverPort = document.getElementById('serverPort');

            if (serverTypeSelect) serverTypeSelect.value = config.server.type || 'ollama';
            if (serverHost) serverHost.value = config.server.host || 'localhost';
            if (serverPort) serverPort.value = config.server.port || '11434';
        }

        // Sync VAD Settings
        if (config.vad) {
            const vadEnabled = document.getElementById('vadEnabled');
            const vadModeSlider = document.getElementById('vadModeSlider');
            const vadModeValue = document.getElementById('vadModeValue');
            const vadTimeoutSlider = document.getElementById('vadTimeoutSlider');
            const vadTimeoutValue = document.getElementById('vadTimeoutValue');

            if (vadEnabled) vadEnabled.checked = config.vad.enabled !== false;

            if (config.vad.mode !== undefined) {
                if (vadModeSlider) vadModeSlider.value = config.vad.mode;
                if (vadModeValue) vadModeValue.textContent = config.vad.mode;
            }

            if (config.vad.speech_timeout !== undefined) {
                if (vadTimeoutSlider) vadTimeoutSlider.value = config.vad.speech_timeout;
                if (vadTimeoutValue) vadTimeoutValue.textContent = config.vad.speech_timeout + 's';
            }
        }
    } else {
        // Fallback to localStorage if backend config fails
        const savedEngine = localStorage.getItem('ttsEngine');
        if (savedEngine) {
            state.currentTTSEngine = savedEngine;
            state.ttsEnabled = (savedEngine !== 'none');
        }
    }

    // Update mute button UI
    const muteBtn = document.getElementById('muteBtn');
    if (muteBtn) {
        const speakerOnIcon = muteBtn.querySelector('.speaker-on-icon');
        const speakerOffIcon = muteBtn.querySelector('.speaker-off-icon');

        if (!state.ttsEnabled) {
            muteBtn.classList.add('muted');
            if (speakerOnIcon) speakerOnIcon.style.display = 'none';
            if (speakerOffIcon) speakerOffIcon.style.display = 'block';
        } else {
            muteBtn.classList.remove('muted');
            if (speakerOnIcon) speakerOnIcon.style.display = 'block';
            if (speakerOffIcon) speakerOffIcon.style.display = 'none';
        }
    }
}

/**
 * Load conversation
 */
function loadConversation() {
    try {
        const saved = localStorage.getItem('assistedVoiceConversation');
        if (!saved) return;

        const data = JSON.parse(saved);

        // Restore the chat ID to prevent duplicate entries on refresh
        if (data.chatId) {
            state.currentChatId = data.chatId;
        } else if (data.timestamp) {
            // Fallback: use timestamp as ID for backward compatibility
            state.currentChatId = data.timestamp.toString();
        }

        const welcome = document.getElementById('welcome');
        const messages = document.getElementById('messages');

        if (welcome) welcome.style.display = 'none';
        if (messages) messages.classList.add('active');

        data.messages.forEach(msg => {
            // Pass metadata for live mode messages
            addMessage(msg.role, msg.content, false, msg.metadata || {});
        });
    } catch (err) {
        console.error('Failed to load conversation', err);
    }
}

/**
 * Save conversation
 */
function saveConversation() {
    const messages = [];
    const messageElements = document.querySelectorAll('#messages .message');

    messageElements.forEach(elem => {
        const isUser = elem.classList.contains('user');
        const isLiveTranscript = elem.classList.contains('live-transcript');
        const isLiveInsight = elem.classList.contains('live-insight');
        const content = elem.querySelector('.message-content')?.getAttribute('data-original-text') ||
            elem.querySelector('.message-content')?.textContent;

        if (content) {
            const message = {
                role: isLiveTranscript ? 'live-transcript' :
                    isLiveInsight ? 'live-insight' :
                        isUser ? 'user' : 'assistant',
                content: content
            };

            // Initialize metadata if not already present
            if (!message.metadata) {
                message.metadata = {};
            }

            // Save metadata for live mode messages
            if (isLiveInsight) {
                message.metadata = {
                    ...message.metadata,
                    topic: elem.dataset.topic || '',
                    keyPoints: elem.dataset.keyPoints ? JSON.parse(elem.dataset.keyPoints) : [],
                    pinned: elem.dataset.pinned === 'true'
                };
            }

            // Save images to metadata
            const imageElements = elem.querySelectorAll('.message-image-thumbnail');
            if (imageElements.length > 0) {
                message.metadata.images = Array.from(imageElements).map(img => img.src);
            }

            // Remove metadata if it's still empty
            if (Object.keys(message.metadata).length === 0) {
                delete message.metadata;
            }

            messages.push(message);
        }
    });

    if (messages.length > 0) {
        // Ensure we have a chatId
        if (!state.currentChatId) {
            state.currentChatId = Date.now().toString();
        }

        // Save to localStorage (immediate, always works)
        localStorage.setItem('assistedVoiceConversation', JSON.stringify({
            version: 3,
            timestamp: Date.now(),
            chatId: state.currentChatId,
            messages: messages
        }));

        // Save to database API (async, persistent)
        saveConversationToDatabase(state.currentChatId, messages);
    }
}

/**
 * Save conversation to database API
 */
async function saveConversationToDatabase(chatId, messages) {
    try {
        const response = await fetch(`/api/conversations/${chatId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: messages,
                model: state.currentModel
            })
        });

        if (!response.ok) {
            // If conversation doesn't exist, create it
            if (response.status === 404) {
                await fetch('/api/conversations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: chatId,
                        messages: messages,
                        model: state.currentModel
                    })
                });
            } else {
                console.warn('Failed to save conversation to database:', response.status);
            }
        }
    } catch (error) {
        console.warn('Database save failed, using localStorage only:', error);
    }
}

/**
 * Start new chat
 */
function clearCurrentConversation() {
    console.log('Clearing current conversation...');

    // Clear display
    const messages = document.getElementById('messages');
    if (messages) {
        messages.innerHTML = '';
        messages.classList.remove('active');
    }

    const welcome = document.getElementById('welcome');
    if (welcome) {
        welcome.style.display = 'flex';
        // Refresh model grid to ensure it's up to date
        loadAvailableModels();
    }

    // Clear live mode insights panel
    const aiInsightsContent = document.getElementById('aiInsightsContent');
    if (aiInsightsContent) {
        aiInsightsContent.innerHTML = `
            <div class="insight-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <p>Waiting for conversation context...</p>
            </div>
        `;
    }

    // Clear live mode transcript panel
    const liveTranscriptContent = document.getElementById('liveTranscriptContent');
    if (liveTranscriptContent) {
        liveTranscriptContent.innerHTML = '<p class="placeholder-text">Speak to start transcription...</p>';
    }

    // Clear localStorage
    localStorage.removeItem('assistedVoiceConversation');

    // Clear backend conversation history
    emit('clear_conversation', {});

    showToast('Conversation cleared', 'success', 1500);
    console.log('Conversation cleared successfully');
}

function startNewChat() {
    // Save current to history
    const currentConversation = localStorage.getItem('assistedVoiceConversation');
    if (currentConversation) {
        const data = JSON.parse(currentConversation);
        if (data.messages && data.messages.length > 0) {
            saveChatToHistory(data.messages, state.currentChatId);
        }
    }

    // Clear display
    const messages = document.getElementById('messages');
    if (messages) {
        messages.innerHTML = '';
        messages.classList.remove('active');
    }

    const welcome = document.getElementById('welcome');
    if (welcome) {
        welcome.style.display = 'flex';
        // Refresh model grid to ensure it's up to date
        loadAvailableModels();
    }

    localStorage.removeItem('assistedVoiceConversation');
    state.currentChatId = Date.now().toString();

    loadChatHistory();
}

/**
 * Chat History - Now uses database API with localStorage fallback
 */

/**
 * Get chat history from localStorage (fallback/cache)
 */
function getChatHistoryFromLocalStorage() {
    try {
        const history = localStorage.getItem('assistedVoiceChatHistory');
        return history ? JSON.parse(history) : [];
    } catch (error) {
        return [];
    }
}

/**
 * Load chat history from database API
 */
async function loadChatHistory() {
    const chatHistoryList = document.getElementById('chatHistoryList');
    if (!chatHistoryList) return;

    // Show loading state
    chatHistoryList.innerHTML = '<div class="history-empty">Loading...</div>';

    try {
        // Try database API first
        const response = await fetch('/api/conversations?limit=50');

        if (response.ok) {
            const data = await response.json();
            const conversations = data.conversations || [];

            // Cache to localStorage
            const historyCache = conversations.map(conv => ({
                id: conv.id,
                timestamp: conv.updated_at || conv.created_at,
                preview: conv.preview || conv.title || 'New chat',
                messageCount: conv.message_count || 0
            }));
            localStorage.setItem('assistedVoiceChatHistory', JSON.stringify(historyCache));

            renderChatHistory(conversations.map(conv => ({
                id: conv.id,
                timestamp: conv.updated_at || conv.created_at,
                preview: conv.preview || conv.title || 'New chat'
            })));
            return;
        }
    } catch (error) {
        console.warn('Failed to load from database, using localStorage:', error);
    }

    // Fallback to localStorage
    const history = getChatHistoryFromLocalStorage();
    renderChatHistory(history);
}

/**
 * Render chat history to the sidebar
 */
function renderChatHistory(history) {
    const chatHistoryList = document.getElementById('chatHistoryList');
    if (!chatHistoryList) return;

    if (!history || history.length === 0) {
        chatHistoryList.innerHTML = '<div class="history-empty">No previous chats</div>';
        return;
    }

    let historyHTML = '';
    history.forEach(chat => {
        const date = new Date(chat.timestamp);
        const dateStr = date.toLocaleDateString();
        historyHTML += `
            <div class="history-item" data-chat-id="${chat.id}">
                <div class="history-item-content">
                    <div class="history-item-date">${dateStr}</div>
                    <div class="history-item-preview">${chat.preview || 'New chat'}</div>
                </div>
                <button class="history-item-delete" data-chat-id="${chat.id}" title="Delete conversation">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>
        `;
    });

    chatHistoryList.innerHTML = historyHTML;

    // Add click listeners for loading chats
    chatHistoryList.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't load chat if delete button was clicked
            if (e.target.closest('.history-item-delete')) {
                return;
            }
            loadChatFromHistory(item.dataset.chatId);
        });
    });

    // Add click listeners for delete buttons
    chatHistoryList.querySelectorAll('.history-item-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering the parent click
            const chatId = btn.dataset.chatId;
            deleteChatFromHistory(chatId);
        });
    });
}

/**
 * Load a specific chat from history
 */
async function loadChatFromHistory(chatId) {
    // Clear current chat first
    const messagesContainer = document.getElementById('messages');
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
        messagesContainer.classList.remove('active');
    }

    state.currentChatId = chatId;

    try {
        // Try database API first
        const response = await fetch(`/api/conversations/${chatId}`);

        if (response.ok) {
            const conversation = await response.json();

            const welcome = document.getElementById('welcome');
            if (welcome) welcome.style.display = 'none';
            if (messagesContainer) messagesContainer.classList.add('active');

            // Add messages to UI
            if (conversation.messages) {
                conversation.messages.forEach(msg => {
                    addMessage(msg.role, msg.content, false, msg.metadata || {});
                });
            }

            // Update localStorage cache
            localStorage.setItem('assistedVoiceConversation', JSON.stringify({
                version: 3,
                timestamp: Date.now(),
                chatId: chatId,
                messages: conversation.messages || []
            }));

            // Close menu
            closeSideMenu();
            return;
        }
    } catch (error) {
        console.warn('Failed to load from database, trying localStorage:', error);
    }

    // Fallback to localStorage
    const history = getChatHistoryFromLocalStorage();
    const chat = history.find(c => c.id === chatId);
    if (!chat || !chat.messages) {
        showToast('Conversation not found', 'error');
        return;
    }

    const welcome = document.getElementById('welcome');
    if (welcome) welcome.style.display = 'none';
    if (messagesContainer) messagesContainer.classList.add('active');

    chat.messages.forEach(msg => {
        addMessage(msg.role, msg.content, false, msg.metadata || {});
    });

    localStorage.setItem('assistedVoiceConversation', JSON.stringify({
        version: 3,
        timestamp: Date.now(),
        chatId: chatId,
        messages: chat.messages
    }));

    closeSideMenu();
}

/**
 * Delete a chat from history
 */
async function deleteChatFromHistory(chatId) {
    try {
        // Try database API first
        const response = await fetch(`/api/conversations/${chatId}`, {
            method: 'DELETE'
        });

        if (!response.ok && response.status !== 404) {
            console.warn('Database delete failed:', response.status);
        }
    } catch (error) {
        console.warn('Database delete failed:', error);
    }

    // Also remove from localStorage cache
    const history = getChatHistoryFromLocalStorage();
    const filteredHistory = history.filter(chat => chat.id !== chatId);
    localStorage.setItem('assistedVoiceChatHistory', JSON.stringify(filteredHistory));

    // Reload the chat history display
    loadChatHistory();

    showToast('Conversation deleted', 'success', 1500);
}

/**
 * Helper to close side menu
 */
function closeSideMenu() {
    const sideMenu = document.getElementById('sideMenu');
    const overlay = document.getElementById('overlay');
    if (sideMenu) sideMenu.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

// Keep getChatHistory for backward compatibility
function getChatHistory() {
    return getChatHistoryFromLocalStorage();
}

// Keep saveChatToHistory for backward compatibility (now just updates localStorage cache)
function saveChatToHistory(messages, chatId) {
    if (!messages || messages.length === 0) return;

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

    const history = getChatHistoryFromLocalStorage();
    const existingIndex = history.findIndex(chat => chat.id === id);

    if (existingIndex !== -1) {
        history[existingIndex] = chatData;
    } else {
        history.unshift(chatData);
    }

    if (history.length > 50) history.splice(50);

    localStorage.setItem('assistedVoiceChatHistory', JSON.stringify(history));
}

/**
 * Settings Listeners
 */
function setupSettingsListeners() {
    console.log('Setting up settings listeners...');
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPanel = document.getElementById('settingsPanel');
    const closeSettingsBtn = document.getElementById('closeSettings');
    const overlay = document.getElementById('overlay');

    if (settingsBtn) console.log('Settings button found');
    else console.error('Settings button NOT found');

    if (settingsPanel) console.log('Settings panel found');
    else console.error('Settings panel NOT found');

    if (settingsBtn && settingsPanel && overlay) {
        console.log('Adding settings listeners');
        settingsBtn.addEventListener('click', () => {
            console.log('Settings button clicked');
            settingsPanel.classList.add('open');
            overlay.classList.add('active');

            // Load fresh model data when settings panel opens
            loadAvailableModels();
        });
    }

    if (closeSettingsBtn && settingsPanel && overlay) {
        closeSettingsBtn.addEventListener('click', () => {
            settingsPanel.classList.remove('open');
            overlay.classList.remove('active');
        });
    }

    // Close on overlay click
    if (overlay && settingsPanel) {
        overlay.addEventListener('click', () => {
            if (settingsPanel.classList.contains('open')) {
                settingsPanel.classList.remove('open');
                overlay.classList.remove('active');
            }
        });
    }

    // AI Settings Controls
    setupAISettingsControls();

    // Server Settings Controls
    setupServerSettings();

    // TTS Controls
    setupTTSControls();

    // VAD Controls
    setupVADSettings();
}

/**
 * Theme Setup
 */
function setupTheme() {
    const themeButtons = document.querySelectorAll('.theme-btn');
    const savedTheme = localStorage.getItem('theme') || 'dark';

    document.documentElement.setAttribute('data-theme', savedTheme);

    // Initial button state
    themeButtons.forEach(btn => {
        if (btn.dataset.theme === savedTheme) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }

        btn.addEventListener('click', () => {
            const newTheme = btn.dataset.theme;
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);

            // Update active state
            themeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            showToast(`Theme changed to ${newTheme}`, 'info', 1000);
        });
    });
}

/**
 * Routing (Simple)
 */
function initializeRouting() {
    // Handle browser back/forward
    window.addEventListener('popstate', (event) => {
        // Simple routing logic if needed
    });
}

/**
 * Check mobile
 */
function checkMobile() {
    state.isMobile = window.innerWidth <= 768;
}

/**
 * Setup AI Settings Controls (Temperature, Max Tokens, System Prompt)
 */
export function setupAISettingsControls() {
    console.log('Setting up AI settings controls...');

    // Temperature Slider
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
            clearTimeout(tempDebounce);
            tempDebounce = setTimeout(() => {
                emit('update_temperature', { temperature: parseFloat(temp) });
                showToast(`Temperature set to ${temp}`, 'success', 1500);
            }, 300);
        });
        console.log('Temperature slider initialized');
    }

    // Max Tokens Input
    const maxTokensInput = document.getElementById('maxTokensInput');

    if (maxTokensInput) {
        // Load saved max tokens
        const savedMaxTokens = localStorage.getItem('aiMaxTokens') || '500';
        maxTokensInput.value = savedMaxTokens;

        // Handle max tokens changes
        maxTokensInput.addEventListener('change', (e) => {
            let maxTokens = parseInt(e.target.value);

            // Validate range
            if (maxTokens < 50) maxTokens = 50;
            if (maxTokens > 2000) maxTokens = 2000;
            e.target.value = maxTokens;

            localStorage.setItem('aiMaxTokens', maxTokens);

            // Send to backend
            emit('update_max_tokens', { max_tokens: maxTokens });
            showToast(`Max tokens set to ${maxTokens}`, 'success', 1500);
        });
        console.log('Max tokens input initialized');
    }

    // System Prompt Textarea
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
            clearTimeout(promptDebounceTimeout);
            promptDebounceTimeout = setTimeout(() => {
                const prompt = e.target.value;
                localStorage.setItem('aiSystemPrompt', prompt);

                // Send to backend
                emit('update_system_prompt', { system_prompt: prompt });
                showToast('System prompt updated', 'success', 1500);
            }, 500); // Wait 500ms after user stops typing
        });
        console.log('System prompt textarea initialized');
    }

    // Prompt templates dropdown
    if (promptTemplates && systemPromptTextarea) {
        promptTemplates.addEventListener('change', (e) => {
            const templateKey = e.target.value;
            if (templateKey && templates[templateKey]) {
                systemPromptTextarea.value = templates[templateKey];
                localStorage.setItem('aiSystemPrompt', templates[templateKey]);

                // Send to backend
                emit('update_system_prompt', { system_prompt: templates[templateKey] });
                showToast('System prompt updated', 'success', 1500);

                // Reset dropdown to placeholder
                promptTemplates.value = '';
            }
        });
        console.log('Prompt templates dropdown initialized');
    }

    // Reset prompt button
    if (resetPromptBtn && systemPromptTextarea) {
        resetPromptBtn.addEventListener('click', () => {
            systemPromptTextarea.value = defaultPrompt;
            localStorage.setItem('aiSystemPrompt', defaultPrompt);

            // Send to backend
            emit('update_system_prompt', { system_prompt: defaultPrompt });
            showToast('System prompt reset to default', 'success', 1500);
        });
        console.log('Reset prompt button initialized');
    }
}

/**
 * Setup TTS and Voice Controls
 */
export function setupTTSControls() {
    console.log('Setting up TTS controls...');

    const voiceSelect = document.getElementById('voiceSelect');
    const edgeVoiceSelect = document.getElementById('edgeVoiceSelect');
    const speechRateSlider = document.getElementById('speechRateSlider');
    const speechRateValue = document.getElementById('speechRateValue');
    const voicePitchSlider = document.getElementById('voicePitchSlider');
    const voicePitchValue = document.getElementById('voicePitchValue');
    const voiceVolumeSlider = document.getElementById('voiceVolumeSlider');
    const voiceVolumeValue = document.getElementById('voiceVolumeValue');
    const voicePreviewBtn = document.getElementById('voicePreviewBtn');
    const voiceSearchInput = document.getElementById('voiceSearchInput');

    // Engine Selection
    if (voiceSelect) {
        const savedEngine = localStorage.getItem('ttsEngine') || 'edge-tts';
        voiceSelect.value = savedEngine;
        state.currentTTSEngine = savedEngine;
        state.ttsEnabled = savedEngine !== 'none';

        voiceSelect.addEventListener('change', (e) => {
            const engine = e.target.value;
            state.currentTTSEngine = engine;
            state.ttsEnabled = engine !== 'none';
            localStorage.setItem('ttsEngine', engine);

            // Emit change to backend
            const voice = engine === 'edge-tts' ?
                (localStorage.getItem('edgeVoice') || 'en-US-JennyNeural') :
                (localStorage.getItem('macosVoice') || 'Samantha');

            emit('change_tts', { engine, voice });
            showToast(`TTS Engine changed to ${engine}`, 'success', 1500);

            // Toggle visibility of specific voice settings
            const edgeVoiceItem = document.getElementById('edgeVoiceSettingItem');
            const pitchItem = document.getElementById('voicePitchSettingItem');
            if (edgeVoiceItem) edgeVoiceItem.style.display = engine === 'edge-tts' ? 'block' : 'none';
            if (pitchItem) pitchItem.style.display = engine === 'edge-tts' ? 'block' : 'none';
        });

        // Trigger initial visibility
        setTimeout(() => voiceSelect.dispatchEvent(new Event('change')), 100);
    }

    // Edge Voice Selection
    if (edgeVoiceSelect) {
        const savedVoice = localStorage.getItem('edgeVoice') || 'en-US-JennyNeural';
        edgeVoiceSelect.value = savedVoice;

        edgeVoiceSelect.addEventListener('change', (e) => {
            const voice = e.target.value;
            localStorage.setItem('edgeVoice', voice);
            emit('update_voice', { voice });
            showToast(`Voice set to ${voice}`, 'success', 1000);
        });
    }

    // Voice Search
    if (voiceSearchInput && edgeVoiceSelect) {
        voiceSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const options = edgeVoiceSelect.querySelectorAll('option');
            const groups = edgeVoiceSelect.querySelectorAll('optgroup');

            options.forEach(opt => {
                const text = opt.textContent.toLowerCase();
                const val = opt.value.toLowerCase();
                const isMatch = text.includes(query) || val.includes(query);
                opt.style.display = isMatch ? '' : 'none';
            });

            // Hide empty optgroups
            groups.forEach(group => {
                const visibleOptions = group.querySelectorAll('option:not([style*="display: none"])');
                group.style.display = visibleOptions.length > 0 ? '' : 'none';
            });
        });
    }

    // Speech Rate
    if (speechRateSlider && speechRateValue) {
        const savedRate = localStorage.getItem('ttsRate') || '1.0';
        speechRateSlider.value = savedRate;
        speechRateValue.textContent = `${savedRate}x`;

        speechRateSlider.addEventListener('input', (e) => {
            const rate = e.target.value;
            speechRateValue.textContent = `${rate}x`;
            localStorage.setItem('ttsRate', rate);

            // Convert to edge-tts format ("+0%", "+50%", etc.)
            const percent = Math.round((parseFloat(rate) - 1.0) * 100);
            const formattedRate = (percent >= 0 ? '+' : '') + percent + '%';
            emit('update_speech_rate', { rate: formattedRate });
        });
    }

    // Voice Pitch
    if (voicePitchSlider && voicePitchValue) {
        const savedPitch = localStorage.getItem('ttsPitch') || '0';
        voicePitchSlider.value = savedPitch;
        voicePitchValue.textContent = (parseInt(savedPitch) >= 0 ? '+' : '') + savedPitch + 'Hz';

        voicePitchSlider.addEventListener('input', (e) => {
            const pitch = e.target.value;
            voicePitchValue.textContent = (parseInt(pitch) >= 0 ? '+' : '') + pitch + 'Hz';
            localStorage.setItem('ttsPitch', pitch);
            emit('update_voice_pitch', { pitch: voicePitchValue.textContent });
        });
    }

    // Voice Volume
    if (voiceVolumeSlider && voiceVolumeValue) {
        const savedVol = localStorage.getItem('voiceVolume') || '100';
        voiceVolumeSlider.value = savedVol;
        voiceVolumeValue.textContent = `${savedVol}%`;

        voiceVolumeSlider.addEventListener('input', (e) => {
            const vol = e.target.value;
            voiceVolumeValue.textContent = `${vol}%`;
            localStorage.setItem('voiceVolume', vol);
            // Volume is used client-side, but we can emit it too
            emit('update_voice_volume', { volume: vol });
        });
    }

    // Voice Preview
    if (voicePreviewBtn) {
        voicePreviewBtn.addEventListener('click', () => {
            const voice = edgeVoiceSelect ? edgeVoiceSelect.value : 'en-US-JennyNeural';
            const text = "Hello! This is a preview of the selected voice.";
            showToast(`Previewing ${voice}...`, 'info', 2000);
            emit('preview_voice', { voice, text });
        });
    }

    // Voice Favorite
    const voiceFavoriteBtn = document.getElementById('voiceFavoriteBtn');
    if (voiceFavoriteBtn) {
        // Initial state
        const savedFavorite = localStorage.getItem('favoriteVoice') === (edgeVoiceSelect ? edgeVoiceSelect.value : '');
        if (savedFavorite) voiceFavoriteBtn.classList.add('active');

        voiceFavoriteBtn.addEventListener('click', () => {
            const currentVoice = edgeVoiceSelect ? edgeVoiceSelect.value : '';
            if (!currentVoice) return;

            const isFavorite = voiceFavoriteBtn.classList.contains('active');
            if (isFavorite) {
                voiceFavoriteBtn.classList.remove('active');
                localStorage.removeItem('favoriteVoice');
                showToast('Removed from favorites', 'info', 1000);
            } else {
                voiceFavoriteBtn.classList.add('active');
                localStorage.setItem('favoriteVoice', currentVoice);
                showToast('Added to favorites!', 'success', 1000);
            }
        });
    }
}


/**
 * Setup server configuration controls
 */
export function setupServerSettings() {
    console.log('Setting up server settings controls...');

    const serverTypeSelect = document.getElementById('serverTypeSelect');
    const serverHost = document.getElementById('serverHost');
    const serverPort = document.getElementById('serverPort');
    const testConnectionBtn = document.getElementById('testConnectionBtn');
    const connectionStatus = document.getElementById('connectionStatus');

    // Server type dropdown
    if (serverTypeSelect) {
        const savedServerType = localStorage.getItem('serverType') || 'lm-studio';
        serverTypeSelect.value = savedServerType;

        serverTypeSelect.addEventListener('change', (e) => {
            const serverType = e.target.value;
            localStorage.setItem('serverType', serverType);
            emit('update_server_config', { type: serverType });
            showToast(`Server type changed to ${serverType}`, 'success', 2000);
        });
        console.log('Server type dropdown initialized');
    }

    // Server host input
    if (serverHost) {
        serverHost.addEventListener('change', (e) => {
            const host = e.target.value;
            localStorage.setItem('serverHost', host);
            emit('update_server_config', { host: host });
            showToast(`Server host updated to ${host}`, 'success', 2000);
        });
    }

    // Server port input
    if (serverPort) {
        serverPort.addEventListener('change', (e) => {
            const port = parseInt(e.target.value);
            localStorage.setItem('serverPort', port);
            emit('update_server_config', { port: port });
            showToast(`Server port updated to ${port}`, 'success', 2000);
        });
    }

    // Test connection button
    if (testConnectionBtn && connectionStatus) {
        testConnectionBtn.addEventListener('click', async () => {
            console.log('Testing connection...');
            connectionStatus.textContent = 'Testing...';
            connectionStatus.className = 'connection-status testing';
            testConnectionBtn.disabled = true;

            try {
                const response = await fetch('/api/test-connection', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                const data = await response.json();

                if (data.success) {
                    connectionStatus.textContent = `✓ ${data.message}`;
                    connectionStatus.className = 'connection-status success';
                    showToast('Connection successful!', 'success', 2000);
                } else {
                    connectionStatus.textContent = `✗ ${data.error}`;
                    connectionStatus.className = 'connection-status error';
                    showToast('Connection failed', 'error', 2000);
                }
            } catch (error) {
                console.error('Connection test error:', error);
                connectionStatus.textContent = '✗ Connection failed';
                connectionStatus.className = 'connection-status error';
                showToast('Connection test failed', 'error', 2000);
            } finally {
                testConnectionBtn.disabled = false;
            }
        });
        console.log('Test connection button initialized');
    }
}

/**
 * Setup VAD Settings Controls
 */
export function setupVADSettings() {
    console.log('Setting up VAD settings controls...');

    const vadEnabled = document.getElementById('vadEnabled');
    const vadModeSlider = document.getElementById('vadModeSlider');
    const vadModeValue = document.getElementById('vadModeValue');
    const vadTimeoutSlider = document.getElementById('vadTimeoutSlider');
    const vadTimeoutValue = document.getElementById('vadTimeoutValue');

    if (vadEnabled) {
        vadEnabled.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            emit('update_vad_config', { enabled });
            showToast(`VAD ${enabled ? 'enabled' : 'disabled'}`, 'success', 1500);
        });
    }

    if (vadModeSlider && vadModeValue) {
        vadModeSlider.addEventListener('input', (e) => {
            const mode = parseInt(e.target.value);
            vadModeValue.textContent = mode;

            // Debounce backend update
            clearTimeout(window.vadModeDebounce);
            window.vadModeDebounce = setTimeout(() => {
                emit('update_vad_config', { mode });
                showToast(`VAD Sensitivity set to ${mode}`, 'success', 1000);
            }, 300);
        });
    }

    if (vadTimeoutSlider && vadTimeoutValue) {
        vadTimeoutSlider.addEventListener('input', (e) => {
            const timeout = parseFloat(e.target.value);
            vadTimeoutValue.textContent = timeout + 's';

            // Debounce backend update
            clearTimeout(window.vadTimeoutDebounce);
            window.vadTimeoutDebounce = setTimeout(() => {
                emit('update_vad_config', { speech_timeout: timeout });
                showToast(`VAD Timeout set to ${timeout}s`, 'success', 1000);
            }, 300);
        });
    }
}

/**
 * Placeholder functions for features not fully implemented in this refactor
 * but required for completeness based on app.js analysis
 */
function initializePhase3Features() {
    // Reactions, Swipe, VAD, Virtual Scroll would go here
    // For now, we keep it simple
}

function setupTutorial() {
    // Tutorial logic
}

function setupExportFeature() {
    const modal = document.getElementById('exportModal');
    const openBtn = document.getElementById('exportChatBtn');
    const closeBtn = document.getElementById('closeExportModal');

    // Export format buttons
    const btnMarkdown = document.getElementById('exportMarkdownBtn');
    const btnJSON = document.getElementById('exportJSONBtn');
    const btnText = document.getElementById('exportPlainTextBtn');

    if (!modal || !openBtn) return;

    openBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
        // Hide sidebar on mobile if needed, or close menu
        const sideMenu = document.getElementById('sideMenu');
        const overlay = document.getElementById('overlay');
        if (sideMenu) sideMenu.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
    });

    const closeModal = () => {
        modal.style.display = 'none';
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    window.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    function getMessages() {
        const elements = document.querySelectorAll('#messages .message');
        return Array.from(elements).map(el => {
            const role = el.classList.contains('user') ? 'user' : 'assistant';
            // Use original text derived from markdown if possible, but innerText is fine for now
            const content = el.querySelector('.message-content')?.innerText || '';
            // Clean up content (remove copy buttons text if any)
            const time = el.querySelector('.message-time')?.innerText.split('•')[0].trim() || '';
            return { role, content, time };
        });
    }

    function downloadFile(content, filename, contentType) {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`Exported to ${filename}`, 'success');
    }

    if (btnMarkdown) {
        btnMarkdown.addEventListener('click', () => {
            const msgs = getMessages();
            if (msgs.length === 0) {
                showToast('No messages to export', 'warning');
                return;
            }
            const text = msgs.map(m => `### ${m.role === 'user' ? 'User' : 'Assistant'} (${m.time})\n\n${m.content}\n`).join('\n---\n\n');
            downloadFile(text, 'chat-export.md', 'text/markdown');
            closeModal();
        });
    }

    if (btnJSON) {
        btnJSON.addEventListener('click', () => {
            const msgs = getMessages();
            if (msgs.length === 0) {
                showToast('No messages to export', 'warning');
                return;
            }
            downloadFile(JSON.stringify(msgs, null, 2), 'chat-export.json', 'application/json');
            closeModal();
        });
    }

    if (btnText) {
        btnText.addEventListener('click', () => {
            const msgs = getMessages();
            if (msgs.length === 0) {
                showToast('No messages to export', 'warning');
                return;
            }
            const text = msgs.map(m => `[${m.role.toUpperCase()} ${m.time}]: ${m.content}`).join('\n\n');
            downloadFile(text, 'chat-export.txt', 'text/plain');
            closeModal();
        });
    }
}

function setupConversationSearch() {
    const searchWrapper = document.getElementById('conversationSearchWrapper');
    const searchInput = document.getElementById('conversationSearch');
    const toggleBtn = document.getElementById('searchToggleBtn');
    const closeBtn = document.getElementById('closeSearchBtn');
    const clearBtn = document.getElementById('clearSearchBtn');

    if (!toggleBtn || !searchWrapper || !searchInput) return;

    // Toggle Search Bar
    toggleBtn.addEventListener('click', () => {
        const isVisible = searchWrapper.style.display !== 'none';
        searchWrapper.style.display = isVisible ? 'none' : 'flex';
        if (!isVisible) {
            setTimeout(() => searchInput.focus(), 100);
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            searchWrapper.style.display = 'none';
            searchInput.value = '';
            filterMessages('');
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            filterMessages('');
            clearBtn.style.display = 'none';
            searchInput.focus();
        });
    }

    // Input handler
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        filterMessages(query);
        if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';
    });

    function filterMessages(query) {
        const messages = document.querySelectorAll('#messages .message');
        messages.forEach(msg => {
            const content = msg.querySelector('.message-content')?.innerText.toLowerCase() || '';
            if (query && !content.includes(query)) {
                msg.style.display = 'none';
            } else {
                msg.style.display = 'flex';
            }
        });
    }

    // ESC to close
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            searchWrapper.style.display = 'none';
            searchInput.value = '';
            filterMessages('');
        }
    });
}

function setupShortcutsModal() {
    const modal = document.getElementById('shortcutsModal');
    const closeBtn = document.getElementById('closeShortcuts');

    if (!modal) return;

    const openModal = () => {
        modal.style.display = 'flex';
    };

    const closeModal = () => {
        modal.style.display = 'none';
    };

    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    window.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Toggle shortcuts with '?' (Shift + /)
        if (e.key === '?' && !e.ctrlKey && !e.altKey && !e.metaKey) {
            // Don't trigger if user is typing in an input
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

            const isVisible = modal.style.display === 'flex';
            if (isVisible) closeModal();
            else openModal();
        }

        // Close on ESC
        if (e.key === 'Escape') {
            closeModal();
        }
    });
}

function setupProgressiveSettings() {
    const basicBtn = document.getElementById('basicModeBtn');
    const advancedBtn = document.getElementById('advancedModeBtn');
    const settingsPanel = document.getElementById('settingsPanel');

    if (!basicBtn || !advancedBtn || !settingsPanel) return;

    const setLevel = (level) => {
        localStorage.setItem('settingsLevel', level);

        // Update buttons
        if (level === 'basic') {
            basicBtn.classList.add('active');
            advancedBtn.classList.remove('active');
            settingsPanel.classList.add('basic-mode');
            settingsPanel.classList.remove('advanced-mode');
        } else {
            basicBtn.classList.remove('active');
            advancedBtn.classList.add('active');
            settingsPanel.classList.add('advanced-mode');
            settingsPanel.classList.remove('basic-mode');
        }

        // Filter items
        const items = settingsPanel.querySelectorAll('.setting-item, .settings-section');
        items.forEach(item => {
            const itemLevel = item.dataset.settingsLevel || 'advanced';
            if (level === 'basic' && itemLevel === 'advanced') {
                item.style.display = 'none';
            } else {
                item.style.display = '';
            }
        });
    };

    basicBtn.addEventListener('click', () => {
        setLevel('basic');
        showToast('Switched to Basic Settings', 'info', 1000);
    });

    advancedBtn.addEventListener('click', () => {
        setLevel('advanced');
        showToast('Switched to Advanced Settings', 'info', 1000);
    });

    // Initial state
    const savedLevel = localStorage.getItem('settingsLevel') || 'basic';
    setLevel(savedLevel);
}

function updateVADStatus(status) {
    // VAD status update
}



/**
 * Media player state
 */
let mediaPlayerInterval = null;
let currentMediaAudio = null;

export function showMiniPlayer(audio, text, options = {}) {
    console.log('showMiniPlayer called');

    const modal = document.getElementById('mediaControlModal');
    const playPauseBtn = document.getElementById('mediaPlayPauseBtn');
    const playIcon = playPauseBtn?.querySelector('.play-icon');
    const pauseIcon = playPauseBtn?.querySelector('.pause-icon');
    const closeBtn = document.getElementById('mediaCloseBtn');
    const prevBtn = document.getElementById('mediaPrevBtn');
    const nextBtn = document.getElementById('mediaNextBtn');
    const progressBar = document.getElementById('mediaProgressBar');
    const progressFill = document.getElementById('mediaProgressFill');
    const progressHandle = document.getElementById('mediaProgressHandle');
    const timeCurrent = document.getElementById('mediaTimeCurrent');
    const timeTotal = document.getElementById('mediaTimeTotal');
    const volumeSlider = document.getElementById('mediaVolumeSlider');
    const volumeValue = document.getElementById('mediaVolumeValue');

    if (!modal || !audio) return;

    // Store reference to current audio
    currentMediaAudio = audio;

    // Show modal
    modal.style.display = 'block';

    // Navigation buttons
    if (prevBtn) {
        prevBtn.style.display = options.onPrev ? 'flex' : 'none';
        prevBtn.onclick = (e) => {
            e.stopPropagation();
            if (options.onPrev) options.onPrev();
        };
    }
    if (nextBtn) {
        nextBtn.style.display = options.onNext ? 'flex' : 'none';
        nextBtn.onclick = (e) => {
            e.stopPropagation();
            if (options.onNext) options.onNext();
        };
    }

    // Format time helper
    const formatTime = (seconds) => {
        if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Update progress
    const updateProgress = () => {
        if (!audio || audio.paused || audio.ended) return;

        const progress = (audio.currentTime / audio.duration) * 100;
        if (progressFill) progressFill.style.width = `${progress}%`;
        if (progressHandle) progressHandle.style.left = `${progress}%`;
        if (timeCurrent) timeCurrent.textContent = formatTime(audio.currentTime);
        if (timeTotal) timeTotal.textContent = formatTime(audio.duration);
    };

    // Set initial volume from slider
    const savedVolume = parseInt(localStorage.getItem('voiceVolume') || '100');
    if (volumeSlider) volumeSlider.value = savedVolume;
    if (volumeValue) volumeValue.textContent = `${savedVolume}%`;
    audio.volume = savedVolume / 100;

    // Play/Pause button
    if (playPauseBtn) {
        playPauseBtn.onclick = () => {
            if (audio.paused) {
                audio.play();
                if (playIcon) playIcon.style.display = 'none';
                if (pauseIcon) pauseIcon.style.display = 'block';
            } else {
                audio.pause();
                if (playIcon) playIcon.style.display = 'block';
                if (pauseIcon) pauseIcon.style.display = 'none';
            }
        };
    }

    // Close button
    if (closeBtn) {
        closeBtn.onclick = () => {
            audio.pause();
            audio.currentTime = 0;
            hideMiniPlayer();
            if (state.currentAudio === audio) {
                state.currentAudio = null;
            }
            if (options.onStop) options.onStop();
        };
    }

    // Progress bar click to seek
    if (progressBar) {
        progressBar.onclick = (e) => {
            const rect = progressBar.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percentage = clickX / rect.width;
            audio.currentTime = percentage * audio.duration;
            updateProgress();
        };
    }

    // Volume slider
    if (volumeSlider) {
        volumeSlider.oninput = (e) => {
            const volume = parseInt(e.target.value);
            audio.volume = volume / 100;
            if (volumeValue) volumeValue.textContent = `${volume}%`;
            localStorage.setItem('voiceVolume', volume);
        };
    }

    // Audio event listeners
    // We use a named function to be able to remove it if needed, 
    // but here we just re-add as showMiniPlayer is usually called once per audio object
    audio.onloadedmetadata = () => {
        if (timeTotal) timeTotal.textContent = formatTime(audio.duration);
    };

    audio.onplay = () => {
        if (playIcon) playIcon.style.display = 'none';
        if (pauseIcon) pauseIcon.style.display = 'block';

        // Start progress update interval
        if (mediaPlayerInterval) clearInterval(mediaPlayerInterval);
        mediaPlayerInterval = setInterval(updateProgress, 100);
    };

    audio.onpause = () => {
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';

        if (mediaPlayerInterval) {
            clearInterval(mediaPlayerInterval);
            mediaPlayerInterval = null;
        }
    };

    audio.onended = () => {
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';

        if (mediaPlayerInterval) {
            clearInterval(mediaPlayerInterval);
            mediaPlayerInterval = null;
        }

        // Auto-hide after a short delay for normal messages
        // But for reading mode, we might want to keep it or wait for next chunk
        if (!options.onNext) {
            setTimeout(() => {
                if (audio.ended) hideMiniPlayer();
            }, 1000);
        }
    };

    // Initial progress update
    updateProgress();
}

export function hideMiniPlayer() {
    console.log('hideMiniPlayer called');

    const modal = document.getElementById('mediaControlModal');
    if (modal) {
        modal.style.display = 'none';
    }

    // Clear interval
    if (mediaPlayerInterval) {
        clearInterval(mediaPlayerInterval);
        mediaPlayerInterval = null;
    }

    // Clear audio reference
    currentMediaAudio = null;
}


function clearLiveUI() {
    // Clear live UI
}

function showAudioPlayingIndicator() {
    // Audio indicator
}

function showClickToPlayMessage() {
    showToast('Click to play audio', 'info');
}

// Add reaction buttons (placeholder)
function addReactionButtons(messageDiv, messageId) {
    // Add buttons
}

// Observe new message (placeholder)
function observeNewMessage(messageDiv) {
    // Observe
}

/**
 * Update image upload button visibility based on model capabilities
 */
function updateUploadButtonVisibility() {
    const uploadBtn = document.getElementById('imageUploadBtn');
    if (!uploadBtn) return;

    if (!state.currentModel || !state.availableModels) {
        uploadBtn.style.display = ''; // Default visible
        return;
    }

    const modelInfo = state.availableModels.find(m => m.name === state.currentModel);
    const hasVision = modelInfo && modelInfo.capabilities && modelInfo.capabilities.includes('vision');

    if (hasVision) {
        uploadBtn.style.display = '';
        console.log(`Model ${state.currentModel} has vision. Showing upload button.`);
    } else {
        uploadBtn.style.display = 'none';
        console.log(`Model ${state.currentModel} lacks vision. Hiding upload button.`);
    }
}
