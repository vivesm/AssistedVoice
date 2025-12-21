/**
 * Audio handling module for AssistedVoice
 */
import { state } from './state.js';
import { logRequest, logResponse, showToast } from './utils.js';

// Helper to safely call UI updates
function updateStatus(message, type) {
    if (state.ui && state.ui.updateStatus) {
        state.ui.updateStatus(message, type);
    }
}

function showError(message) {
    if (state.ui && state.ui.showError) {
        state.ui.showError(message);
    }
}

function showMiniPlayer(audio, text) {
    if (state.ui && state.ui.showMiniPlayer) {
        state.ui.showMiniPlayer(audio, text);
    }
}

function hideMiniPlayer() {
    if (state.ui && state.ui.hideMiniPlayer) {
        state.ui.hideMiniPlayer();
    }
}

/**
 * Start recording audio - SIMPLEST POSSIBLE IMPLEMENTATION
 */
export async function startRecording() {
    try {
        state.audioChunks = [];

        // Get microphone - simplest constraints
        state.audioStream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });

        console.log('PTT: Simple MediaRecorder starting');

        // Create MediaRecorder - let browser decide everything
        state.mediaRecorder = new MediaRecorder(state.audioStream);

        state.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                state.audioChunks.push(event.data);
            }
        };

        state.mediaRecorder.onstop = () => {
            const audioBlob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType });
            console.log(`PTT: Blob ${audioBlob.size} bytes, type: ${audioBlob.type}`);

            // Send
            const reader = new FileReader();
            reader.onloadend = () => {
                state.messageStartTime = Date.now();
                state.firstTokenTime = null;
                state.tokenCount = 0;

                if (state.socket) {
                    state.socket.emit('process_audio', {
                        audio: reader.result,
                        enable_tts: state.ttsEnabled,
                        conversation_id: state.currentChatId
                    });
                }
            };
            reader.readAsDataURL(audioBlob);

            // Cleanup
            state.audioStream.getTracks().forEach(track => track.stop());
            state.audioStream = null;
            state.audioChunks = [];
        };

        state.mediaRecorder.start();
        state.isRecording = true;

        // UI
        const voiceBtn = document.getElementById('voiceBtn');
        if (voiceBtn) {
            voiceBtn.classList.add('recording');
            document.body.classList.add('recording');
        }
        const recordingIndicator = voiceBtn?.querySelector('.recording-indicator');
        if (recordingIndicator) recordingIndicator.style.display = 'flex';
        const micIcon = voiceBtn?.querySelector('.mic-icon');
        if (micIcon) micIcon.style.display = 'none';

        updateStatus('Recording...', 'recording');

    } catch (err) {
        console.error('PTT:', err);
        showError('Failed to start recording: ' + err.message);
    }
}

/**
 * Stop recording
 */
export function stopRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
        state.mediaRecorder.stop();
    }
    state.isRecording = false;

    // UI
    const voiceBtn = document.getElementById('voiceBtn');
    if (voiceBtn) {
        voiceBtn.classList.remove('recording');
        document.body.classList.remove('recording');
    }
    const recordingIndicator = voiceBtn?.querySelector('.recording-indicator');
    if (recordingIndicator) recordingIndicator.style.display = 'none';
    const micIcon = voiceBtn?.querySelector('.mic-icon');
    if (micIcon) micIcon.style.display = 'block';

    updateStatus('Processing...', 'processing');
}

/**
 * Start live assistant mode
 */
