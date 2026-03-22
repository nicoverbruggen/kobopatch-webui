/**
 * app.js — Main orchestrator.
 *
 * This is the entry point for the application. It:
 *   - Creates the shared state object used by all flow modules
 *   - Kicks off eager data fetches (software URLs, available patches, KOReader)
 *   - Initializes the two flow modules (NickelMenu and custom patches)
 *   - Handles the steps that are shared between flows:
 *       • Step 1: Connection method (connect device or manual mode)
 *       • Device info display and unknown-model warning
 *       • Mode selection (NickelMenu vs custom patches)
 *       • Manual version/model selection
 *       • Error display and retry
 *       • Info dialogs (How It Works, Privacy)
 *
 * Flow modules (nickelmenu-flow.js, patches-flow.js) own their own steps
 * and call back into the orchestrator via `state.goToModeSelection()` and
 * `state.showError()` when they need to cross module boundaries.
 */

import { KoboDevice } from './kobo-device.js';
import { loadSoftwareUrls, getSoftwareUrl, getDevicesForVersion } from './kobo-software-urls.js';
import { PatchUI, scanAvailablePatches } from './patch-ui.js';
import { KoboPatchRunner } from './patch-runner.js';
import { NickelMenuInstaller, ALL_FEATURES } from '../nickelmenu/installer.js';
import { TL } from './strings.js';
import { isEnabled as analyticsEnabled, track } from './analytics.js';
import { $, $q, populateSelect } from './dom.js';
import { showStep, setNavLabels, setNavStep, hideNav, showNav, stepHistory, setupCardRadios } from './nav.js';
import { initNickelMenu } from './nickelmenu-flow.js';
import { initPatchesFlow } from './patches-flow.js';

// =============================================================================
// Shared state
// =============================================================================
// Plain object passed by reference to flow modules so mutations are visible
// everywhere. Contains service instances, mutable UI state, and cross-module
// function references that are set after the functions are defined below.

const state = {
    // Service instances (created once, used throughout the session).
    device: new KoboDevice(),
    patchUI: new PatchUI(),
    runner: new KoboPatchRunner(),
    nmInstaller: new NickelMenuInstaller(),
    // Mutable state that changes as the user progresses through the wizard.
    firmwareURL: null,       // URL to download firmware from (set during device detection or manual selection)
    resultTgz: null,         // Built KoboRoot.tgz bytes (set after successful patch/extract)
    resultNmZip: null,       // Built NickelMenu ZIP bytes (set after NM download flow)
    manualMode: false,       // True when user chose "manual download" instead of connecting a device
    selectedPrefix: null,    // Kobo serial prefix identifying the device model (e.g. "N428")
    patchesLoaded: false,    // True once patch definitions have been loaded for the detected firmware
    isRestore: false,        // True when restoring original firmware (no patches selected)
    selectedMode: null,      // "nickelmenu" or "patches"
    nickelMenuOption: null,  // "preset", "nickelmenu-only", or "remove"
    // Cross-module callbacks — set below after the functions are defined.
    goToModeSelection: null,
    showError: null,
    getSoftwareUrl,
};

// =============================================================================
// Eager fetches
// =============================================================================
// Start loading data immediately so it's ready by the time the user reaches
// a step that needs it. These promises are awaited where needed.

let availablePatches = null;
const softwareUrlsReady = loadSoftwareUrls();
const availablePatchesReady = scanAvailablePatches().then(p => { availablePatches = p; });

// Best-effort KOReader availability check. If the server has KOReader assets,
// mark the feature as available so it shows up in the NickelMenu features list.
// Runs in the background — failure is silently ignored.
const koreaderFeature = ALL_FEATURES.find(f => f.id === 'koreader');
fetch('/koreader/release.json')
    .then(r => r.ok ? r.json() : null)
    .then(meta => {
        if (meta && meta.version) {
            koreaderFeature.available = true;
            koreaderFeature.version = meta.version;
        }
    })
    .catch(() => {});

