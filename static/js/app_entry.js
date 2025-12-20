/**
 * Main entry point for AssistedVoice
 */
import { state } from './modules/state.js';
import { initializeWebSocket } from './modules/websocket.js';
import { initializeUI, registerUIFunctions } from './modules/ui.js?v=2';
import { ReadingMode } from './modules/reading.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing AssistedVoice...');

    // Register UI functions to state so other modules can use them
    registerUIFunctions();

    // Initialize UI (event listeners, settings, etc.)
    initializeUI();

    // Initialize WebSocket connection
    initializeWebSocket();
    
    // Initialize reading mode - it handles socket availability internally
    window.readingMode = new ReadingMode(state);
    console.log('Reading mode initialized');

    // Mark initialization as complete after a short delay to allow sync events to finish silently
    setTimeout(() => {
        state.isInitializing = false;
        console.log('Initialization phase complete, UI notifications enabled');
    }, 1500);

    console.log('AssistedVoice initialized successfully');
});
