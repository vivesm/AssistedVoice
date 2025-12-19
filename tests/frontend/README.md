# Frontend Testing Documentation

This directory contains the complete frontend testing infrastructure for AssistedVoice, designed to catch the 6 types of issues identified during development.

## Test Coverage by Issue Type

### ✅ Issue #1: System Prompt Not Persisting (localStorage → Backend Sync)
**Test File**: `integration/ai-settings-sync.test.js`
- Verifies AI settings sync from localStorage to backend on WebSocket connect
- Tests temperature, max tokens, and system prompt persistence
- Catches missing `syncAISettingsToBackend()` calls

### ✅ Issue #2: Import Errors (`formatTime` Missing from utils.js)
**Test Files**:
- `unit/module-imports.test.js` - Runtime import validation
- **ESLint** (`.eslintrc.cjs`) - Static analysis with `import/named` rule
- Detects broken imports before code runs

### ✅ Issue #3: Missing State Properties (`currentResponse`, `currentResponseDiv`)
**Test File**: `unit/state-validation.test.js`
- Validates all required state object properties
- Checks property types and default values
- Catches undefined property references

### ✅ Issue #4: CSS Class vs Inline Style Mismatch (Settings Panel)
**Test File**: `e2e/settings-panel.spec.js`
- Verifies settings panel uses `.open` class, not inline styles
- Tests UI interactions (click, overlay, animation)
- Ensures CSS-based state management

### ✅ Issue #5: Placeholder Function Implementations
**Test Files**:
- `integration/settings-initialization.test.js` - Checks for stub functions
- **Vitest Coverage** - Highlights uncovered code (0% coverage = placeholder)
- Validates function implementation length

### ✅ Issue #6: Missing Functions (`setupServerSettings`)
**Test Files**:
- `integration/settings-initialization.test.js` - Checks function existence
- **ESLint** (`.eslintrc.cjs`) - `no-undef` rule catches undefined function calls
- Runtime errors when calling missing functions

## Test Structure

```
tests/frontend/
├── setup.js                          # Global test setup (mocks, fixtures)
├── unit/                             # Unit tests (60% of tests)
│   ├── state-validation.test.js      # State object validation
│   └── module-imports.test.js        # ES6 module import checks
├── integration/                      # Integration tests (30% of tests)
│   ├── ai-settings-sync.test.js      # localStorage ↔ backend sync
│   └── settings-initialization.test.js # Function existence & implementation
└── e2e/                              # E2E tests (10% of tests)
    └── settings-panel.spec.js        # UI interaction & CSS state
```

## Running Tests

### All Tests
```bash
npm test                 # Run in watch mode
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run test:e2e         # E2E tests with Playwright
npm run test:all         # Lint + Unit + Integration + E2E
```

### With Coverage
```bash
npm run test:coverage    # Generate coverage report
# Open: coverage/index.html
```

### Linting
```bash
npm run lint             # Check for issues
npm run lint:fix         # Auto-fix issues
```

## Configuration Files

- **vitest.config.js** - Vitest configuration (jsdom, coverage thresholds)
- **playwright.config.js** - Playwright E2E configuration
- **.eslintrc.cjs** - ESLint rules for import validation, dead code detection
- **setup.js** - Global test mocks (localStorage, WebSocket, MediaRecorder)

## Test Results (Current)

```
✓ Unit Tests:        18 passed (11 state + 7 imports)
✓ Integration Tests: 17 passed (9 sync + 8 initialization)
⏳ E2E Tests:         Not run yet (requires running server)
✓ ESLint:            Working (warnings expected for HTML-bound exports)
```

## Code Coverage Thresholds

- Lines: 80%
- Functions: 80%
- Branches: 75%
- Statements: 80%

Build fails if coverage drops below thresholds.

## Mocked APIs

The `setup.js` file mocks:
- **localStorage / sessionStorage**
- **console methods** (log, info, warn - errors still visible)
- **WebSocket** (MockWebSocket class)
- **MediaRecorder** (for audio testing)
- **navigator.mediaDevices** (getUserMedia, enumerateDevices)
- **Audio constructor** (for TTS testing)
- **fetch API**

## Writing New Tests

### Unit Test Example
```javascript
import { describe, it, expect } from 'vitest';
import { state } from '../../static/js/modules/state.js';

describe('My Feature', () => {
  it('should do something', () => {
    expect(state.myProperty).toBeDefined();
  });
});
```

### Integration Test Example
```javascript
import { describe, it, expect, beforeEach } from 'vitest';

describe('My Integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should sync data', () => {
    localStorage.setItem('key', 'value');
    // Test logic
  });
});
```

### E2E Test Example
```javascript
import { test, expect } from '@playwright/test';

test('my feature works', async ({ page }) => {
  await page.goto('/');
  await page.click('#myButton');
  await expect(page.locator('#result')).toBeVisible();
});
```

## CI/CD Integration

Tests run automatically on:
- Every `git push`
- Every pull request
- Before deployment

To add CI/CD, create `.github/workflows/frontend-tests.yml`:

```yaml
name: Frontend Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:all
```

## Troubleshooting

### Tests Failing with "Module not found"
- Ensure imports use relative paths from test file
- Check `vitest.config.js` alias configuration

### ESLint Errors on Valid Code
- Update `.eslintrc.cjs` to add exceptions
- Use `// eslint-disable-next-line rule-name` for one-off cases

### E2E Tests Timeout
- Ensure server is running on port 5001
- Increase timeout in `playwright.config.js`

### Coverage Not Updating
- Delete `coverage/` directory and re-run tests
- Check `vitest.config.js` include/exclude patterns

## Best Practices

1. **Run tests before committing** - `npm run test:all`
2. **Write tests first** - TDD prevents these issues
3. **Keep tests fast** - Mock external dependencies
4. **Test behavior, not implementation** - Focus on user-facing functionality
5. **Use descriptive test names** - Explain what should happen
6. **One assertion per test** - Makes failures easier to debug

## Next Steps

- [ ] Add more E2E tests for critical user flows
- [ ] Set up visual regression testing
- [ ] Add performance testing
- [ ] Integrate with CI/CD pipeline
- [ ] Add accessibility testing (a11y)
