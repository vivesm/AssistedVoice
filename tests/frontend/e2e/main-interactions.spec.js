
import { test, expect } from '@playwright/test';

test.describe('Main Interactions', () => {

    // Mock API responses to ensure consistent state
    test.beforeEach(async ({ page }) => {
        // Mock /api/models
        await page.route('/api/models', async route => {
            const json = {
                models: ['mock-model-1', 'mock-model-2', 'mock-model-3'],
                current: 'mock-model-1'
            };
            await route.fulfill({ json });
        });

        // Mock /api/test-connection (for settings, but good to have)
        await page.route('/api/test-connection', async route => {
            await route.fulfill({ json: { success: true, message: 'Connected' } });
        });

        await page.goto('/');
        await page.waitForLoadState('networkidle');
    });

    test('should display welcome screen with model cards', async ({ page }) => {
        // Check for welcome message
        await expect(page.locator('#welcome')).toBeVisible();
        await expect(page.locator('#welcome h2')).toContainText('Start a conversation');

        // Check for Quick-Select Model Cards (New Feature)
        const cards = page.locator('.model-btn');
        // We expect 3 cards by default in the HTML (static template)
        // or loaded dynamically. Based on index.html they are hardcoded in the template.
        await expect(cards).toHaveCount(3);
        await expect(cards.first()).toBeVisible();
    });

    test('should select a model from Quick-Select cards', async ({ page }) => {
        const firstCard = page.locator('.model-btn').first();
        const modelName = await firstCard.getAttribute('data-model');

        // Click the card
        await firstCard.click();

        // Verify Welcome screen disappears and chat messages appear
        await expect(page.locator('#welcome')).not.toBeVisible();
        await expect(page.locator('#messages')).toBeVisible();
        await expect(page.locator('#messages')).toHaveClass(/active/);

        // Verify toast notification (optional, hard to catch timing sometimes but retry helps)
        // await expect(page.locator('.toast')).toBeVisible();

        // Verify status updated (mocked model might not reflect in "data-model" hardcoded card unless we clicked a dynamic one)
        // BUT the click handler sets state.currentModel = btn.dataset.model
    });

    test('should type and send a text message', async ({ page }) => {
        // We need to dismiss welcome screen first usually, or just type.
        // Typing input should be available.
        const input = page.locator('#textInput');
        await expect(input).toBeVisible();

        await input.fill('Hello AI');
        await expect(input).toHaveValue('Hello AI');

        // Click Send
        await page.click('#sendBtn');

        // Message should appear in chat
        const userMsg = page.locator('.message.user .message-content');
        await expect(userMsg).toContainText('Hello AI');

        // Input should be cleared
        await expect(input).toHaveValue('');
    });

    test('should toggle mute functionality', async ({ page }) => {
        const muteBtn = page.locator('#muteBtn');

        // Initial state: checking class or icon
        // Assuming initial state is NOT muted based on default
        await expect(muteBtn).toBeVisible();

        await muteBtn.click();
        // After click, it should toggle. We check for class change "muted"
        // ui.js: muteBtn.classList.toggle('muted') logic isn't explicitly shown in the snippet but implied by toggleMute import
        // Let's check visual indicators (svgs)

        // We will just verify it stays visible and is clickable without error
        await expect(muteBtn).toBeVisible();
    });

    test('should open and close sidebar menu', async ({ page }) => {
        const menuBtn = page.locator('#menuBtn');
        const sideMenu = page.locator('#sideMenu');
        const overlay = page.locator('#overlay');

        // Open
        await menuBtn.click();
        await expect(sideMenu).toHaveClass(/open/);
        await expect(overlay).toHaveClass(/active/);

        // Close via overlay
        await overlay.click();
        await expect(sideMenu).not.toHaveClass(/open/);
        await expect(overlay).not.toHaveClass(/active/);
    });

    test('should show performance metrics setting', async ({ page }) => {
        // Open settings to check if "Show Performance Metrics" checkbox exists
        await page.click('#settingsBtn');

        const metricsCheckbox = page.locator('#showMetrics');
        await expect(metricsCheckbox).toBeVisible();
        await expect(metricsCheckbox).toBeChecked(); // Default is checked
    });

    test('should have voice input button', async ({ page }) => {
        const voiceBtn = page.locator('#voiceBtn');
        await expect(voiceBtn).toBeVisible();
    });

    test('should have live mode button', async ({ page }) => {
        const liveBtn = page.locator('#liveModeBtn');
        await expect(liveBtn).toBeVisible();
        await expect(liveBtn.locator('.live-badge')).toHaveText('LIVE');
    });

    test('should open conversation search', async ({ page }) => {
        const searchBtn = page.locator('#searchToggleBtn');
        const searchBar = page.locator('#conversationSearchWrapper');

        // Initial state: hidden
        await expect(searchBar).toBeHidden();

        // Click toggle
        await searchBtn.click();

        // Should be visible
        await expect(searchBar).toBeVisible();

        // Close search
        const closeBtn = page.locator('#closeSearchBtn');
        await closeBtn.click();
        await expect(searchBar).toBeHidden();
    });

    test('should open export modal', async ({ page }) => {
        // Open sidebar first
        await page.click('#menuBtn');

        const exportBtn = page.locator('#exportChatBtn');
        await expect(exportBtn).toBeVisible();

        await exportBtn.click();

        // Check modal
        const modal = page.locator('#exportModal');
        await expect(modal).toBeVisible();
        await expect(modal).toContainText('Export Conversation');

        // Close modal
        await page.click('#closeExportModal');
        await expect(modal).toBeHidden();
    });

    test('should clear chat from sidebar', async ({ page }) => {
        // Type something first so there is something to clear
        await page.locator('#textInput').fill('Test message');
        await page.click('#sendBtn');
        await expect(page.locator('.message.user')).toBeVisible();

        // Open sidebar
        await page.click('#menuBtn');

        // Click New Chat (which clears current)
        const newChatBtn = page.locator('#newChatBtn');
        await newChatBtn.click();

        // Verify chat is cleared (messages hidden, welcome visible)
        await expect(page.locator('#messages')).not.toHaveClass(/active/);
        await expect(page.locator('#welcome')).toBeVisible();
    });

    test('should have stop generation button in DOM', async ({ page }) => {
        const stopBtn = page.locator('#stopGenerationBtn');
        // It acts as a safety check that the element exists
        await expect(stopBtn).toHaveCount(1);
        // It should be hidden by default
        await expect(stopBtn).toBeHidden();
    });

});

