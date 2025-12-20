/**
 * Reading Mode Module
 * Handles text/share reading functionality with TTS playback
 */

export class ReadingMode {
    constructor(socket) {
        this.socket = socket;
        this.isActive = false;
        this.isPlaying = false;
        this.currentAudio = null;

        this.initElements();
        this.initEventListeners();
        this.initSocketListeners();
    }

    initElements() {
        // Buttons
        this.readingModeBtn = document.getElementById('readingModeBtn');
        this.closeReadingBtn = document.getElementById('closeReadingBtn');
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
    }

    initEventListeners() {
        // Toggle reading mode
        this.readingModeBtn?.addEventListener('click', () => this.toggleReadingMode());
        this.closeReadingBtn?.addEventListener('click', () => this.closeReadingMode());

        // Tab switching
        this.inputTabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
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
    }

    initSocketListeners() {
        // Reading session started
        this.socket.on('reading_started', (data) => {
            console.log('Reading session started:', data);
            this.showPlayer();
            this.totalChunks.textContent = data.total_chunks;
            this.setStatus(`Loaded ${data.total_chunks} chunks`);
        });

        // Progress update
        this.socket.on('reading_progress', (data) => {
            this.updateProgress(data);
        });

        // Chunk data with text
        this.socket.on('reading_chunk', (data) => {
            this.currentChunkText.textContent = data.text;
            this.updateProgress(data.progress);
        });

        // Audio data for playback
        this.socket.on('reading_audio', (data) => {
            this.playAudio(data.audio);
        });

        // Reading complete
        this.socket.on('reading_complete', () => {
            this.setStatus('Reading complete');
            this.isPlaying = false;
            this.showPlayButton();
        });

        // Paused
        this.socket.on('reading_paused', () => {
            this.isPlaying = false;
            this.showPlayButton();
            this.setStatus('Paused');
        });

        // Stopped
        this.socket.on('reading_stopped', () => {
            this.isPlaying = false;
            this.showPlayButton();
            this.setStatus('Stopped');
            if (this.currentAudio) {
                this.currentAudio.pause();
                this.currentAudio = null;
            }
        });

        // Errors
        this.socket.on('reading_error', (data) => {
            console.error('Reading error:', data);
            this.setStatus(`Error: ${data.message}`);
            this.showToast(data.message, 'error');
        });
    }

    toggleReadingMode() {
        if (this.isActive) {
            this.closeReadingMode();
        } else {
            this.openReadingMode();
        }
    }

    openReadingMode() {
        this.isActive = true;
        this.readingPanel.style.display = 'block';
        this.chatContainer.style.display = 'none';
        this.readingModeBtn?.classList.add('active');

        // Show back button in header
        const backBtn = document.getElementById('backBtn');
        const menuBtn = document.getElementById('menuBtn');
        if (backBtn && menuBtn) {
            backBtn.style.display = 'flex';
            menuBtn.style.display = 'none';
        }
    }

    closeReadingMode() {
        this.isActive = false;
        this.readingPanel.style.display = 'none';
        this.chatContainer.style.display = 'flex';
        this.readingModeBtn?.classList.remove('active');

        // Hide back button, show menu button
        const backBtn = document.getElementById('backBtn');
        const menuBtn = document.getElementById('menuBtn');
        if (backBtn && menuBtn) {
            backBtn.style.display = 'none';
            menuBtn.style.display = 'flex';
        }

        // Clean up
        if (this.isPlaying) {
            this.stop();
        }
        this.socket.emit('end_reading');
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
        const activeTab = document.querySelector('.input-tab.active').dataset.tab;

        if (activeTab === 'text') {
            const text = this.textInput.value.trim();
            if (!text) {
                this.showToast('Please enter some text to read', 'error');
                return;
            }

            if (text.length > 200000) {
                this.showToast('Text exceeds 200,000 character limit', 'error');
                return;
            }

            this.setStatus('Starting reading session...');
            this.socket.emit('start_reading', {
                mode: 'text',
                text: text
            });

        } else if (activeTab === 'share') {
            const shareCode = this.shareInput.value.trim();
            if (!shareCode) {
                this.showToast('Please enter a share code', 'error');
                return;
            }

            this.setStatus('Loading from share...');
            this.socket.emit('start_reading', {
                mode: 'share',
                share_code: shareCode
            });
        }
    }

    loadShare() {
        this.startReading();
    }

    showPlayer() {
        this.readingInputSection.style.display = 'none';
        this.readingPlayer.style.display = 'block';
    }

    play() {
        this.socket.emit('reading_play');
        this.isPlaying = true;
        this.showPauseButton();
        this.setStatus('Playing...');
    }

    pause() {
        this.socket.emit('reading_pause');
        this.isPlaying = false;
        this.showPlayButton();
        if (this.currentAudio) {
            this.currentAudio.pause();
        }
    }

    stop() {
        this.socket.emit('reading_stop');
        this.isPlaying = false;
        this.showPlayButton();
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio = null;
        }
    }

    previous() {
        this.socket.emit('reading_previous');
    }

    next() {
        this.socket.emit('reading_next');
    }

    showPlayButton() {
        this.playBtn.style.display = 'flex';
        this.pauseBtn.style.display = 'none';
    }

    showPauseButton() {
        this.playBtn.style.display = 'none';
        this.pauseBtn.style.display = 'flex';
    }

    updateProgress(data) {
        this.currentChunk.textContent = data.current_chunk + 1; // 0-indexed to 1-indexed
        this.totalChunks.textContent = data.total_chunks;
        this.progressPercentage.textContent = `${data.progress_percentage}%`;
        this.progressFill.style.width = `${data.progress_percentage}%`;
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

        audio.play().catch(err => {
            console.error('Audio playback error:', err);
            this.showToast('Audio playback failed', 'error');
        });

        // Auto-advance when audio finishes
        audio.addEventListener('ended', () => {
            if (this.isPlaying) {
                this.socket.emit('reading_auto_advance');
            }
        });
    }

    setStatus(message) {
        this.readingStatus.textContent = message;
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
