/**
 * connect-flow.js — The "connect a Kobo" front of the wizard.
 *
 * Owns step-connect, step-connect-instructions, and step-device: browser
 * support detection, the direct device connection, device-info display
 * (including the reveal-able serial), the unknown-model acknowledgement, and
 * the "restore original" shortcut. Hands off to mode selection once a device
 * is recognised.
 */

import { KoboDevice } from '../kobo/device.js';
import { AUDIT_LOG_DIRECTORY } from '../kobo/audit-log.js';
import { localeDisplayName } from '../kobo/locale.js';
import { minimumSupportedFirmware } from '../kobo/version.js';
import { $, collect } from '../shell/dom.js';
import { setNavLabels, setNavStep, showNav, showStep } from '../shell/navigation.js';
import { TL } from '../shell/strings.js';
import { track } from '../shell/analytics.js';
import { latestPatchVersionForFamily } from '../patches/catalog.js';
import { patchManifestName } from '../patches/additional-files.js';

export function initConnectFlow(state, { patches }) {
    const {
        'step-connect': stepConnect,
        'step-connect-instructions': stepConnectInstructions,
        'step-device': stepDevice,
        'btn-connect': btnConnect,
        'btn-connect-ready': btnConnectReady,
        'btn-connect-instructions-back': btnConnectInstructionsBack,
        'btn-device-back': btnDeviceBack,
        'btn-device-next': btnDeviceNext,
        'btn-device-restore': btnDeviceRestore,
        'device-status': deviceStatus,
        'device-unknown-warning': deviceUnknownWarning,
        'device-unknown-ack': deviceUnknownAck,
        'device-unknown-checkbox': deviceUnknownCheckbox,
        'patch-container': patchContainer,
    } = collect([
        'step-connect',
        'step-connect-instructions',
        'step-device',
        'btn-connect',
        'btn-connect-ready',
        'btn-connect-instructions-back',
        'btn-device-back',
        'btn-device-next',
        'btn-device-restore',
        'device-status',
        'device-unknown-warning',
        'device-unknown-ack',
        'device-unknown-checkbox',
        'patch-container',
    ]);

    const isAppleMobileDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroidDevice = /Android/i.test(navigator.userAgent);

    const hasFileSystemAccess = KoboDevice.isSupported();
    const canConnectDirectly = hasFileSystemAccess && !isAndroidDevice;
    if (!canConnectDirectly) {
        btnConnect.disabled = true;
        $('connect-unsupported-hint').hidden = false;
        if (isAndroidDevice) {
            $('connect-unsupported-text').innerHTML =
                'Directly connecting your Kobo is not available on Android because Chrome on Android cannot reliably write to a connected Kobo drive. ' +
                'Use the <b>manual download</b> option below, then copy the ZIP contents to your Kobo from a computer.';
        } else if (isAppleMobileDevice) {
            $('connect-unsupported-text').innerHTML =
                'Directly connecting your Kobo is not available on iOS because Safari does not support the ' +
                '<a href="https://caniuse.com/native-filesystem-api">native filesystem API</a>. ' +
                'For the best experience, use <b>Chrome, Edge, or Opera</b> on a desktop or laptop computer. ' +
                'You can still use the <b>manual download</b> option below.';
        }
    }

    {
        const fileManagerEl = $('connect-file-manager');
        const ua = navigator.userAgent;
        if (/Windows/.test(ua)) fileManagerEl.textContent = 'File Explorer';
        else if (/Mac/.test(ua)) fileManagerEl.textContent = 'Finder';
        else fileManagerEl.textContent = 'your file manager';
    }

    const verificationHints = {
        verified: 'The hardware UUID and serial prefix match this device.',
        refurbished: 'The hardware UUID matches this device. The serial prefix uses the refurbished-device form, which is expected for some Kobo replacements.',
        mismatch:
            'The hardware UUID matches this device, but the serial prefix does not match the expected device family. Custom patches are disabled for this device.',
    };
    const refurbishedModelHint = 'This serial number uses the refurbished-device prefix form, which is expected for some Kobo replacements.';
    const customPatchesManifestPath = [AUDIT_LOG_DIRECTORY, patchManifestName];

    function displayDeviceInfo(info) {
        renderModel(info);
        renderSerial(info.serial, info.rawSerialPrefix || info.serialPrefix);
        $('device-firmware').textContent = info.firmware;
        $('device-hardware-id').textContent = info.hardwareId || '--';
        renderLanguage(info.uiLocale);
    }

    function renderLanguage(uiLocale) {
        // Real Kobos always record CurrentLocale; show "Unknown" only when the conf
        // was missing/unreadable, matching the always-present rows above.
        $('device-language').textContent = localeDisplayName(uiLocale) ?? 'Unknown';
    }

    function renderModel(info) {
        const modelEl = $('device-model');
        modelEl.textContent = '';
        modelEl.appendChild(document.createTextNode(info.model));

        if (info.isRefurbished) {
            const refurbishedMarker = document.createElement('span');
            refurbishedMarker.className = 'device-refurbished-marker';
            refurbishedMarker.tabIndex = 0;
            refurbishedMarker.textContent = '(refurb.)';
            refurbishedMarker.setAttribute('data-tooltip', refurbishedModelHint);
            modelEl.appendChild(refurbishedMarker);
        }

        const hint = verificationHints[info.serialPrefixStatus];
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

    function renderSerial(serial, serialPrefix) {
        const serialEl = $('device-serial');
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

        toggle.addEventListener('click', () => {
            revealed = !revealed;
            render();
        });

        serialEl.appendChild(document.createTextNode(' '));
        serialEl.appendChild(toggle);
    }

    function renderMismatchStatus() {
        deviceStatus.textContent = '';
        deviceStatus.appendChild(document.createTextNode('Custom patches are disabled because the hardware UUID and serial prefix do not match. '));

        const link = document.createElement('a');
        link.href = 'https://github.com/nicoverbruggen/kobopatch-webui/issues/new';
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = 'Please file an issue';
        deviceStatus.appendChild(link);
        deviceStatus.appendChild(document.createTextNode(' so the developer can add or correct this device.'));
    }

    async function hasCustomPatchesManifest() {
        if (!state.device?.directoryHandle) return false;
        try {
            return (await state.device.readFile(customPatchesManifestPath)) !== null;
        } catch {
            return false;
        }
    }

    state.goBackToDeviceStep = () => {
        setNavLabels(TL.NAV_DEFAULT);
        setNavStep(1);
        showStep(stepDevice);
    };

    btnConnect.addEventListener('click', () => {
        state.manualMode = false;
        state.patchesLoaded = false;
        track('flow-start', { method: 'connect' });
        showNav();
        showStep(stepConnectInstructions);
    });

    btnConnectInstructionsBack.addEventListener('click', () => {
        showStep(stepConnect);
    });

    btnConnectReady.addEventListener('click', async () => {
        try {
            const info = await state.device.connect();

            displayDeviceInfo(info);

            if (info.isIncompatible) {
                deviceStatus.textContent =
                    'You seem to have an incompatible Kobo software version installed. ' +
                    `Kobo software ${minimumSupportedFirmware} or newer is required for NickelMenu, and the custom patches are incompatible with this version.`;
                deviceStatus.classList.add('banner', 'banner--error');
                btnDeviceNext.hidden = true;
                btnDeviceRestore.hidden = true;
                showStep(stepDevice);
                return;
            }

            state.selectedChannel = info.channel;
            state.patchesUnavailableReason = null;

            await Promise.all([state.softwareUrlsReady, state.availablePatchesReady]);
            const match = state.availablePatches.find((p) => p.version === info.firmware);
            const canPatchDevice = info.deviceVerification === 'verified';

            if (canPatchDevice) {
                patches.configureFirmwareStep(info.firmware, info.channel, info.model);
            } else {
                state.firmwareVersion = info.firmware;
                state.firmwareURL = null;
                state.deviceModelLabel = info.model;
                state.patchesUnavailableReason =
                    info.deviceVerification === 'mismatch'
                        ? 'Custom patches are disabled because the hardware UUID and serial prefix do not match.'
                        : 'Custom patches are disabled because this hardware UUID is not recognized.';
            }

            if (canPatchDevice && match) {
                await state.patchUI.loadFromURL('patches/' + match.filename, {
                    version: match.version,
                    patchConfig: match.patches,
                    testedFirmwareVersion: latestPatchVersionForFamily(state.availablePatches, match.version),
                });
                state.patchUI.render(patchContainer);
                patches.updatePatchCount();
                state.patchesLoaded = true;
            }

            state.hasCustomPatchesManifest = state.patchesLoaded && !!state.firmwareURL ? await hasCustomPatchesManifest() : false;
            btnDeviceRestore.hidden = !state.hasCustomPatchesManifest;

            deviceStatus.classList.remove('banner', 'banner--error', 'banner--warning');
            const isUnknownHardware = info.deviceVerification === 'unknown';
            const isMismatchedHardware = info.deviceVerification === 'mismatch';
            if (isUnknownHardware) {
                deviceStatus.textContent = '';
                deviceUnknownWarning.hidden = false;
                deviceUnknownAck.hidden = false;
                deviceUnknownCheckbox.checked = false;
                btnDeviceNext.disabled = true;
            } else if (isMismatchedHardware) {
                renderMismatchStatus();
                deviceStatus.classList.add('banner', 'banner--warning');
                deviceUnknownWarning.hidden = true;
                deviceUnknownAck.hidden = true;
                deviceUnknownCheckbox.checked = false;
                btnDeviceNext.disabled = false;
            } else {
                deviceStatus.textContent = TL.STATUS.DEVICE_RECOGNIZED;
                deviceUnknownWarning.hidden = true;
                deviceUnknownAck.hidden = true;
                deviceUnknownCheckbox.checked = false;
                btnDeviceNext.disabled = false;
            }
            btnDeviceNext.hidden = false;
            showStep(stepDevice);
        } catch (err) {
            if (err.name === 'AbortError') return;
            if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
                state.showError(TL.ERROR.PERMISSION_DENIED_MESSAGE, null, {
                    title: TL.ERROR.PERMISSION_DENIED_TITLE,
                });
                return;
            }
            state.showError(err.message, null, {
                deviceWrite: !!err.deviceWrite,
                writeProbe: err.deviceOperation === 'write probe',
            });
        }
    });

    btnDeviceBack.addEventListener('click', () => {
        state.resetDeviceContext();
        state.device.reset();
        setNavStep(1);
        showStep(stepConnect);
    });

    btnDeviceNext.addEventListener('click', () => {
        state.goToModeSelection();
    });

    deviceUnknownCheckbox.addEventListener('change', () => {
        btnDeviceNext.disabled = !deviceUnknownCheckbox.checked;
    });

    btnDeviceRestore.addEventListener('click', () => {
        if (!state.patchesLoaded || !state.hasCustomPatchesManifest) return;
        state.selectedMode = 'patches';
        state.isRestore = true;
        setNavLabels(TL.NAV_PATCHES);
        patches.goToBuild();
    });

    function start() {
        setNavLabels(TL.NAV_DEFAULT);
        setNavStep(1);
        showStep(stepConnect);
    }

    return { start };
}
