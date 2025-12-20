import { state } from './state.js';

// Request/Response logging
const REQUEST_LOG_ENABLED = true; // Enable for debugging

export function logRequest(type, data) {
    if (!REQUEST_LOG_ENABLED) return;
    console.log(`[REQUEST] ${new Date().toISOString()} - ${type}`, data);
}

export function logResponse(type, data) {
    if (!REQUEST_LOG_ENABLED) return;
    console.log(`[RESPONSE] ${new Date().toISOString()} - ${type}`, data);
}

export function logConnectionState(state, details = '') {
    console.log(`[CONNECTION] ${new Date().toISOString()} - State: ${state}`, details);
    // Note: updateConnectionIndicator needs to be imported or passed if used here
    // For now, we'll return the state so the caller can update UI
    return state;
}

/**
 * Render markdown text to safe HTML
 * @param {string} text - Markdown text to render
 * @returns {string} - Sanitized HTML
 */
export function renderMarkdown(text) {
    if (!text || typeof text !== 'string') return '';

    // Configure marked.js with highlight.js integration
    if (typeof marked !== 'undefined') {
        marked.setOptions({
            highlight: function (code, lang) {
                if (typeof hljs !== 'undefined') {
                    if (lang && hljs.getLanguage(lang)) {
                        try {
                            return hljs.highlight(code, { language: lang }).value;
                        } catch (e) {
                            console.error('Highlight error:', e);
                        }
                    }
                    try {
                        return hljs.highlightAuto(code).value;
                    } catch (e) {
                        console.error('Highlight auto error:', e);
                        return code;
                    }
                }
                return code;
            },
            breaks: true,        // GFM line breaks
            gfm: true,          // GitHub Flavored Markdown
            tables: true,       // Support tables
            smartLists: true,   // Better list handling
            smartypants: false  // Don't convert quotes/dashes
        });

        try {
            // Parse markdown to HTML
            const rawHtml = marked.parse(text);

            // Sanitize HTML with DOMPurify
            if (typeof DOMPurify !== 'undefined') {
                return DOMPurify.sanitize(rawHtml, {
                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'div', 'span'],
                    ALLOWED_ATTR: ['href', 'target', 'rel', 'class']
                });
            }
            return rawHtml;
        } catch (e) {
            console.error('Markdown render error:', e);
            return text; // Fallback to plain text on error
        }
    }

    return text; // Fallback if marked is not loaded
}

/**
 * Add copy buttons to code blocks
 * @param {HTMLElement} container - Container element with rendered markdown
 */
export function addCopyButtonsToCodeBlocks(container) {
    if (!container) return;

    const codeBlocks = container.querySelectorAll('pre > code');

    codeBlocks.forEach((codeBlock) => {
        const pre = codeBlock.parentElement;

        // Skip if copy button already exists
        if (pre.querySelector('.code-copy-btn')) return;

        // Create copy button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'code-copy-btn';
        copyBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
        `;
        copyBtn.setAttribute('aria-label', 'Copy code');
        copyBtn.title = 'Copy code';

        // Add click handler
        copyBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();

            try {
                const code = codeBlock.textContent;
                await navigator.clipboard.writeText(code);

                // Visual feedback
                copyBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                `;
                copyBtn.classList.add('copied');

                showToast('Code copied to clipboard!', 'success');

                // Reset button after 2 seconds
                setTimeout(() => {
                    copyBtn.innerHTML = `
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                    `;
                    copyBtn.classList.remove('copied');
                }, 2000);
            } catch (err) {
                console.error('Failed to copy code:', err);
                showToast('Failed to copy code', 'error');
            }
        };

        // Add button to pre element
        pre.style.position = 'relative';
        pre.appendChild(copyBtn);
    });
}

// Toast Notification System
export function showToast(message, type = 'success', duration = 2000) {
    // Suppress info and success toasts during initialization
    if (state.isInitializing && (type === 'success' || type === 'info')) {
        console.log(`[TOAST SUPPRESSED during init] (${type}): ${message}`);
        return;
    }

    const container = document.getElementById('toastContainer');
    if (!container) return;

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Create icon based on type
    let iconSVG = '';
    if (type === 'success') {
        iconSVG = '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    } else if (type === 'error') {
        iconSVG = '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    } else {
        iconSVG = '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }

    toast.innerHTML = `
        ${iconSVG}
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Auto-remove after duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
