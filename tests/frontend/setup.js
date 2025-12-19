/**
 * Vitest global setup file
 * Mocks browser APIs and external dependencies for testing
 */
import { vi } from 'vitest';

// Mock localStorage
const localStorageMock = {
  store: {},
  getItem(key) {
    return this.store[key] || null;
  },
  setItem(key, value) {
    this.store[key] = value.toString();
  },
  removeItem(key) {
    delete this.store[key];
  },
  clear() {
    this.store = {};
  }
};

global.localStorage = localStorageMock;

// Mock sessionStorage
global.sessionStorage = { ...localStorageMock, store: {} };

// Mock console methods to reduce noise (but keep error)
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: originalConsole.error  // Keep errors visible
};

// Mock window.alert, confirm, prompt
global.alert = vi.fn();
global.confirm = vi.fn(() => true);
global.prompt = vi.fn(() => 'test input');

// Mock fetch API
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    blob: () => Promise.resolve(new Blob())
  })
);

// Mock WebSocket
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;

    // Simulate connection after a tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) this.onopen({ type: 'open' });
    }, 0);
  }

  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ type: 'close' });
  }

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
}

global.WebSocket = MockWebSocket;

// Mock MediaRecorder
class MockMediaRecorder {
  constructor(stream) {
    this.stream = stream;
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    if (this.ondataavailable) {
      this.ondataavailable({
        data: new Blob(['test audio'], { type: 'audio/webm' })
      });
    }
    if (this.onstop) this.onstop();
  }

  pause() {
    this.state = 'paused';
  }

  resume() {
    this.state = 'recording';
  }

  static isTypeSupported() {
    return true;
  }
}

global.MediaRecorder = MockMediaRecorder;

// Mock navigator.mediaDevices
global.navigator = {
  ...global.navigator,
  mediaDevices: {
    getUserMedia: vi.fn(() =>
      Promise.resolve({
        getTracks: () => [
          {
            stop: vi.fn(),
            kind: 'audio',
            label: 'Mock Microphone'
          }
        ],
        getAudioTracks: () => [
          {
            stop: vi.fn(),
            kind: 'audio',
            label: 'Mock Microphone'
          }
        ]
      })
    ),
    enumerateDevices: vi.fn(() =>
      Promise.resolve([
        {
          deviceId: 'default',
          kind: 'audioinput',
          label: 'Mock Microphone',
          groupId: 'test-group'
        }
      ])
    )
  },
  userAgent: 'Mozilla/5.0 (Test Environment)'
};

// Mock Audio constructor
global.Audio = class MockAudio {
  constructor(src) {
    this.src = src;
    this.paused = true;
    this.currentTime = 0;
    this.duration = 10;
    this.volume = 1;
    this.onended = null;
    this.onerror = null;
  }

  play() {
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.paused = true;
  }

  load() {}
};

// Clean up after each test
afterEach(() => {
  // Clear localStorage
  localStorage.clear();
  sessionStorage.clear();

  // Clear all mocks
  vi.clearAllMocks();
});
