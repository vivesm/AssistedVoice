module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true
  },
  globals: {
    io: 'readonly',           // Socket.IO from CDN
    marked: 'readonly',       // Marked.js from CDN
    hljs: 'readonly',         // Highlight.js from CDN
    DOMPurify: 'readonly'     // DOMPurify from CDN
  },
  extends: ['eslint:recommended'],
  plugins: ['import'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  rules: {
    // Import/Export validation - CATCHES ISSUE #2 and #6
    'import/named': 'error',                    // Validate that named imports actually exist
    'import/no-unresolved': ['error', {         // Ensure imports point to files that can be resolved
      ignore: ['\\.js\\?v=']                    // Ignore versioned imports (e.g., ui.js?v=2)
    }],
    'import/no-unused-modules': ['warn', {      // Report modules without any exports (warn, not error)
      unusedExports: true,
      missingExports: true
    }],

    // Undefined variable/function usage - CATCHES ISSUE #6
    'no-undef': 'error',

    // Empty function detection - CATCHES ISSUE #5
    'no-empty-function': ['error', {
      allow: []  // Don't allow any empty functions
    }],

    // Unused expressions
    'no-unused-expressions': 'error',

    // Code quality
    'no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_'
    }],
    'no-console': 'off',  // Allow console in this project
    'semi': ['error', 'always'],
    'quotes': ['error', 'single', { avoidEscape: true }]
  },
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.mjs']
      }
    }
  },
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    '*.min.js',
    'archive/',
    'tests/**/*.test.js',  // Don't lint test files as strictly
    'tests/**/*.spec.js'
  ]
};
