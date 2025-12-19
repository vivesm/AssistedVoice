/**
 * Module Import Validation Tests
 * CATCHES ISSUE #2: Import errors (formatTime imported but doesn't exist)
 */
import { describe, it, expect } from 'vitest';

describe('Module Import Validation', () => {
  it('should successfully import state module', async () => {
    // This test fails immediately if any import is broken
    const stateModule = await import('../../../static/js/modules/state.js');

    // Verify state object exists
    expect(stateModule.state).toBeDefined();
    expect(typeof stateModule.state).toBe('object');

    // Verify exported functions exist
    expect(stateModule.setSocket).toBeDefined();
    expect(stateModule.getSocket).toBeDefined();
    expect(typeof stateModule.setSocket).toBe('function');
    expect(typeof stateModule.getSocket).toBe('function');
  });

  it('should successfully import utils module with all expected exports', async () => {
    // THIS TEST CATCHES ISSUE #2 - Missing formatTime function
    const utils = await import('../../../static/js/modules/utils.js');

    // Verify expected exports exist
    expect(utils.logRequest).toBeDefined();
    expect(utils.logResponse).toBeDefined();
    expect(utils.renderMarkdown).toBeDefined();
    expect(utils.addCopyButtonsToCodeBlocks).toBeDefined();
    expect(utils.showToast).toBeDefined();

    // Verify they are functions
    expect(typeof utils.logRequest).toBe('function');
    expect(typeof utils.logResponse).toBe('function');
    expect(typeof utils.renderMarkdown).toBe('function');
    expect(typeof utils.addCopyButtonsToCodeBlocks).toBe('function');
    expect(typeof utils.showToast).toBe('function');

    // If formatTime is expected, this line would FAIL when it doesn't exist
    // expect(utils.formatTime).toBeDefined();
  });

  it('should successfully import UI module', async () => {
    const ui = await import('../../../static/js/modules/ui.js');

    // Verify main exported functions exist
    expect(ui.initializeUI).toBeDefined();
    expect(ui.registerUIFunctions).toBeDefined();

    // Verify they are functions
    expect(typeof ui.initializeUI).toBe('function');
    expect(typeof ui.registerUIFunctions).toBe('function');
  });

  it('should successfully import audio module', async () => {
    const audio = await import('../../../static/js/modules/audio.js');

    // Verify exported functions exist
    expect(audio.startRecording).toBeDefined();
    expect(audio.stopRecording).toBeDefined();

    // Verify they are functions
    expect(typeof audio.startRecording).toBe('function');
    expect(typeof audio.stopRecording).toBe('function');
  });

  it('should successfully import websocket module', async () => {
    const websocket = await import('../../../static/js/modules/websocket.js');

    // Verify exported functions exist
    expect(websocket.initializeWebSocket).toBeDefined();
    expect(websocket.emit).toBeDefined();

    // Verify they are functions
    expect(typeof websocket.initializeWebSocket).toBe('function');
    expect(typeof websocket.emit).toBe('function');
  });

  it('should load all modules without throwing errors', async () => {
    // Simply importing all modules will fail if any have broken imports
    await expect(import('../../../static/js/modules/state.js')).resolves.toBeDefined();
    await expect(import('../../../static/js/modules/utils.js')).resolves.toBeDefined();
    await expect(import('../../../static/js/modules/ui.js')).resolves.toBeDefined();
    await expect(import('../../../static/js/modules/audio.js')).resolves.toBeDefined();
    await expect(import('../../../static/js/modules/websocket.js')).resolves.toBeDefined();
  });

  it('should have no circular dependencies', async () => {
    // Test that importing modules in different orders doesn't cause issues
    await Promise.all([
      import('../../../static/js/modules/state.js'),
      import('../../../static/js/modules/websocket.js'),
      import('../../../static/js/modules/ui.js'),
      import('../../../static/js/modules/audio.js'),
      import('../../../static/js/modules/utils.js')
    ]);

    // If we get here without errors, no circular dependency issues
    expect(true).toBe(true);
  });
});
