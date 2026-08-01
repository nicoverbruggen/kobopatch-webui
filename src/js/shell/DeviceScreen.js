/**
 * DeviceScreen.js — The connected-device summary.
 *
 * Owns `step-device`: opening the directory prompt, rendering what was found
 * (model, serial with a reveal toggle, firmware, hardware id, language), the
 * unknown-model acknowledgement, and the "restore original" shortcut.
 */

import { AUDIT_LOG_DIRECTORY } from '../kobo/AuditLog.js';
import { localeDisplayName } from '../kobo/Locale.js';
import { minimumSupportedFirmware } from '../kobo/Version.js';
import { requireButton, requireElement, requireInput } from './DOM.js';
import { setNavLabels, setNavStep } from './Navigation.js';
import { TL } from './Strings.js';
import { latestPatchVersionForFamily } from '../patches/Catalog.js';
import { patchManifestName } from '../patches/AdditionalFiles.js';
import { ShellScreen } from './ShellScreen.js';

const VERIFICATION_HINTS = {
    verified: 'The hardware UUID and serial prefix match this device.',
    refurbished: 'The hardware UUID matches this device. The serial prefix uses the refurbished-device form, which is expected for some Kobo replacements.',
    mismatch:
        'The hardware UUID matches this device, but the serial prefix does not match the expected device family. Custom patches are disabled for this device.',
};
const REFURBISHED_MODEL_HINT = 'This serial number uses the refurbished-device prefix form, which is expected for some Kobo replacements.';
const CUSTOM_PATCHES_MANIFEST_PATH = [AUDIT_LOG_DIRECTORY, patchManifestName];

export class DeviceScreen extends ShellScreen {
    /** @param {import('../Wizard.js').Wizard} nav */
    constructor(nav) {
        super(nav, 'step-device');

        this.btnBack = requireButton('btn-device-back');
        this.btnNext = requireButton('btn-device-next');
        this.btnRestore = requireButton('btn-device-restore');
        this.status = requireElement('device-status');
        this.unknownWarning = requireElement('device-unknown-warning');
        this.unknownAck = requireElement('device-unknown-ack');
        this.unknownCheckbox = requireInput('device-unknown-checkbox');
        this.firmware = requireElement('device-firmware');
        this.hardwareId = requireElement('device-hardware-id');
        this.language = requireElement('device-language');
        this.model = requireElement('device-model');
        this.serial = requireElement('device-serial');

        // Whether the connected device carries a custom-patches manifest, which is
        // what the "restore original" shortcut needs. Lived on `Session` until
        // this screen existed to hold it (Phase 3 §7.1 deferred it here).
        this.hasCustomPatchesManifest = false;

        this.#wireListeners(this.listeners.signal);
    }

    /**
     * Forget what was learned about the device being left.
     *
     * Belt-and-braces: both reads of `hasCustomPatchesManifest` are already safe
     * without this. The restore handler short-circuits on `session.patchesLoaded`,
     * which the session clears, and `connectAndShow` reassigns the flag
     * unconditionally. Kept because the session cleared it on reconnect before it
     * moved here, and this preserves that.
     *
     * Worth keeping for a second reason: a field whose staleness is masked by a
     * *different* field is the shape of the `additionalFileEntries` bug Phase 3
     * existed to fix, and here the masking would cross an object boundary — the
     * guard lives on `Session`, the flag on this screen. Clearing them together
     * is what stops that from becoming load-bearing by accident.
     */
    resetDeviceContext() {
        this.hasCustomPatchesManifest = false;
    }

    /** Re-show this screen with the default breadcrumb — the shared re-entry point. */
    goBack() {
        setNavLabels(TL.NAV_DEFAULT);
        setNavStep(1);
        this.show();
    }

