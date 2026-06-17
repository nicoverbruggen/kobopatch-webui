import { KoboDevice } from './kobo/device.js';
import { loadSoftwareUrls, getSoftwareUrl, getDevicesForVersion } from './kobo/software-urls.js';
import { PatchUI, scanAvailablePatches } from './patches/ui.js';
import { KoboPatchRunner } from './patches/runner.js';
import { NickelMenuInstaller, NICKELMENU_FEATURES } from './nickelmenu/installer.js';
import { installablesManifest } from './nickelmenu/installables.js';
import { Session } from './shell/session.js';
import { TL } from './shell/strings.js';
import { isEnabled as analyticsEnabled, track } from './shell/analytics.js';
import { $, $q, $qa, collect, populateSelect, trapFocus, triggerDownload } from './shell/dom.js';
import { showStep, setNavLabels, setNavStep, hideNav, showNav, stepHistory, setupCardRadios } from './shell/navigation.js';
import { getActiveFlow, deactivateFlow } from './shell/step-machine.js';
import { initNickelMenu } from './flows/nickelmenu-flow.js';
import { initPatchesFlow } from './flows/patches-flow.js';

const state = Object.assign(new Session(), {
    device: new KoboDevice(),
    patchUI: new PatchUI(),
    runner: new KoboPatchRunner(),
    nmInstaller: new NickelMenuInstaller(),
    getSoftwareUrl,
});

let availablePatches = null;
const softwareUrlsReady = loadSoftwareUrls();
const availablePatchesReady = scanAvailablePatches().then(p => { availablePatches = p; });
const blacklistReady = state.patchUI.loadBlacklist();

for (const [id, info] of Object.entries(installablesManifest())) {
    const feature = NICKELMENU_FEATURES.find(f => f.id === id);
    if (feature && info.available) {
        feature.available = true;
        feature.version = info.version;
    }
}

const {
    'step-connect': stepConnect,
    'step-connect-instructions': stepConnectInstructions,
    'step-manual-version': stepManualVersion,
    'step-device': stepDevice,
    'step-mode': stepMode,
    'step-patches': stepPatches,
    'step-error': stepError,
    'btn-connect': btnConnect,
    'btn-connect-ready': btnConnectReady,
    'btn-connect-instructions-back': btnConnectInstructionsBack,
    'btn-manual': btnManual,
    'btn-manual-confirm': btnManualConfirm,
    'btn-manual-version-back': btnManualVersionBack,
    'manual-version': manualVersion,
    'manual-model': manualModel,
    'btn-device-back': btnDeviceBack,
    'btn-device-next': btnDeviceNext,
    'btn-device-restore': btnDeviceRestore,
    'btn-mode-back': btnModeBack,
    'btn-mode-next': btnModeNext,
    'btn-retry': btnRetry,
    'btn-error-back': btnErrorBack,
    'btn-error-download-log': btnErrorDownloadLog,
    'error-message': errorMessage,
    'error-log': errorLog,
    'error-title': errorTitle,
    'error-hint': errorHint,
    'error-device-write-help': errorDeviceWriteHelp,
    'device-status': deviceStatus,
    'device-unknown-warning': deviceUnknownWarning,
    'device-unknown-ack': deviceUnknownAck,
    'device-unknown-checkbox': deviceUnknownCheckbox,
    'patch-container': patchContainer,
} = collect([
    'step-connect', 'step-connect-instructions', 'step-manual-version', 'step-device',
    'step-mode', 'step-patches', 'step-error',
    'btn-connect', 'btn-connect-ready', 'btn-connect-instructions-back',
    'btn-manual', 'btn-manual-confirm', 'btn-manual-version-back',
    'manual-version', 'manual-model',
    'btn-device-back', 'btn-device-next', 'btn-device-restore',
    'btn-mode-back', 'btn-mode-next',
    'btn-retry', 'btn-error-back', 'btn-error-download-log',
    'error-message', 'error-log', 'error-title', 'error-hint', 'error-device-write-help',
    'device-status', 'device-unknown-warning', 'device-unknown-ack', 'device-unknown-checkbox',
    'patch-container',
]);
let errorAuditLog = null;

