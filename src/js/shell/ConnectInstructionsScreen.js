/**
 * ConnectInstructionsScreen.js — "Plug your Kobo in and confirm" .
 *
 * Owns `step-connect-instructions`: the short instruction list shown between the
 * landing screen and the device picker, and the button that opens the browser's
 * directory prompt.
 */

import { requireButton, requireElement } from './dom.js';
import { ShellScreen } from './ShellScreen.js';

export class ConnectInstructionsScreen extends ShellScreen {
    /** @param {import('../Wizard.js').Wizard} nav */
    constructor(nav) {
        super(nav, 'step-connect-instructions');

        this.btnReady = requireButton('btn-connect-ready');
        this.btnBack = requireButton('btn-connect-instructions-back');

        this.#nameFileManager();
        this.#wireListeners(this.listeners.signal);
    }

    /** Call the user's file manager by its actual name, so the steps read right. */
    #nameFileManager() {
        const fileManagerEl = requireElement('connect-file-manager');
        const ua = navigator.userAgent;
        if (/Windows/.test(ua)) fileManagerEl.textContent = 'File Explorer';
        else if (/Mac/.test(ua)) fileManagerEl.textContent = 'Finder';
        else fileManagerEl.textContent = 'your file manager';
    }

    #wireListeners(signal) {
        this.btnReady.addEventListener('click', () => this.nav.connectDevice(), { signal });
        this.btnBack.addEventListener('click', () => this.nav.goToConnectStep(), { signal });
    }
}
