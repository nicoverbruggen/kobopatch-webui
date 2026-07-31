/**
 * ConnectScreen.js — The landing screen.
 *
 * Owns `step-connect`: browser-support detection, the "connect a Kobo" entry
 * point, and the manual-download alternative. `btn-manual` lives in this
 * screen's partial, so this screen wires it — `manual-flow.js` used to, which
 * was the one element-ownership violation the conversion fixes.
 */

import { KoboDevice } from '../kobo/device.js';
import { requireButton, requireElement } from './dom.js';
import { showNav } from './navigation.js';
import { track } from './analytics.js';
import { ShellScreen } from './ShellScreen.js';

export class ConnectScreen extends ShellScreen {
    /** @param {import('../Wizard.js').Wizard} nav */
    constructor(nav) {
        super(nav, 'step-connect');

        this.btnConnect = requireButton('btn-connect');
        this.btnManual = requireButton('btn-manual');

        this.#applyBrowserSupport();
        this.#wireListeners(this.listeners.signal);
    }

    /**
     * Disable the direct connection where the browser cannot support it, and
     * explain why. Android is excluded even though it has the filesystem API,
     * because Chrome there cannot reliably write to a connected Kobo drive.
     */
    #applyBrowserSupport() {
        const isAppleMobileDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isAndroidDevice = /Android/i.test(navigator.userAgent);

        const hasFileSystemAccess = KoboDevice.isSupported();
        const canConnectDirectly = hasFileSystemAccess && !isAndroidDevice;
        if (canConnectDirectly) return;

        this.btnConnect.disabled = true;
        requireElement('connect-unsupported-hint').hidden = false;
        if (isAndroidDevice) {
            requireElement('connect-unsupported-text').innerHTML =
                'Directly connecting your Kobo is not available on Android because Chrome on Android cannot reliably write to a connected Kobo drive. ' +
                'Use the <b>manual download</b> option below, then copy the ZIP contents to your Kobo from a computer.';
        } else if (isAppleMobileDevice) {
            requireElement('connect-unsupported-text').innerHTML =
                'Directly connecting your Kobo is not available on iOS because Safari does not support the ' +
                '<a href="https://caniuse.com/native-filesystem-api">native filesystem API</a>. ' +
                'For the best experience, use <b>Chrome, Edge, or Opera</b> on a desktop or laptop computer. ' +
                'You can still use the <b>manual download</b> option below.';
        }
    }

    #wireListeners(signal) {
        this.btnConnect.addEventListener(
            'click',
            () => {
                this.session.manualMode = false;
                this.session.patchesLoaded = false;
                track('flow-start', { method: 'connect' });
                // `showStep(step-connect)` hid the breadcrumb on the way in, so it
                // has to be revealed before leaving. It carries whatever step was
                // last set, which is why callers set it before navigating here.
                showNav();
                this.nav.showConnectInstructions();
            },
            { signal },
        );

        this.btnManual.addEventListener('click', () => this.nav.startManualMode(), { signal });
    }
}
