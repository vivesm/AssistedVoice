/**
 * Reading Mode Module
 * Handles text/share reading functionality with TTS playback
 */
import { showMiniPlayer, hideMiniPlayer } from './ui.js';

export class ReadingMode {
    constructor(state) {
        this.state = state;
        this.isActive = false;
        this.isPlaying = false;
        this.currentAudio = null;
        this.socketListenersAttached = false;

        this.initElements();
        this.initEventListeners();  // UI works immediately

        // Defer socket listeners until socket is connected
        this.waitForSocket();

        console.log('[ReadingMode] Initialized, waiting for socket...');
    }

    waitForSocket() {
        const checkSocket = setInterval(() => {
            if (this.state.socket && this.state.socket.connected && !this.socketListenersAttached) {
                this.initSocketListeners();
                this.socketListenersAttached = true;
                clearInterval(checkSocket);
                console.log('[ReadingMode] Socket listeners attached');
            }
        }, 100);

        // Stop checking after 10 seconds
        setTimeout(() => clearInterval(checkSocket), 10000);
    }

    initElements() {
        // Buttons
        this.readingModeBtn = document.getElementById('readingModeBtn');
        this.closeReadingBtn = document.getElementById('closeReadingBtn');
        this.backBtn = document.getElementById('backBtn');
        this.startReadingBtn = document.getElementById('startReadingBtn');
        this.loadShareBtn = document.getElementById('loadShareBtn');

        // Panels
        this.readingPanel = document.getElementById('readingModePanel');
        this.chatContainer = document.getElementById('chatContainer');
        this.readingPlayer = document.getElementById('readingPlayer');
        this.readingInputSection = document.querySelector('.reading-input-section');

        // Inputs
        this.textInput = document.getElementById('readingTextInput');
        this.shareInput = document.getElementById('readingShareInput');
        this.textCharCount = document.getElementById('textCharCount');

        // Tabs
        this.inputTabs = document.querySelectorAll('.input-tab');
        this.tabContents = document.querySelectorAll('.tab-content');

        // Player controls
        this.playBtn = document.getElementById('readingPlayBtn');
        this.pauseBtn = document.getElementById('readingPauseBtn');
        this.stopBtn = document.getElementById('readingStopBtn');
        this.prevBtn = document.getElementById('readingPrevBtn');
        this.nextBtn = document.getElementById('readingNextBtn');

        // Progress
        this.currentChunkText = document.getElementById('currentChunkText');
        this.currentChunk = document.getElementById('currentChunk');
        this.totalChunks = document.getElementById('totalChunks');
        this.progressPercentage = document.getElementById('progressPercentage');
        this.progressFill = document.getElementById('readingProgressFill');
        this.readingStatus = document.getElementById('readingStatus');

        console.log('[ReadingMode] Elements initialized:', {
            readingModeBtn: !!this.readingModeBtn,
            readingPanel: !!this.readingPanel,
            chatContainer: !!this.chatContainer,
            readingModeBtnElement: this.readingModeBtn
        });

        if (!this.readingModeBtn) {
            console.error('[ReadingMode] CRITICAL: readingModeBtn not found! Cannot attach click listener');
        }
        if (!this.readingPanel) {
            console.error('[ReadingMode] CRITICAL: readingPanel not found!');
        }
        if (!this.chatContainer) {
            console.error('[ReadingMode] CRITICAL: chatContainer not found!');
        }
        console.log('[ReadingMode] Elements initialized (condensed):', {
            readingModeBtn: !!this.readingModeBtn,
            readingPanel: !!this.readingPanel,
            chatContainer: !!this.chatContainer
        });
    }

