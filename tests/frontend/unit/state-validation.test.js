/**
 * State Object Validation Tests
 * CATCHES ISSUE #3: Missing state properties (currentResponse, currentResponseDiv)
 */
import { describe, it, expect } from 'vitest';
import { state } from '../../../static/js/modules/state.js';

describe('State Object Validation', () => {
  it('should have all required WebSocket properties', () => {
    expect(state).toHaveProperty('socket');
    expect(state).toHaveProperty('reconnectAttempts');
    expect(state).toHaveProperty('maxReconnectAttempts');
    expect(state).toHaveProperty('baseReconnectDelay');
    expect(state).toHaveProperty('reconnectTimeout');
    expect(state).toHaveProperty('connectionState');
  });

  it('should have all required audio recording properties', () => {
    expect(state).toHaveProperty('mediaRecorder');
    expect(state).toHaveProperty('audioStream');
    expect(state).toHaveProperty('audioChunks');
    expect(state).toHaveProperty('isRecording');
  });

  it('should have all required TTS properties', () => {
    expect(state).toHaveProperty('ttsEnabled');
    expect(state).toHaveProperty('currentTTSEngine');
    expect(state).toHaveProperty('audioQueue');
    expect(state).toHaveProperty('isPlayingAudio');
    expect(state).toHaveProperty('currentAudio');
    expect(state).toHaveProperty('currentModel');
  });

  it('should have all required response streaming properties', () => {
    // THIS TEST CATCHES ISSUE #3 - Missing state properties
    expect(state).toHaveProperty('currentResponse');
    expect(state).toHaveProperty('currentResponseDiv');
    expect(state).toHaveProperty('isGenerating');
  });

  it('should have all required Live Assistant Mode properties', () => {
    expect(state).toHaveProperty('isLiveMode');
    expect(state).toHaveProperty('liveAudioContext');
    expect(state).toHaveProperty('liveAudioWorklet');
    expect(state).toHaveProperty('liveAudioStream');
    expect(state).toHaveProperty('recentTranscripts');
  });

  it('should have all required audio visualization properties', () => {
    expect(state).toHaveProperty('audioContext');
    expect(state).toHaveProperty('analyser');
    expect(state).toHaveProperty('animationFrameId');
    expect(state).toHaveProperty('audioBars');
  });

  it('should have all required chat properties', () => {
    expect(state).toHaveProperty('currentChatId');
  });

  it('should have all required metrics properties', () => {
    expect(state).toHaveProperty('firstTokenTime');
    expect(state).toHaveProperty('messageStartTime');
    expect(state).toHaveProperty('tokenCount');
  });

  it('should initialize all properties with correct types', () => {
    // Booleans
    expect(typeof state.isRecording).toBe('boolean');
    expect(typeof state.ttsEnabled).toBe('boolean');
    expect(typeof state.isPlayingAudio).toBe('boolean');
    expect(typeof state.isGenerating).toBe('boolean');
    expect(typeof state.isLiveMode).toBe('boolean');

    // Strings
    expect(typeof state.currentTTSEngine).toBe('string');
    expect(typeof state.currentResponse).toBe('string');
    expect(typeof state.connectionState).toBe('string');

    // Arrays
    expect(Array.isArray(state.audioChunks)).toBe(true);
    expect(Array.isArray(state.audioQueue)).toBe(true);
    expect(Array.isArray(state.recentTranscripts)).toBe(true);
    expect(Array.isArray(state.audioBars)).toBe(true);

    // Numbers
    expect(typeof state.reconnectAttempts).toBe('number');
    expect(typeof state.maxReconnectAttempts).toBe('number');
    expect(typeof state.baseReconnectDelay).toBe('number');
    expect(typeof state.tokenCount).toBe('number');
  });

  it('should have sensible default values', () => {
    expect(state.isRecording).toBe(false);
    expect(state.ttsEnabled).toBe(true);
    expect(state.isPlayingAudio).toBe(false);
    expect(state.isGenerating).toBe(false);
    expect(state.isLiveMode).toBe(false);
    expect(state.currentResponse).toBe('');
    expect(state.connectionState).toBe('disconnected');
    expect(state.reconnectAttempts).toBe(0);
    expect(state.maxReconnectAttempts).toBe(10);
    expect(state.baseReconnectDelay).toBe(1000);
    expect(state.tokenCount).toBe(0);
  });

  it('should have null values for uninitialized objects', () => {
    expect(state.socket).toBeNull();
    expect(state.mediaRecorder).toBeNull();
    expect(state.audioStream).toBeNull();
    expect(state.currentAudio).toBeNull();
    expect(state.currentModel).toBeNull();
    expect(state.currentResponseDiv).toBeNull();
    expect(state.liveAudioContext).toBeNull();
    expect(state.liveAudioWorklet).toBeNull();
    expect(state.liveAudioStream).toBeNull();
    expect(state.audioContext).toBeNull();
    expect(state.analyser).toBeNull();
    expect(state.animationFrameId).toBeNull();
    expect(state.reconnectTimeout).toBeNull();
    expect(state.currentChatId).toBeNull();
    expect(state.firstTokenTime).toBeNull();
    expect(state.messageStartTime).toBeNull();
  });
});