// =============================================================================
// DOM elements (orchestrator-only)
// =============================================================================

const stepConnect = $('step-connect');
const stepManualVersion = $('step-manual-version');
const stepDevice = $('step-device');
const stepMode = $('step-mode');
const stepPatches = $('step-patches');
const stepError = $('step-error');

const btnConnect = $('btn-connect');
const btnManual = $('btn-manual');
const btnManualConfirm = $('btn-manual-confirm');
const btnManualVersionBack = $('btn-manual-version-back');
const manualVersion = $('manual-version');
const manualModel = $('manual-model');
const btnDeviceNext = $('btn-device-next');
const btnDeviceRestore = $('btn-device-restore');
const btnModeBack = $('btn-mode-back');
const btnModeNext = $('btn-mode-next');
const btnRetry = $('btn-retry');
const btnErrorBack = $('btn-error-back');

const errorMessage = $('error-message');
const errorLog = $('error-log');
const errorTitle = $('error-title');
const errorHint = $('error-hint');
const deviceStatus = $('device-status');
const deviceUnknownWarning = $('device-unknown-warning');
const deviceUnknownAck = $('device-unknown-ack');
const deviceUnknownCheckbox = $('device-unknown-checkbox');
const patchContainer = $('patch-container');

// =============================================================================
// Initialize flow modules
// =============================================================================
// Each flow module receives the shared state, wires up its own event listeners,
// and returns a small API of functions the orchestrator needs.

const nm = initNickelMenu(state);
const patches = initPatchesFlow(state);

// Wire up card-radio interactivity for mode selection and NM option cards.
setupCardRadios(stepMode, 'mode-card-selected');
setupCardRadios($('step-nickelmenu'), 'nm-option-selected');

// =============================================================================
// Error handling
// =============================================================================
// Shared error screen used by both flows. If the user was on the patches step,
// a "Go Back" button lets them return to fix their selections.

