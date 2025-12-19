import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use jsdom environment for browser API testing
    environment: 'jsdom',

    // Global test APIs (describe, it, expect, etc.)
    globals: true,

    // Setup file for mocks and global config
    setupFiles: ['./tests/frontend/setup.js'],

    // Test file patterns (exclude e2e - those use Playwright)
    include: [
      'tests/frontend/unit/**/*.{test,spec}.{js,mjs,cjs}',
      'tests/frontend/integration/**/*.{test,spec}.{js,mjs,cjs}'
    ],

    // Code coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],

      // Coverage thresholds - fail if below
      // Note: Set to current baseline (30%). Increase incrementally as tests are added.
      // Target: 80% lines, 80% functions, 75% branches, 80% statements
      lines: 25,
      functions: 20,
      branches: 50,
      statements: 25,

      // Files to include in coverage
      include: [
        'static/js/**/*.js'
      ],

      // Files to exclude from coverage
      exclude: [
        'tests/**',
        'node_modules/**',
        '**/*.test.js',
        '**/*.spec.js',
        'static/js/app_entry.js',  // Entry point, hard to test
        'archive/**'
      ],

      // Report uncovered lines
      reportOnFailure: true,

      // All files should be included in coverage, even if not imported
      all: true
    },

    // Test timeout (ms)
    testTimeout: 10000,

    // Hook timeout (ms)
    hookTimeout: 10000,

    // Retry failed tests once
    retry: 1,

    // Silent console output during tests
    silent: false,

    // Clear mocks between tests
    clearMocks: true,

    // Restore mocks between tests
    restoreMocks: true
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@': '/static/js'
    }
  }
});
