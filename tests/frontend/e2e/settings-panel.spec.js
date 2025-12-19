/**
 * Settings Panel E2E Tests
 * CATCHES ISSUE #4: CSS class vs inline style mismatch (settings panel not opening)
 */
import { test, expect } from '@playwright/test';

test.describe('Settings Panel Interactions', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('/');

    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('should open settings panel when settings button is clicked', async ({ page }) => {
    // THIS TEST CATCHES ISSUE #4 - CSS class pattern vs inline style

    // Arrange: Verify panel is initially hidden
    const settingsPanel = page.locator('#settingsPanel');
    await expect(settingsPanel).not.toHaveClass(/open/);

    // Act: Click settings button
    await page.click('#settingsBtn');

    // Assert: Panel should have 'open' class and be visible
    await expect(settingsPanel).toHaveClass(/open/);
    await expect(settingsPanel).toBeVisible();

    // Verify overlay is also active
    const overlay = page.locator('#overlay');
    await expect(overlay).toHaveClass(/active/);
  });

  test('should close settings panel when close button is clicked', async ({ page }) => {
    // Arrange: Open settings first
    await page.click('#settingsBtn');
    const settingsPanel = page.locator('#settingsPanel');
    await expect(settingsPanel).toHaveClass(/open/);

    // Act: Click close button
    await page.click('#closeSettings');

    // Assert: Panel should not have 'open' class
    await expect(settingsPanel).not.toHaveClass(/open/);

    // Overlay should also be inactive
    const overlay = page.locator('#overlay');
    await expect(overlay).not.toHaveClass(/active/);
  });

  test('should close settings panel when overlay is clicked', async ({ page }) => {
    // Arrange: Open settings
    await page.click('#settingsBtn');
    const settingsPanel = page.locator('#settingsPanel');
    await expect(settingsPanel).toHaveClass(/open/);

    // Act: Click overlay
    await page.click('#overlay');

    // Assert: Panel should be closed
    await expect(settingsPanel).not.toHaveClass(/open/);
    const overlay = page.locator('#overlay');
    await expect(overlay).not.toHaveClass(/active/);
  });

  test('should verify CSS controls visibility, not inline styles', async ({ page }) => {
    // THIS TEST CATCHES ISSUE #4 - Verifies CSS class pattern is used

    const settingsPanel = page.locator('#settingsPanel');

    // Initially should use CSS to hide (not inline display:none)
    const inlineDisplay = await settingsPanel.evaluate(el => el.style.display);
    expect(inlineDisplay).toBe('');  // No inline style

    // Open panel - should add class, not inline style
    await page.click('#settingsBtn');
    const inlineDisplayAfter = await settingsPanel.evaluate(el => el.style.display);
    expect(inlineDisplayAfter).toBe('');  // Still no inline style

    // Verify class-based visibility
    await expect(settingsPanel).toHaveClass(/open/);
  });

  test('should display all settings sections', async ({ page }) => {
    // Open settings
    await page.click('#settingsBtn');

    // Wait for panel to be visible
    await expect(page.locator('#settingsPanel')).toBeVisible();

    // Verify AI settings controls are present
    await expect(page.locator('#temperatureSlider')).toBeVisible();
    await expect(page.locator('#maxTokensInput')).toBeVisible();
    await expect(page.locator('#systemPromptTextarea')).toBeVisible();

    // Scroll down to see server settings
    await page.locator('#settingsPanel').evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });

    // Verify server settings controls are present
    await expect(page.locator('#serverTypeSelect')).toBeVisible();
    await expect(page.locator('#testConnectionBtn')).toBeVisible();
  });

  test('should test connection when button is clicked', async ({ page }) => {
    // Open settings
    await page.click('#settingsBtn');

    // Scroll to server settings
    await page.locator('#settingsPanel').evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });

    // Wait for test connection button
    const testBtn = page.locator('#testConnectionBtn');
    await expect(testBtn).toBeVisible();

    // Click test connection
    await testBtn.click();

    // Wait for connection status to appear
    const statusEl = page.locator('#connectionStatus');
    await expect(statusEl).toBeVisible();

    // Status should have some text (either success or error)
    await expect(statusEl).not.toHaveText('');

    // Should have either success or error class
    const statusClass = await statusEl.getAttribute('class');
    expect(statusClass).toMatch(/success|error|testing/);
  });

  test('should change server type dropdown value', async ({ page }) => {
    // Open settings
    await page.click('#settingsBtn');

    // Scroll to server settings
    await page.locator('#settingsPanel').evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });

    // Find server type dropdown
    const serverTypeSelect = page.locator('#serverTypeSelect');
    await expect(serverTypeSelect).toBeVisible();

    // Change server type
    await serverTypeSelect.selectOption('ollama');

    // Verify selection
    const selectedValue = await serverTypeSelect.inputValue();
    expect(selectedValue).toBe('ollama');
  });

  test('should handle temperature slider interaction', async ({ page }) => {
    // Open settings
    await page.click('#settingsBtn');

    // Find temperature slider
    const slider = page.locator('#temperatureSlider');
    const valueDisplay = page.locator('#temperatureValue');

    // Get initial value
    const initialValue = await slider.inputValue();

    // Change slider value
    await slider.fill('0.9');

    // Wait a moment for debounce
    await page.waitForTimeout(500);

    // Verify value display updated
    const displayedValue = await valueDisplay.textContent();
    expect(displayedValue).toBe('0.9');
  });

  test('should handle max tokens input validation', async ({ page }) => {
    // Open settings
    await page.click('#settingsBtn');

    // Find max tokens input
    const maxTokensInput = page.locator('#maxTokensInput');

    // Try to set value below minimum (50)
    await maxTokensInput.fill('30');
    await maxTokensInput.blur();

    // Verify it was corrected to minimum
    const value = await maxTokensInput.inputValue();
    expect(parseInt(value)).toBeGreaterThanOrEqual(50);
  });
});

test.describe('Settings Panel Animation', () => {
  test('should animate panel opening', async ({ page }) => {
    await page.goto('/');

    const settingsPanel = page.locator('#settingsPanel');

    // Click settings button
    await page.click('#settingsBtn');

    // Panel should become visible with animation
    // Check for 'open' class which triggers CSS transition
    await expect(settingsPanel).toHaveClass(/open/);

    // Take screenshot of open state
    await page.screenshot({ path: 'test-results/settings-open.png', fullPage: true });
  });

  test('should show overlay when settings are open', async ({ page }) => {
    await page.goto('/');

    const overlay = page.locator('#overlay');

    // Initially hidden
    await expect(overlay).not.toHaveClass(/active/);

    // Open settings
    await page.click('#settingsBtn');

    // Wait for the overlay to actually receive the active class
    // This assertion retries automatically until timeout
    await expect(overlay).toHaveClass(/active/);
    await expect(overlay).toBeVisible();
  });
});