    /** Open the directory prompt, read the device, and show what was found. */
    async connectAndShow() {
        const session = this.session;
        try {
            const info = await session.device.connect();

            this.#displayDeviceInfo(info);

            if (info.isIncompatible) {
                this.#renderIncompatible(info);
                this.btnNext.hidden = true;
                this.btnRestore.hidden = true;
                this.show();
                return;
            }

            session.selectedChannel = info.channel;
            session.patchesUnavailableReason = null;

            await Promise.all([session.softwareUrlsReady, session.availablePatchesReady]);
            const match = session.availablePatches.find((p) => p.version === info.firmware);
            const canPatchDevice = info.deviceVerification === 'verified';

            if (canPatchDevice) {
                this.nav.patches.configureFirmwareStep(info.firmware, info.channel, info.model);
            } else {
                session.firmwareVersion = info.firmware;
                session.firmwareURL = null;
                session.deviceModelLabel = info.model;
                session.patchesUnavailableReason =
                    info.deviceVerification === 'mismatch'
                        ? 'Custom patches are disabled because the hardware UUID and serial prefix do not match.'
                        : 'Custom patches are disabled because this hardware UUID is not recognized.';
            }

            if (canPatchDevice && match) {
                await session.patchUI.loadFromURL('patches/' + match.filename, {
                    version: match.version,
                    patchConfig: match.patches,
                    testedFirmwareVersion: latestPatchVersionForFamily(session.availablePatches, match.version),
                });
                // `patch-container` is `step-patches`', so the patches flow renders it.
                this.nav.patches.renderPatchList();
                this.nav.patches.updatePatchCount();
                session.patchesLoaded = true;
            }

            this.hasCustomPatchesManifest = session.patchesLoaded && !!session.firmwareURL ? await this.#readHasCustomPatchesManifest() : false;
            this.btnRestore.hidden = !this.hasCustomPatchesManifest;

            this.#renderVerificationStatus(info);
            this.btnNext.hidden = false;
            this.show();
        } catch (err) {
            if (err.name === 'AbortError') return;
            if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
                this.nav.showError(TL.ERROR.PERMISSION_DENIED_MESSAGE, null, {
                    title: TL.ERROR.PERMISSION_DENIED_TITLE,
                });
                return;
            }
            this.nav.showError(err.message, null, {
                deviceWrite: !!err.deviceWrite,
                writeProbe: err.deviceOperation === 'write probe',
            });
        }
    }

    async #readHasCustomPatchesManifest() {
        const device = this.session.device;
        if (!device?.directoryHandle) return false;
        try {
            return (await device.readFile(CUSTOM_PATCHES_MANIFEST_PATH)) !== null;
        } catch {
            return false;
        }
    }

    #displayDeviceInfo(info) {
        this.#renderModel(info);
        this.#renderSerial(info.serial, info.rawSerialPrefix || info.serialPrefix);
        this.firmware.textContent = info.firmware;
        this.hardwareId.textContent = info.hardwareId || '--';
        this.#renderLanguage(info.uiLocale);
    }

    #renderLanguage(uiLocale) {
        // Real Kobos always record CurrentLocale; show "Unknown" only when the conf
        // was missing/unreadable, matching the always-present rows above.
        this.language.textContent = localeDisplayName(uiLocale) ?? 'Unknown';
    }

    #renderModel(info) {
        const modelEl = this.model;
        modelEl.textContent = '';
        modelEl.appendChild(document.createTextNode(info.model));

        if (info.isRefurbished) {
            const refurbishedMarker = document.createElement('span');
            refurbishedMarker.className = 'device-refurbished-marker';
            refurbishedMarker.tabIndex = 0;
            refurbishedMarker.textContent = '(refurb.)';
            refurbishedMarker.setAttribute('data-tooltip', REFURBISHED_MODEL_HINT);
            modelEl.appendChild(refurbishedMarker);
        }

        const hint = VERIFICATION_HINTS[info.serialPrefixStatus];
        if (!hint) return;

        const badge = document.createElement('span');
        badge.className = 'device-identification-badge device-identification-badge--' + info.serialPrefixStatus;
        badge.tabIndex = 0;
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', hint);
        badge.setAttribute('data-tooltip', hint);
        badge.innerHTML =
            info.serialPrefixStatus === 'mismatch'
                ? `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M12 2.5l9 17H3l9-17z"/>
                <path d="M12 8v5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
                <circle cx="12" cy="16.5" r="1.2" fill="#fff"/>
            </svg>
        `
                : `
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path fill="currentColor" d="M12 1.75l2.11 1.56 2.62-.25 1.08 2.4 2.39 1.1-.25 2.62L21.5 12l-1.55 2.11.25 2.62-2.39 1.1-1.08 2.4-2.62-.25L12 21.5l-2.11-1.56-2.62.25-1.08-2.4-2.39-1.1.25-2.62L2.5 12l1.55-2.11-.25-2.62 2.39-1.1 1.08-2.4 2.62.25L12 1.75z"/>
                <path d="M8 12.25l2.45 2.45L16.5 8.65" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        modelEl.appendChild(badge);
    }

    #renderSerial(serial, serialPrefix) {
        const serialEl = this.serial;
        serialEl.textContent = '';

        const prefix = serial.slice(0, serialPrefix.length);
        const rest = serial.slice(serialPrefix.length);

        const prefixEl = document.createElement('u');
        prefixEl.textContent = prefix;
        serialEl.appendChild(prefixEl);

        const restEl = document.createElement('span');
        restEl.className = 'serial-rest';
        serialEl.appendChild(restEl);

        if (!rest) {
            restEl.textContent = rest;
            return;
        }

        let revealed = false;
        const masked = '•'.repeat(rest.length);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'serial-reveal secondary';

        const render = () => {
            restEl.textContent = revealed ? rest : masked;
            toggle.textContent = revealed ? 'Hide' : 'Reveal';
            toggle.setAttribute('aria-label', revealed ? 'Hide full serial number' : 'Reveal full serial number');
            toggle.setAttribute('aria-pressed', String(revealed));
        };
        render();

        // No signal: this button is created here and thrown away with the next
        // render, so its listener cannot outlive it the way a markup one would.
        toggle.addEventListener('click', () => {
            revealed = !revealed;
            render();
        });

        serialEl.appendChild(document.createTextNode(' '));
        serialEl.appendChild(toggle);
    }

    #renderIncompatible(info) {
        if (String(info.firmware).split('.')[0] === '5') {
            const heading = document.createElement('strong');
            heading.textContent = "You are currently on a software version that's too recent and not supported by this tool yet.";
            const documentation = document.createElement('a');
            documentation.href = 'https://help.kobo.com/hc/en-us/articles/32246787707799-Kobo-eReader-Accessibility-Features-Support';
            documentation.target = '_blank';
            documentation.rel = 'noopener';
            documentation.textContent = 'official documentation';
            this.status.replaceChildren(
                heading,
                document.createTextNode(
                    ' Some new devices now come with this software version out of the box. You may be able to downgrade via: More > Settings > Device Information > Revert to previous version. Learn more via the ',
                ),
                documentation,
                document.createTextNode('.'),
            );
        } else {
            this.status.textContent =
                'You seem to have an incompatible Kobo software version installed. ' +
                `Kobo software ${minimumSupportedFirmware} or newer is required for NickelMenu, and the custom patches are incompatible with this version.`;
        }
        this.status.classList.add('banner', 'banner--error');
    }

    #renderMismatchStatus() {
        this.status.textContent = '';
        this.status.appendChild(document.createTextNode('Custom patches are disabled because the hardware UUID and serial prefix do not match. '));

        const link = document.createElement('a');
        link.href = 'https://github.com/nicoverbruggen/kobopatch-webui/issues/new';
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Please file an issue';
        this.status.appendChild(link);
        this.status.appendChild(document.createTextNode(' so the developer can add or correct this device.'));
    }

    #renderVerificationStatus(info) {
        this.status.classList.remove('banner', 'banner--error', 'banner--warning');
        const isUnknownHardware = info.deviceVerification === 'unknown';
        const isMismatchedHardware = info.deviceVerification === 'mismatch';
        if (isUnknownHardware) {
            this.status.textContent = '';
            this.unknownWarning.hidden = false;
            this.unknownAck.hidden = false;
            this.unknownCheckbox.checked = false;
            this.btnNext.disabled = true;
        } else if (isMismatchedHardware) {
            this.#renderMismatchStatus();
            this.status.classList.add('banner', 'banner--warning');
            this.unknownWarning.hidden = true;
            this.unknownAck.hidden = true;
            this.unknownCheckbox.checked = false;
            this.btnNext.disabled = false;
        } else {
            this.status.textContent = TL.STATUS.DEVICE_RECOGNIZED;
            this.unknownWarning.hidden = true;
            this.unknownAck.hidden = true;
            this.unknownCheckbox.checked = false;
            this.btnNext.disabled = false;
        }
    }

    #wireListeners(signal) {
        this.btnBack.addEventListener(
            'click',
            () => {
                this.nav.resetDeviceContext();
                // Set before showing: `showStep(step-connect)` hides the breadcrumb,
                // so this value is what appears when `btn-connect` reveals it again.
                setNavStep(1);
                this.nav.goToConnectStep();
            },
            { signal },
        );

        this.btnNext.addEventListener('click', () => this.nav.goToModeSelection(), { signal });

        this.unknownCheckbox.addEventListener(
            'change',
            () => {
                this.btnNext.disabled = !this.unknownCheckbox.checked;
            },
            { signal },
        );

        this.btnRestore.addEventListener(
            'click',
            () => {
                if (!this.session.patchesLoaded || !this.hasCustomPatchesManifest) return;
                this.session.selectedMode = 'patches';
                this.session.isRestore = true;
                setNavLabels(TL.NAV_PATCHES);
                this.nav.goToBuild();
            },
            { signal },
        );
    }
}