export async function startLiveMode() {
    try {
        console.log('Starting live assistant mode...');
        showToast('Activating live mode...', 'info');

        // Clear old content
        if (state.ui && state.ui.clearLiveUI) state.ui.clearLiveUI();

        // Get audio stream
        state.liveAudioStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        // Create AudioContext
        state.liveAudioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
        });

        // Create media stream source
        const source = state.liveAudioContext.createMediaStreamSource(state.liveAudioStream);

        // Load and create AudioWorklet processor
        console.log('[Live Mode] Loading audio-processor.js...');
        await state.liveAudioContext.audioWorklet.addModule('/static/audio-processor.js');
        state.liveAudioWorklet = new AudioWorkletNode(state.liveAudioContext, 'audio-processor');
        console.log('[Live Mode] AudioWorkletNode created');

        // Handle PCM data
        state.liveAudioWorklet.port.onmessage = (event) => {
            if (!state.isLiveMode) return;

            const pcmFloat32 = event.data;
            // Calculate RMS for client-side silence detection (threshold: 0.0005)
            let sum = 0;
            for (let i = 0; i < pcmFloat32.length; i++) sum += Math.abs(pcmFloat32[i]);
            const rms = sum / pcmFloat32.length;

            if (rms < 0.0005) {
                // Skip sending silent chunk
                return;
            }



            const base64PCM = arrayBufferToBase64(pcmFloat32.buffer);

            if (state.socket && state.socket.connected) {
                state.socket.emit('live_pcm_chunk', {
                    audio: base64PCM,
                    sampleRate: 16000,
                    channels: 1,
                    timestamp: Date.now()
                });
            }
        };


        source.connect(state.liveAudioWorklet);
        state.isLiveMode = true;

        // Start visualization for live mode too
        initAudioVisualization(state.liveAudioStream);

        console.log('[Live Mode] Audio pipeline connected, listening for PCM chunks...');

        // Update UI
        const liveModeBtn = document.getElementById('liveModeBtn');
        const messagesContainer = document.getElementById('messages');
        const liveAssistantContainer = document.getElementById('liveAssistantContainer');

        if (liveModeBtn) liveModeBtn.classList.add('active');
        if (messagesContainer) messagesContainer.style.display = 'none';
        if (liveAssistantContainer) liveAssistantContainer.style.display = 'grid';

        updateStatus('Live mode active - continuous listening', 'ready');
        showToast('Live mode activated! Speak naturally. Click LIVE button again to exit.', 'success', 4000);

    } catch (error) {
        console.error('Error starting live mode:', error);

        // Provide user-friendly error messages
        let errorMessage = 'Failed to start live mode';
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage = 'Microphone access denied. Please allow microphone permissions and try again.';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'No microphone found. Please connect a microphone and try again.';
        } else if (error.message) {
            errorMessage += ': ' + error.message;
        }

        showToast(errorMessage, 'error', 5000);
        showError(errorMessage);
        stopLiveMode();
    }
}

/**
 * Stop live assistant mode
 */
export function stopLiveMode() {
    console.log('Stopping live assistant mode...');

    if (state.liveAudioWorklet) {
        state.liveAudioWorklet.port.postMessage({ command: 'stop' });
        state.liveAudioWorklet.disconnect();
        state.liveAudioWorklet = null;
    }

    if (state.liveAudioContext) {
        state.liveAudioContext.close();
        state.liveAudioContext = null;
    }

    if (state.liveAudioStream) {
        state.liveAudioStream.getTracks().forEach(track => track.stop());
        state.liveAudioStream = null;
    }

    state.isLiveMode = false;

    // Stop visualization
    stopAudioVisualization();

    // Update UI
    const liveModeBtn = document.getElementById('liveModeBtn');
    const messagesContainer = document.getElementById('messages');
    const liveAssistantContainer = document.getElementById('liveAssistantContainer');

    if (liveModeBtn) liveModeBtn.classList.remove('active');
    if (messagesContainer) messagesContainer.style.display = 'block';
    if (liveAssistantContainer) liveAssistantContainer.style.display = 'none';

    if (state.socket) {
        state.socket.emit('clear_live_assistant');
    }

    updateStatus('Ready', 'ready');
    showToast('Live mode deactivated', 'info');
}

/**
 * Toggle live assistant mode
 */