    initEventListeners() {
        // Toggle reading mode
        if (this.readingModeBtn) {
            this.readingModeBtn.addEventListener('click', () => {
                console.log('[ReadingMode] Button clicked');
                this.toggleReadingMode();
            });
        }

        if (this.closeReadingBtn) {
            this.closeReadingBtn.addEventListener('click', () => this.closeReadingMode());
        }

        if (this.backBtn) {
            this.backBtn.addEventListener('click', (e) => {
                if (this.isActive) {
                    e.preventDefault();
                    this.closeReadingMode();
                }
            });
        }

        // Tab switching
        this.inputTabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });


        // Prevent Enter key from submitting to chat
        this.textInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                // Optionally start reading on Enter
                // this.startReading();
            }
        });

        // Text input character count
        this.textInput?.addEventListener('input', () => this.updateCharCount());

        // Start reading
        this.startReadingBtn?.addEventListener('click', () => this.startReading());
        this.loadShareBtn?.addEventListener('click', () => this.loadShare());

        // Player controls
        this.playBtn?.addEventListener('click', () => this.play());
        this.pauseBtn?.addEventListener('click', () => this.pause());
        this.stopBtn?.addEventListener('click', () => this.stop());
        this.prevBtn?.addEventListener('click', () => this.previous());
        this.nextBtn?.addEventListener('click', () => this.next());

        // Enter key in share input
        this.shareInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.loadShare();
        });

        console.log('[ReadingMode] Event listeners attached');
    }

    initSocketListeners() {
        const socket = this.state.socket;
        if (!socket) {
            console.warn('[ReadingMode] No socket available for listeners');
            return;
        }

        // Reading session started
        socket.on('reading_started', (data) => {
            console.log('Reading session started:', data);
            this.showPlayer();
            this.totalChunks.textContent = data.total_chunks;
            this.setStatus(`Loaded ${data.total_chunks} chunks`);

            // Auto-start playback to show the media player modal immediately
            this.play();
        });

        // Progress update
        socket.on('reading_progress', (data) => {
            this.updateProgress(data);
        });

        // Chunk data with text
        socket.on('reading_chunk', (data) => {
            console.log('Reading chunk:', data);
            this.currentChunkText.textContent = data.text;
            this.updateProgress(data.progress);
        });

        // Audio data for playback
        socket.on('reading_audio', (data) => {
            this.playAudio(data.audio);
        });

        // Reading complete
        socket.on('reading_complete', () => {
            this.setStatus('Reading complete');
            this.isPlaying = false;
            this.showPlayButton();
            hideMiniPlayer();
        });

        // Paused
        socket.on('reading_paused', () => {
            this.isPlaying = false;
            this.showPlayButton();
            this.setStatus('Paused');
        });

        // Stopped
        socket.on('reading_stopped', () => {
            this.isPlaying = false;
            this.showPlayButton();
            this.setStatus('Stopped');

            if (this.currentAudio) {
                this.currentAudio.pause();
                this.currentAudio = null;
            }
            hideMiniPlayer();
        });

        // Errors
        socket.on('reading_error', (data) => {
            console.error('Reading error:', data);
            this.setStatus(`Error: ${data.message}`);
            this.showToast(data.message, 'error');
        });
    }

    toggleReadingMode() {
        console.log('[ReadingMode] Toggle called, isActive:', this.isActive);
        if (this.isActive) {
            this.closeReadingMode();
        } else {
            this.openReadingMode();
        }
    }

    openReadingMode() {
        console.log('[ReadingMode] Opening reading mode');
        this.isActive = true;

        if (this.readingPanel) {
            this.readingPanel.style.display = 'block';
        }
        if (this.chatContainer) {
            this.chatContainer.style.display = 'none';
        }
        this.readingModeBtn?.classList.add('active');

        // Hide input bar footer
        const footer = document.querySelector('.input-bar');
        if (footer) footer.style.display = 'none';

        // Update header
        const backBtn = document.getElementById('backBtn');
        const menuBtn = document.getElementById('menuBtn');
        const headerRight = document.getElementById('headerRight');
        const appTitle = document.querySelector('.app-title');
        const readingTitle = document.getElementById('readingModeTitle');

        if (backBtn) backBtn.style.display = 'flex';
        if (menuBtn) menuBtn.style.display = 'none';
        if (headerRight) headerRight.style.display = 'none';
        if (appTitle) appTitle.style.display = 'none';
        if (readingTitle) readingTitle.style.display = 'block';
    }

    closeReadingMode() {
        console.log('[ReadingMode] Closing reading mode');
        this.isActive = false;

        if (this.readingPanel) {
            this.readingPanel.style.display = 'none';
        }
        if (this.chatContainer) {
            this.chatContainer.style.display = 'flex';
        }
        this.readingModeBtn?.classList.remove('active');

        // Show input bar footer
        const footer = document.querySelector('.input-bar');
        if (footer) footer.style.display = 'block';

        // Reset header
        const backBtn = document.getElementById('backBtn');
        const menuBtn = document.getElementById('menuBtn');
        const headerRight = document.getElementById('headerRight');
        const appTitle = document.querySelector('.app-title');
        const readingTitle = document.getElementById('readingModeTitle');

        if (backBtn) backBtn.style.display = 'none';
        if (menuBtn) menuBtn.style.display = 'flex';
        if (headerRight) headerRight.style.display = 'flex';
        if (appTitle) appTitle.style.display = 'block';
        if (readingTitle) readingTitle.style.display = 'none';

        // Clean up
        if (this.isPlaying) {
            this.stop();
        }

        if (this.state.socket && this.state.socket.connected) {
            this.state.socket.emit('end_reading');
        }
    }

    switchTab(tabName) {
        // Update tab buttons
        this.inputTabs.forEach(tab => {
            if (tab.dataset.tab === tabName) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        // Update tab content
        this.tabContents.forEach(content => {
            if (content.dataset.tabContent === tabName) {
                content.classList.add('active');
            } else {
                content.classList.remove('active');
            }
        });
    }

    updateCharCount() {
        const count = this.textInput.value.length;
        this.textCharCount.textContent = count.toLocaleString();

        // Warn if approaching limit
        if (count > 180000) {
            this.textCharCount.style.color = 'var(--error)';
        } else if (count > 150000) {
            this.textCharCount.style.color = 'var(--warning)';
        } else {
            this.textCharCount.style.color = 'var(--text-secondary)';
        }
    }

    startReading() {
        const socket = this.state.socket;
        if (!socket || !socket.connected) {
            this.showToast('Not connected to server', 'error');
            return;
        }

        const activeTab = document.querySelector('.input-tab.active')?.dataset.tab || 'text';

        if (activeTab === 'text') {
            const text = this.textInput?.value.trim();
            if (!text) {
                this.showToast('Please enter some text to read', 'error');
                return;
            }

            if (text.length > 200000) {
                this.showToast('Text exceeds 200,000 character limit', 'error');
                return;
            }

            this.setStatus('Starting reading session...');
            socket.emit('start_reading', {
                mode: 'text',
                text: text
            });

        } else if (activeTab === 'share') {
            const shareCode = this.shareInput?.value.trim();
            if (!shareCode) {
                this.showToast('Please enter a share code', 'error');
                return;
            }

            this.setStatus('Loading from share...');
            socket.emit('start_reading', {
                mode: 'share',
                share_code: shareCode
            });
        }
    }

    loadShare() {
        this.startReading();
    }

    showPlayer() {
        if (this.readingInputSection) {
            this.readingInputSection.style.display = 'none';
        }
        if (this.readingPlayer) {
            this.readingPlayer.style.display = 'block';
        }
    }

    play() {
        const socket = this.state.socket;
        if (socket && socket.connected) {
            socket.emit('reading_play');
            this.isPlaying = true;
            this.showPauseButton();
            this.setStatus('Playing...');
        }
    }

    pause() {
        const socket = this.state.socket;
        if (socket && socket.connected) {
            socket.emit('reading_pause');
        }
        this.isPlaying = false;
        this.showPlayButton();
        if (this.currentAudio) {
            this.currentAudio.pause();
        }
    }

    stop() {
        const socket = this.state.socket;
        if (socket && socket.connected) {
            socket.emit('reading_stop');
        }
        this.isPlaying = false;
        this.showPlayButton();
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
    }

    previous() {
        const socket = this.state.socket;
        if (socket && socket.connected) {
            socket.emit('reading_previous');
        }
    }

    next() {
        const socket = this.state.socket;
        if (socket && socket.connected) {
            socket.emit('reading_next');
        }
    }

    showPlayButton() {
        if (this.playBtn) this.playBtn.style.display = 'flex';
        if (this.pauseBtn) this.pauseBtn.style.display = 'none';
    }

    showPauseButton() {
        if (this.playBtn) this.playBtn.style.display = 'none';
        if (this.pauseBtn) this.pauseBtn.style.display = 'flex';
    }

    updateProgress(data) {
        if (this.currentChunk) this.currentChunk.textContent = data.current_chunk + 1;
        if (this.totalChunks) this.totalChunks.textContent = data.total_chunks;
        if (this.progressPercentage) this.progressPercentage.textContent = `${data.progress_percentage}%`;
        if (this.progressFill) this.progressFill.style.width = `${data.progress_percentage}%`;
    }

    playAudio(audioBase64) {
        // Stop previous audio if playing
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }

        // Create and play new audio
        const audio = new Audio(audioBase64);
        this.currentAudio = audio;

        // Use the centralized Media Player Modal
        console.log('[ReadingMode] Showing central media player modal for chunk');
        showMiniPlayer(audio, this.currentChunkText.textContent, {
            onPrev: () => this.previous(),
            onNext: () => this.next(),
            onStop: () => this.stop()
        });

        audio.play().catch(err => {
            console.error('Audio playback error:', err);
            this.showToast('Audio playback failed', 'error');
        });

        // Auto-advance when audio finishes
        audio.addEventListener('ended', () => {
            if (this.isPlaying && this.state.socket && this.state.socket.connected) {
                this.state.socket.emit('reading_auto_advance');
            }
        });
    }

    setStatus(message) {
        if (this.readingStatus) {
            this.readingStatus.textContent = message;
        }
    }

    showToast(message, type = 'info') {
        // Use existing toast system if available
        if (window.showToast) {
            window.showToast(message, type);
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }
}