const nm = initNickelMenu(state);
const patches = initPatchesFlow(state);

setupCardRadios(stepMode, 'selection-card--selected', () => { btnModeNext.disabled = false; });
setupCardRadios($('step-nickelmenu'), 'selection-card--selected');

function showError(message, log, options = {}) {
    errorAuditLog = options.auditLog || null;
    errorMessage.textContent = message;
    errorDeviceWriteHelp.hidden = !options.deviceWrite;
    btnErrorDownloadLog.hidden = !errorAuditLog;
    if (log) {
        errorLog.textContent = log;
        errorLog.hidden = false;
        requestAnimationFrame(() => {
            errorLog.scrollTop = errorLog.scrollHeight;
        });
    } else {
        errorLog.hidden = true;
    }

    const flow = getActiveFlow();
    const hasRecovery = flow && flow.recoveryTarget() && flow.current();
    const hasBackStep = stepHistory.includes(stepPatches);

    if (options.deviceWrite) {
        if (options.writeProbe) {
            errorTitle.textContent = TL.ERROR.DEVICE_PROBE_FAILED_TITLE;
            errorMessage.textContent = TL.ERROR.DEVICE_PROBE_FAILED_MESSAGE;
        } else {
            errorTitle.textContent = TL.ERROR.DEVICE_WRITE_FAILED_TITLE;
            errorMessage.textContent = TL.ERROR.DEVICE_WRITE_FAILED_MESSAGE;
        }
        errorHint.hidden = true;
        btnErrorBack.hidden = true;
        btnRetry.classList.remove('danger');
    } else if (options.title) {
        errorTitle.textContent = options.title;
        errorHint.hidden = true;
        btnErrorBack.hidden = true;
        btnRetry.classList.remove('danger');
    } else if (hasRecovery) {
        errorTitle.textContent = TL.ERROR.PATCH_FAILED;
        errorHint.hidden = false;
        btnErrorBack.hidden = false;
        btnRetry.classList.add('danger');
    } else if (hasBackStep) {
        errorTitle.textContent = TL.ERROR.PATCH_FAILED;
        errorHint.hidden = false;
        btnErrorBack.hidden = false;
        btnRetry.classList.add('danger');
    } else {
        errorTitle.textContent = TL.ERROR.SOMETHING_WENT_WRONG;
        errorHint.hidden = true;
        btnErrorBack.hidden = true;
        btnRetry.classList.remove('danger');
    }
    hideNav();
    showStep(stepError);
}

state.showError = showError;
state.goBackToDeviceStep = () => {
    setNavLabels(TL.NAV_DEFAULT);
    setNavStep(1);
    showStep(stepDevice);
};
state.goToManualVersionStep = () => {
    setNavStep(2);
    showStep(stepManualVersion);
};

let handlingUnexpectedError = false;
function handleUnexpectedError(err) {
    if (handlingUnexpectedError) return;
    if (err && err.name === 'AbortError') return;
    handlingUnexpectedError = true;
    try {
        const detail = err ? (err.stack || err.message || String(err)) : 'Unknown error';
        showError(TL.ERROR.UNEXPECTED_MESSAGE, detail, { title: TL.ERROR.UNEXPECTED_TITLE });
    } catch (e) {
        console.error('Failed to display the error screen:', e);
    } finally {
        handlingUnexpectedError = false;
    }
}

window.addEventListener('error', (event) => {
    if (!event.error) return;
    handleUnexpectedError(event.error);
});
window.addEventListener('unhandledrejection', (event) => {
    handleUnexpectedError(event.reason);
});