export function toggleLiveMode() {
    if (state.isLiveMode) {
        stopLiveMode();
    } else {
        startLiveMode();
    }
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Initialize audio visualization
 */
export function initAudioVisualization(stream) {
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        state.audioContext = new AudioContextClass();
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 64;
        state.analyser.smoothingTimeConstant = 0.8;

        const source = state.audioContext.createMediaStreamSource(stream);
        source.connect(state.analyser);

        const visualizer = document.getElementById('audioVisualizer');
        if (visualizer) {
            state.audioBars = Array.from(visualizer.querySelectorAll('.audio-bar'));
            visualizer.style.display = 'flex';
        }

        animateAudioBars();

    } catch (error) {
        console.error('Error initializing audio visualization:', error);
    }
}

/**
 * Animate audio bars
 */
function animateAudioBars() {
    if (!state.analyser || state.audioBars.length === 0) return;

    const dataArray = new Uint8Array(state.analyser.frequencyBinCount);
    state.analyser.getByteFrequencyData(dataArray);

    state.audioBars.forEach((bar, index) => {
        const dataIndex = Math.floor((index / state.audioBars.length) * dataArray.length);
        const value = dataArray[dataIndex];
        const height = Math.max(6, (value / 255) * 24);
        bar.style.height = `${height}px`;
        const opacity = 0.4 + (value / 255) * 0.6;
        bar.style.opacity = opacity;
    });

    state.animationFrameId = requestAnimationFrame(animateAudioBars);
}

/**
 * Stop audio visualization
 */
export function stopAudioVisualization() {
    if (state.animationFrameId) {
        cancelAnimationFrame(state.animationFrameId);
        state.animationFrameId = null;
    }

    if (state.audioContext) {
        state.audioContext.close();
        state.audioContext = null;
        state.analyser = null;
    }

    const visualizer = document.getElementById('audioVisualizer');
    if (visualizer) {
        visualizer.style.display = 'none';
    }

    state.audioBars = [];
}

/**
 * Stop currently playing audio
 */
export function stopAudio() {
    if (state.currentAudio) {
        state.currentAudio.pause();
        state.currentAudio.currentTime = 0;
        state.currentAudio = null;
    }

    if (window.pendingAudio) {
        window.pendingAudio = null;
    }

    state.audioQueue = [];
    state.isPlayingAudio = false;

    document.querySelectorAll('.message.speaking').forEach(msg => {
        msg.classList.remove('speaking');
    });

    updateStatus('Ready', 'ready');
    showToast('Audio playback stopped', 'info', 1500);
}

/**
 * Play audio data received from server
 */
export function playAudioData(audioDataUrl) {
    try {
        console.log('playAudioData called with:', {
            isDataUrl: audioDataUrl?.startsWith('data:audio'),
            length: audioDataUrl?.length,
            preview: audioDataUrl?.substring(0, 100)
        });

        if (!audioDataUrl.startsWith('data:audio')) {
            console.error('Invalid audio data URL format:', audioDataUrl?.substring(0, 100));
            return;
        }

        if (state.currentAudio) {
            console.log('Stopping previous audio');
            state.currentAudio.pause();
            state.currentAudio.currentTime = 0;
            state.currentAudio = null;
        }

        const audio = new Audio(audioDataUrl);
        audio.dataset.ttsAudio = 'true';

        const savedVolume = parseInt(localStorage.getItem('voiceVolume') || '100');
        audio.volume = savedVolume / 100;
        console.log('Audio volume set to:', audio.volume);

        state.currentAudio = audio;

        showMiniPlayer(audio, '');

        audio.addEventListener('ended', () => {
            console.log('Audio playback ended');
            if (state.currentAudio === audio) {
                state.currentAudio = null;
                updateStatus('Ready', 'ready');
                hideMiniPlayer();
            }
        });

        audio.addEventListener('error', (e) => {
            console.error('Audio playback error:', e);
            if (state.currentAudio === audio) {
                state.currentAudio = null;
                updateStatus('Ready', 'ready');
                hideMiniPlayer();
            }
            showToast('Audio playback error', 'error');
        });

        console.log('Attempting to play audio...');
        audio.play().then(() => {
            console.log('Audio playing successfully');
            updateStatus('Playing audio...', 'ready');
            showToast('Playing audio...', 'info');
        }).catch(err => {
            console.error('Audio play failed:', err.name, err.message);
            if (state.currentAudio === audio) {
                state.currentAudio = null;
            }

            if (err.name === 'NotAllowedError') {
                console.warn('Autoplay blocked - waiting for user interaction');
                showToast('Click anywhere to play audio', 'info', 3000);
                window.pendingAudio = audio;
                document.addEventListener('click', function playPendingAudio() {
                    if (window.pendingAudio) {
                        console.log('Retrying audio play after user interaction');
                        window.pendingAudio.play().catch(e => console.error('Retry play error:', e));
                        window.pendingAudio = null;
                        document.removeEventListener('click', playPendingAudio);
                    }
                }, { once: true });
            }
        });

    } catch (err) {
        console.error('Error in playAudioData:', err);
        if (state.currentAudio) {
            state.currentAudio = null;
        }
    }
}