function showError(message, log) {
    errorMessage.textContent = message;
    if (log) {
        errorLog.textContent = log;
        errorLog.hidden = false;
        requestAnimationFrame(() => {
            errorLog.scrollTop = errorLog.scrollHeight;
        });
    } else {
        errorLog.hidden = true;
    }

    // If the user came from the patches step, offer a "Go Back" button
    // so they can adjust their selections and retry.
    const hasBackStep = stepHistory.includes(stepPatches);
    if (hasBackStep) {
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

// =============================================================================
// Mode selection
// =============================================================================
// The screen where the user picks between NickelMenu and custom patches.
// In auto mode, the patches option is disabled if no patches are available
// for the detected firmware version.

function goToModeSelection() {
    nm.resetNickelMenuState();
    const patchesRadio = $q('input[value="patches"]', stepMode);
    const patchesCard = patchesRadio.closest('.mode-card');
    const autoModeNoPatchesAvailable = !state.manualMode && (!state.patchesLoaded || !state.firmwareURL);

    // Disable the patches card if firmware patches aren't available.
    const patchesHint = $('mode-patches-hint');
    if (autoModeNoPatchesAvailable) {
        patchesRadio.disabled = true;
        patchesCard.style.opacity = '0.5';
        patchesCard.style.cursor = 'not-allowed';
        patchesHint.hidden = false;
        // Auto-select NickelMenu since it's the only available option.
        const nmRadio = $q('input[value="nickelmenu"]', stepMode);
        nmRadio.checked = true;
        nmRadio.dispatchEvent(new Event('change'));
    } else {
        patchesRadio.disabled = false;
        patchesCard.style.opacity = '';
        patchesCard.style.cursor = '';
        patchesHint.hidden = true;
    }

    setNavLabels(TL.NAV_DEFAULT);
    setNavStep(2);
    showStep(stepMode);
}

state.goToModeSelection = goToModeSelection;

// =============================================================================
// Initial state
// =============================================================================
// Remove the loading spinner and show the first step.

const loader = $('initial-loader');
if (loader) loader.remove();

// Disable the "Connect" button if the File System Access API isn't available.
const hasFileSystemAccess = KoboDevice.isSupported();
if (!hasFileSystemAccess) {
    btnConnect.disabled = true;
    $('connect-unsupported-hint').hidden = false;
}

setNavLabels(TL.NAV_DEFAULT);
setNavStep(1);
showStep(stepConnect);

// =============================================================================
// Step 1: Connection method
// =============================================================================

// "Manual mode" skips device detection and goes straight to mode selection.
btnManual.addEventListener('click', () => {
    state.manualMode = true;
    track('flow-start', { method: 'manual' });
    goToModeSelection();
});

// =============================================================================
// Manual version/model selection
// =============================================================================
// In manual + patches mode, the user picks a software version and model
// from dropdowns before proceeding to the patch configuration step.

manualVersion.addEventListener('change', () => {
    const version = manualVersion.value;
    state.selectedPrefix = null;

    // Show or hide the model dropdown based on whether a version is selected.
    const modelHint = $('manual-model-hint');
    if (!version) {
        manualModel.hidden = true;
        modelHint.hidden = true;
        btnManualConfirm.disabled = true;
        return;
    }

    // Populate the model dropdown with devices that support this version.
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

/** Show the manual version selection screen (awaits eager fetches first). */
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

// =============================================================================
// Device connection
// =============================================================================
// Uses the File System Access API to read device info from the connected Kobo.
// Detects firmware version, model, and serial number. Pre-loads patches if
// available for the detected firmware.

/** Populate the device info display (model, serial with prefix underlined, firmware). */
function displayDeviceInfo(info) {
    $('device-model').textContent = info.model;
    const serialEl = $('device-serial');
    serialEl.textContent = '';
    // Underline the serial prefix to show which part identifies the model.
    const prefixLen = info.serialPrefix.length;
    const u = document.createElement('u');
    u.textContent = info.serial.slice(0, prefixLen);
    serialEl.appendChild(u);
    serialEl.appendChild(document.createTextNode(info.serial.slice(prefixLen)));
    $('device-firmware').textContent = info.firmware;
}

btnConnect.addEventListener('click', async () => {
    track('flow-start', { method: 'connect' });
    try {
        const info = await state.device.connect();

        displayDeviceInfo(info);

        // Block incompatible firmware versions (e.g. 5.x) with a dead-end message.
        if (info.isIncompatible) {
            deviceStatus.textContent =
                'You seem to have an incompatible Kobo software version installed. ' +
                'NickelMenu does not support it, and the custom patches are incompatible with this version.';
            deviceStatus.classList.add('error');
            btnDeviceNext.hidden = true;
            btnDeviceRestore.hidden = true;
            showStep(stepDevice);
            return;
        }

        state.selectedPrefix = info.serialPrefix;

        // Wait for eager fetches and try to match patches for this firmware.
        await Promise.all([softwareUrlsReady, availablePatchesReady]);
        const match = availablePatches.find(p => p.version === info.firmware);

        patches.configureFirmwareStep(info.firmware, info.serialPrefix);

        if (match) {
            await state.patchUI.loadFromURL('patches/' + match.filename);
            state.patchUI.render(patchContainer);
            patches.updatePatchCount();
            state.patchesLoaded = true;
        }

        // Only show "Restore" shortcut if patches and firmware URL are available.
        btnDeviceRestore.hidden = !state.patchesLoaded || !state.firmwareURL;

        // Handle unknown models — require explicit acknowledgment before continuing.
        deviceStatus.classList.remove('error');
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
        // AbortError = user cancelled the file picker; not an error.
        if (err.name === 'AbortError') return;
        showError(err.message);
    }
});

btnDeviceNext.addEventListener('click', () => {
    goToModeSelection();
});

// Unknown model checkbox gate — user must acknowledge the warning to proceed.
deviceUnknownCheckbox.addEventListener('change', () => {
    btnDeviceNext.disabled = !deviceUnknownCheckbox.checked;
});

// "Restore original" shortcut from the device step — skips mode/patch selection.
btnDeviceRestore.addEventListener('click', () => {
    if (!state.patchesLoaded) return;
    state.selectedMode = 'patches';
    state.isRestore = true;
    setNavLabels(TL.NAV_PATCHES);
    patches.goToBuild();
});

/** Load patch definitions for a given firmware version. */
async function loadPatchesForVersion(version, available) {
    const match = available.find(p => p.version === version);
    if (!match) return false;

    await state.patchUI.loadFromURL('patches/' + match.filename);
    state.patchUI.render(patchContainer);
    patches.updatePatchCount();
    state.patchesLoaded = true;
    return true;
}

// =============================================================================
// Mode selection navigation
// =============================================================================
// "Back" returns to the appropriate previous step depending on whether
// the user is in manual or auto (device-connected) mode.

btnModeBack.addEventListener('click', () => {
    setNavStep(1);
    if (state.manualMode) {
        showStep(stepConnect);
    } else {
        showStep(stepDevice);
    }
});

// "Next" enters the selected flow (NickelMenu or custom patches).
btnModeNext.addEventListener('click', async () => {
    const selected = $q('input[name="mode"]:checked', stepMode);
    if (!selected) return;
    state.selectedMode = selected.value;

    if (state.selectedMode === 'nickelmenu') {
        setNavLabels(TL.NAV_NICKELMENU);
        await nm.goToNickelMenuConfig();
    } else if (state.manualMode && !state.patchesLoaded) {
        // Manual mode + patches: need to pick version/model first.
        setNavLabels(TL.NAV_PATCHES);
        await enterManualVersionSelection();
    } else {
        setNavLabels(TL.NAV_PATCHES);
        patches.goToPatches();
    }
});

// =============================================================================
// Error recovery
// =============================================================================

// "Go Back" on the error screen — unwinds history to the patches step
// so the user can adjust selections and retry.
btnErrorBack.addEventListener('click', () => {
    btnErrorBack.hidden = true;
    btnRetry.classList.remove('danger');
    stepHistory.pop();
    while (stepHistory.length > 0 && stepHistory[stepHistory.length - 1] !== stepPatches) {
        stepHistory.pop();
    }
    showNav();
    showStep(stepPatches);
});

// "Start Over" — full reset of all state, back to step 1.
btnRetry.addEventListener('click', () => {
    state.device.disconnect();
    state.firmwareURL = null;
    state.resultTgz = null;
    state.resultNmZip = null;
    state.manualMode = false;
    state.selectedPrefix = null;
    state.patchesLoaded = false;
    state.isRestore = false;
    state.selectedMode = null;
    state.nickelMenuOption = null;
    btnDeviceNext.hidden = false;
    btnDeviceRestore.hidden = false;

    setNavLabels(TL.NAV_DEFAULT);
    setNavStep(1);
    showStep(stepConnect);
});

// =============================================================================
// Dialogs
// =============================================================================
// Modal dialogs for "How It Works" (disclaimer) and "Privacy" (analytics info).
// Clicking the backdrop (the <dialog> element itself) also closes them.

const dialog = $('how-it-works-dialog');
$('btn-how-it-works').addEventListener('click', (e) => {
    e.preventDefault();
    dialog.showModal();
});
$('btn-close-dialog').addEventListener('click', () => {
    dialog.close();
});
dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
});

// Privacy dialog is only shown when analytics are enabled.
if (analyticsEnabled()) {
    $('btn-privacy').hidden = false;
    $('privacy-link-separator').hidden = false;
}
const privacyDialog = $('privacy-dialog');
$('btn-privacy').addEventListener('click', (e) => {
    e.preventDefault();
    privacyDialog.showModal();
});
$('btn-close-privacy').addEventListener('click', () => {
    privacyDialog.close();
});
privacyDialog.addEventListener('click', (e) => {
    if (e.target === privacyDialog) privacyDialog.close();
});
