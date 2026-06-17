/**
 * chrome.js — App-shell chrome that lives outside the wizard flow.
 *
 * Owns the modal dialogs (how-it-works, credits, privacy, hint), the mobile
 * warning dialog, the analytics-gated privacy link, and the build/preview
 * environment pill. None of this participates in step navigation.
 */

import { $, trapFocus } from './dom.js';
import { isEnabled as analyticsEnabled } from './analytics.js';

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

function showEnvironmentPill() {
    const pill = $('env-pill');
    if (!pill) return;

    const isDevBuild = typeof globalThis.__DEV_BUILD__ !== 'undefined' && globalThis.__DEV_BUILD__;
    const isPreviewHost = window.location.hostname.includes('-dev');

    const label = isDevBuild ? 'DEV' : (isPreviewHost ? 'Preview' : null);
    if (!label) return;

    pill.textContent = label;
    pill.hidden = false;
}

export function initChrome() {
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

    showEnvironmentPill();
}