/**
 * Play next audio in queue
 */
export function playNextInQueue() {
    if (state.audioQueue.length === 0) {
        state.isPlayingAudio = false;
        return;
    }

    state.isPlayingAudio = true;
    const audioDataUrl = state.audioQueue.shift();

    const audio = new Audio(audioDataUrl);
    audio.volume = 1.0;

    audio.addEventListener('ended', () => {
        playNextInQueue();
    });

    audio.addEventListener('error', (e) => {
        playNextInQueue();
    });

    const playPromise = audio.play();

    if (playPromise !== undefined) {
        playPromise.then(() => {
            if (state.ui && state.ui.showAudioPlayingIndicator) {
                state.ui.showAudioPlayingIndicator();
            }
        }).catch(err => {
            state.isPlayingAudio = false;

            if (err.name === 'NotAllowedError') {
                if (state.ui && state.ui.showClickToPlayMessage) {
                    state.ui.showClickToPlayMessage();
                }
                window.pendingAudioQueue = state.audioQueue;
                window.pendingAudioQueue.unshift(audioDataUrl);
                state.audioQueue = [];
            }
        });
    }
}

/**
 * Toggle mute state
 */
export function toggleMute() {
    const muteBtn = document.getElementById('muteBtn');
    const speakerOnIcon = muteBtn?.querySelector('.speaker-on-icon');
    const speakerOffIcon = muteBtn?.querySelector('.speaker-off-icon');

    if (state.ttsEnabled) {
        localStorage.setItem('previousTTSEngine', state.currentTTSEngine);

        state.ttsEnabled = false;
        state.currentTTSEngine = 'none';

        if (muteBtn) muteBtn.classList.add('muted');
        if (speakerOnIcon) speakerOnIcon.style.display = 'none';
        if (speakerOffIcon) speakerOffIcon.style.display = 'block';

        const voiceSelect = document.getElementById('voiceSelect');
        if (voiceSelect) voiceSelect.value = 'none';

        if (state.socket) {
            state.socket.emit('change_tts', { engine: 'none' });
        }

        localStorage.setItem('ttsEngine', 'none');
        localStorage.setItem('isMuted', 'true');

        updateStatus('Voice output muted', 'ready');
    } else {
        const previousEngine = localStorage.getItem('previousTTSEngine') || 'edge-tts';

        state.ttsEnabled = true;
        state.currentTTSEngine = previousEngine;

        if (muteBtn) muteBtn.classList.remove('muted');
        if (speakerOnIcon) speakerOnIcon.style.display = 'block';
        if (speakerOffIcon) speakerOffIcon.style.display = 'none';

        const voiceSelect = document.getElementById('voiceSelect');
        if (voiceSelect) voiceSelect.value = previousEngine;

        if (state.socket) {
            state.socket.emit('change_tts', { engine: previousEngine });
        }

        localStorage.setItem('ttsEngine', previousEngine);
        localStorage.setItem('isMuted', 'false');

        updateStatus('Voice output enabled', 'ready');
    }
}
