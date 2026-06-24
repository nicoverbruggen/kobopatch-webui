/**
 * global-ui.js — Global app UI that lives outside the wizard flow.
 *
 * Owns the modal dialogs (how-it-works, credits, privacy, hint), the mobile
 * warning dialog, the analytics-gated privacy link, and the build/preview
 * environment pill. None of this participates in step navigation.
 */

import { $, trapFocus } from './dom.js';
import { isEnabled as analyticsEnabled } from './analytics.js';

function isDevBuild() {
    return typeof globalThis.__DEV_BUILD__ !== 'undefined' && globalThis.__DEV_BUILD__;
}

function isPreviewDeploy() {
    return window.location.hostname === 'kp-dev.nicoverbruggen.be';
}

function shouldShowPreviewChrome() {
    return isDevBuild() || isPreviewDeploy();
}

function setupDialog(dialogId, openBtnId, closeBtnId) {
    const dlg = $(dialogId);
    trapFocus(dlg);
    $(openBtnId).addEventListener('click', (e) => {
        e.preventDefault();
        dlg.showModal();
        const closeBtn = $(closeBtnId);
        if (closeBtn) closeBtn.focus();
    });
    $(closeBtnId).addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close();
    });
}

function setupCloseOnlyDialog(dialogId, closeBtnId) {
    const dlg = $(dialogId);
    const closeBtn = $(closeBtnId);
    if (!dlg || !closeBtn) return;
    trapFocus(dlg);
    closeBtn.addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => {
        if (e.target === dlg) dlg.close();
    });
}

// The theme follows the OS. The inline <head> script sets data-theme on first
// load; here we keep it in sync if the system theme changes mid-session. The
// swap suppresses transitions so colours flip instantly rather than animating.
function setupTheme() {
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const root = document.documentElement;
        root.classList.add('theme-no-transition');
        root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
        void root.offsetWidth;
        root.classList.remove('theme-no-transition');
    });
}

function showEnvironmentPill() {
    const pill = $('env-pill');
    if (!pill) return;

    const label = isDevBuild() ? 'Under Development' : isPreviewDeploy() ? 'Preview' : null;
    if (!label) return;

    pill.textContent = label;
    pill.hidden = false;
}

function injectPreviewBanner() {
    if (!shouldShowPreviewChrome() || $('preview-banner')) return;

    const main = $('main-content');
    if (!main) return;

    const banner = document.createElement('div');
    banner.id = 'preview-banner';
    banner.className = 'preview-banner';
    banner.innerHTML = `
        <div class="preview-banner-inner">
            <div class="preview-banner-message">
                <span class="preview-banner-icon" aria-hidden="true">
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10 2.5 18 17.5H2z"></path>
                        <path d="M10 7v4.5"></path>
                        <path d="M10 14.5h.01"></path>
                    </svg>
                </span>
                <p class="preview-banner-text">
                    <strong>This is a preview version.</strong> You can test upcoming changes here.
                    Visit the <a href="https://kp.nicoverbruggen.be" target="_blank" rel="noopener">stable version</a>
                    instead if you're unsure which one to use.
                </p>
            </div>
            <button id="btn-preview-banner-close" class="preview-banner-close" type="button" aria-label="Dismiss preview banner">&times;</button>
        </div>
    `;
    main.before(banner);
    $('btn-preview-banner-close')?.addEventListener('click', () => {
        banner.remove();
    });
}

export function initGlobalUI() {
    const isMobileDevice = navigator.maxTouchPoints > 0 && window.innerWidth < 820;
    if (isMobileDevice) {
        const mobileDialog = $('mobile-dialog');
        mobileDialog.showModal();
        $('btn-mobile-continue').addEventListener('click', () => mobileDialog.close());
    }

    setupDialog('how-it-works-dialog', 'btn-how-it-works', 'btn-close-dialog');
    setupDialog('credits-dialog', 'btn-credits', 'btn-close-credits');

    const hintDialog = $('hint-dialog');
    $('btn-hint-close').addEventListener('click', () => hintDialog.close());
    hintDialog.addEventListener('click', (e) => {
        if (e.target === hintDialog) hintDialog.close();
    });

    if (analyticsEnabled()) {
        $('btn-privacy').hidden = false;
        $('privacy-link-separator').hidden = false;
    }
    setupDialog('privacy-dialog', 'btn-privacy', 'btn-close-privacy');
    setupCloseOnlyDialog('patch-blacklist-dialog', 'btn-patch-blacklist-close');

    setupTheme();
    showEnvironmentPill();
    injectPreviewBanner();
}
