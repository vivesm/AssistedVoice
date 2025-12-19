import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

describe('Model Loading Integration', () => {
  let dom;
  let document;
  let window;

  beforeEach(() => {
    // Setup DOM
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <select id="modelSelect">
            <option value="">Loading...</option>
          </select>
        </body>
      </html>
    `);
    document = dom.window.document;
    window = dom.window;
    global.document = document;
    global.window = window;

    // Mock fetch
    global.fetch = vi.fn();

    // Mock showToast utility
    global.showToast = vi.fn();
  });

  it('should verify loadAvailableModels function exists and is exported', async () => {
    const ui = await import('../../../static/js/modules/ui.js');

    expect(ui.loadAvailableModels).toBeDefined();
    expect(typeof ui.loadAvailableModels).toBe('function');
  });

  it('should fetch models from /api/models endpoint', async () => {
    // Mock successful API response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: ['llama3.2:3b', 'mistral:latest'],
        current: 'llama3.2:3b'
      })
    });

    const { loadAvailableModels } = await import('../../../static/js/modules/ui.js');
    await loadAvailableModels();

    // Verify fetch was called with correct endpoint
    expect(global.fetch).toHaveBeenCalledWith('/api/models');
  });

  it('should populate dropdown with available models', async () => {
    // Mock successful API response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: ['llama3.2:3b', 'mistral:latest', 'deepseek-r1:8b'],
        current: 'llama3.2:3b'
      })
    });

    const { loadAvailableModels } = await import('../../../static/js/modules/ui.js');
    await loadAvailableModels();

    const modelSelect = document.getElementById('modelSelect');

    // Should have 3 model options
    expect(modelSelect.options.length).toBe(3);
    expect(modelSelect.options[0].value).toBe('llama3.2:3b');
    expect(modelSelect.options[1].value).toBe('mistral:latest');
    expect(modelSelect.options[2].value).toBe('deepseek-r1:8b');
  });

  it('should set current model as selected', async () => {
    // Mock successful API response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: ['llama3.2:3b', 'mistral:latest', 'deepseek-r1:8b'],
        current: 'mistral:latest'
      })
    });

    const { loadAvailableModels } = await import('../../../static/js/modules/ui.js');
    await loadAvailableModels();

    const modelSelect = document.getElementById('modelSelect');

    // Should select the current model
    expect(modelSelect.value).toBe('mistral:latest');
  });

  it('should handle empty models array correctly', async () => {
    // Mock API response with no models
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        models: [],
        current: 'openai/gpt-oss-20b'
      })
    });

    const { loadAvailableModels } = await import('../../../static/js/modules/ui.js');
    await loadAvailableModels();

    const modelSelect = document.getElementById('modelSelect');

    // Should show "No models available" and remain disabled
    expect(modelSelect.options.length).toBe(1);
    expect(modelSelect.options[0].textContent).toBe('No models available');
    // Note: Dropdown stays disabled when no models are available (correct behavior)
  });

  it('should handle API errors gracefully', async () => {
    // Mock failed API response
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });

    const { loadAvailableModels } = await import('../../../static/js/modules/ui.js');
    await loadAvailableModels();

    const modelSelect = document.getElementById('modelSelect');

    // Should show error message
    expect(modelSelect.options[0].textContent).toBe('Failed to load models');
    expect(modelSelect.disabled).toBe(true);
  });

  it('should handle network errors gracefully', async () => {
    // Mock network error
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    const { loadAvailableModels } = await import('../../../static/js/modules/ui.js');
    await loadAvailableModels();

    const modelSelect = document.getElementById('modelSelect');

    // Should show error message
    expect(modelSelect.options[0].textContent).toBe('Failed to load models');
    expect(modelSelect.disabled).toBe(true);
  });

  it('should show loading state while fetching', async () => {
    // Mock delayed API response
    let resolvePromise;
    const fetchPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    global.fetch.mockReturnValueOnce(fetchPromise);

    const { loadAvailableModels } = await import('../../../static/js/modules/ui.js');
    const loadPromise = loadAvailableModels();

    // Check loading state immediately
    const modelSelect = document.getElementById('modelSelect');
    expect(modelSelect.options[0].textContent).toBe('Loading models...');
    expect(modelSelect.disabled).toBe(true);

    // Resolve the fetch
    resolvePromise({
      ok: true,
      json: async () => ({
        models: ['test-model'],
        current: 'test-model'
      })
    });

    await loadPromise;

    // Should be populated after loading
    expect(modelSelect.disabled).toBe(false);
    expect(modelSelect.options.length).toBe(1);
    expect(modelSelect.options[0].value).toBe('test-model');
  });

  it('should handle invalid API response format', async () => {
    // Mock API response with invalid format
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        // Missing models array
        current: 'some-model'
      })
    });

    const { loadAvailableModels } = await import('../../../static/js/modules/ui.js');
    await loadAvailableModels();

    const modelSelect = document.getElementById('modelSelect');

    // Should show error message
    expect(modelSelect.options[0].textContent).toBe('Failed to load models');
    expect(modelSelect.disabled).toBe(true);
  });
});