function goToModeSelection() {
    deactivateFlow();
    nm.resetNickelMenuState();
    btnModeNext.disabled = true;

    for (const radio of $qa('input[name="mode"]', stepMode)) {
        radio.checked = false;
        radio.closest('.selection-card')?.classList.remove('selection-card--selected');
    }

    const patchesRadio = $q('input[value="patches"]', stepMode);
    const patchesCard = patchesRadio.closest('.selection-card');
    const autoModeNoPatchesAvailable = !state.manualMode && (!state.patchesLoaded || !state.firmwareURL);

    const patchesHint = $('mode-patches-hint');
    if (autoModeNoPatchesAvailable) {
        patchesRadio.disabled = true;
        patchesCard.classList.add('selection-card--disabled');
        patchesHint.hidden = false;
        const nmRadio = $q('input[value="nickelmenu"]', stepMode);
        nmRadio.checked = true;
        nmRadio.dispatchEvent(new Event('change'));
    } else {
        patchesRadio.disabled = false;
        patchesCard.classList.remove('selection-card--disabled');
        patchesHint.hidden = true;
    }

    setNavLabels(TL.NAV_DEFAULT);
    setNavStep(2);
    showStep(stepMode);
}

state.goToModeSelection = goToModeSelection;

const loader = $('initial-loader');
if (loader) loader.remove();

const isMobileDevice = navigator.maxTouchPoints > 0 && window.innerWidth < 820;
if (isMobileDevice) {
    const mobileDialog = $('mobile-dialog');
    mobileDialog.showModal();
    $('btn-mobile-continue').addEventListener('click', () => mobileDialog.close());
}

const isAppleMobileDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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

setNavLabels(TL.NAV_DEFAULT);
setNavStep(1);
showStep(stepConnect);

btnManual.addEventListener('click', () => {
    state.manualMode = true;
    track('flow-start', { method: 'manual' });
    goToModeSelection();
});

manualVersion.addEventListener('change', () => {
    const version = manualVersion.value;
    state.selectedPrefix = null;

    const modelHint = $('manual-model-hint');
    if (!version) {
        manualModel.hidden = true;
        modelHint.hidden = true;
        btnManualConfirm.disabled = true;
        return;
    }

    const devices = getDevicesForVersion(version);
    populateSelect(manualModel, '-- Select your Kobo model --',
        devices.map(d => ({ value: d.prefix, text: d.model }))
    );
    manualModel.hidden = false;
    modelHint.hidden = false;
    btnManualConfirm.disabled = true;
});

manualModel.addEventListener('change', () => {
    state.selectedPrefix = manualModel.value || null;
    btnManualConfirm.disabled = !manualVersion.value || !manualModel.value;
});

btnManualConfirm.addEventListener('click', async () => {
    const version = manualVersion.value;
    if (!version || !state.selectedPrefix) return;

    try {
        const loaded = await loadPatchesForVersion(version, availablePatches);
        if (!loaded) {
            showError(TL.ERROR.LOAD_PATCHES_FAILED(version));
            return;
        }
        patches.configureFirmwareStep(version, state.selectedPrefix);
        patches.goToPatches();
    } catch (err) {
        showError(err.message);
    }
});

async function enterManualVersionSelection() {
    await Promise.all([softwareUrlsReady, availablePatchesReady]);
    populateSelect(manualVersion, '-- Select software version --',
        availablePatches.map(p => ({ value: p.version, text: p.version, data: { filename: p.filename } }))
    );
    populateSelect(manualModel, '-- Select your Kobo model --', []);
    manualModel.hidden = true;
    btnManualConfirm.disabled = true;
    setNavStep(2);
    showStep(stepManualVersion);
}

btnManualVersionBack.addEventListener('click', () => {
    goToModeSelection();
});

