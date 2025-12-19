/**
 * Main entry point for AssistedVoice
 */
console.log('main.js START - Module loaded');
import { initializeWebSocket } from './modules/websocket.js';
import { initializeUI, registerUIFunctions } from './modules/ui.js?v=2';

document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing AssistedVoice...');

    // Register UI functions to state so other modules can use them
    registerUIFunctions();

    // Initialize UI (event listeners, settings, etc.)
    initializeUI();

    // Initialize WebSocket connection
    initializeWebSocket();

    console.log('AssistedVoice initialized successfully');
});