function displayDeviceInfo(info) {
    $('device-model').textContent = info.model;
    renderSerial(info.serial, info.serialPrefix);
    $('device-firmware').textContent = info.firmware;
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
    const masked = '\u2022'.repeat(rest.length);

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

{
    const fileManagerEl = $('connect-file-manager');
    const ua = navigator.userAgent;
    if (/Windows/.test(ua)) fileManagerEl.textContent = 'File Explorer';
    else if (/Mac/.test(ua)) fileManagerEl.textContent = 'Finder';
    else fileManagerEl.textContent = 'your file manager';
}

btnConnect.addEventListener('click', () => {
    state.manualMode = false;
    state.patchesLoaded = false;
    track('flow-start', { method: 'connect' });
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
                'NickelMenu does not support it, and the custom patches are incompatible with this version.';
            deviceStatus.classList.add('banner', 'banner--error');
            btnDeviceNext.hidden = true;
            btnDeviceRestore.hidden = true;
            showStep(stepDevice);
            return;
        }

        state.selectedPrefix = info.serialPrefix;

        await Promise.all([softwareUrlsReady, availablePatchesReady]);
        const match = availablePatches.find(p => p.version === info.firmware);

        patches.configureFirmwareStep(info.firmware, info.serialPrefix);

        if (match) {
            await state.patchUI.loadFromURL('patches/' + match.filename);
            state.patchUI.render(patchContainer);
            patches.updatePatchCount();
            state.patchesLoaded = true;
        }

        btnDeviceRestore.hidden = !state.patchesLoaded || !state.firmwareURL;

        deviceStatus.classList.remove('banner', 'banner--error');
        const isUnknownModel = info.model.startsWith('Unknown');
        if (isUnknownModel) {
            deviceStatus.textContent = '';
            deviceUnknownWarning.hidden = false;
            deviceUnknownAck.hidden = false;
            deviceUnknownCheckbox.checked = false;
            btnDeviceNext.disabled = true;
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
            showError(TL.ERROR.PERMISSION_DENIED_MESSAGE, null, {
                title: TL.ERROR.PERMISSION_DENIED_TITLE,
            });
            return;
        }
        showError(err.message, null, {
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
    goToModeSelection();
});

deviceUnknownCheckbox.addEventListener('change', () => {
    btnDeviceNext.disabled = !deviceUnknownCheckbox.checked;
});

btnDeviceRestore.addEventListener('click', () => {
    if (!state.patchesLoaded) return;
    state.selectedMode = 'patches';
    state.isRestore = true;
    setNavLabels(TL.NAV_PATCHES);
    patches.goToBuild();
});

async function loadPatchesForVersion(version, available) {
    const match = available.find(p => p.version === version);
    if (!match) return false;

    await Promise.all([state.patchUI.loadFromURL('patches/' + match.filename), blacklistReady]);
    state.patchUI.render(patchContainer);
    patches.updatePatchCount();
    state.patchesLoaded = true;
    return true;
}

btnModeBack.addEventListener('click', () => {
    setNavStep(1);
    if (state.manualMode) {
        showStep(stepConnect);
    } else {
        showStep(stepDevice);
    }
});

btnModeNext.addEventListener('click', async () => {
    const selected = $q('input[name="mode"]:checked', stepMode);
    if (!selected) return;
    state.selectedMode = selected.value;

    if (state.selectedMode === 'nickelmenu') {
        setNavLabels(TL.NAV_NICKELMENU);
        await nm.goToNickelMenuConfig();
    } else if (state.manualMode && !state.patchesLoaded) {
        setNavLabels(TL.NAV_PATCHES);
        await enterManualVersionSelection();
    } else {
        setNavLabels(TL.NAV_PATCHES);
        patches.goToPatches();
    }
});

btnErrorBack.addEventListener('click', () => {
    const flow = getActiveFlow();
    const recoveryDomId = flow && flow.recoveryTarget();

    if (recoveryDomId) {
        showNav();
        btnErrorBack.hidden = true;
        btnErrorDownloadLog.hidden = true;
        errorAuditLog = null;
        btnRetry.classList.remove('danger');
        const recoveryDomStep = document.getElementById(recoveryDomId);
        if (recoveryDomStep) {
            showStep(recoveryDomStep);
        }
        return;
    }

    btnErrorBack.hidden = true;
    btnErrorDownloadLog.hidden = true;
    errorAuditLog = null;
    btnRetry.classList.remove('danger');
    stepHistory.pop();
    while (stepHistory.length > 0 && stepHistory[stepHistory.length - 1] !== stepPatches) {
        stepHistory.pop();
    }
    showNav();
    showStep(stepPatches);
});

btnErrorDownloadLog.addEventListener('click', () => {
    if (!errorAuditLog) return;
    const filename = errorAuditLog.path[errorAuditLog.path.length - 1] || 'kobopatch-webui.log';
    triggerDownload(errorAuditLog.render(), filename, 'text/plain');
});

btnRetry.addEventListener('click', () => {
    location.reload();
});

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

showEnvironmentPill();
