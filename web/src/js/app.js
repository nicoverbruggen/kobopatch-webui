import { KoboDevice, KoboModels } from './kobo-device.js';
import { loadSoftwareUrls, getSoftwareUrl, getDevicesForVersion } from './kobo-software-urls.js';
import { PatchUI, scanAvailablePatches } from './patch-ui.js';
import { KoboPatchRunner } from './patch-runner.js';
import { NickelMenuInstaller } from './nickelmenu.js';
import JSZip from 'jszip';

(() => {
    const device = new KoboDevice();
    const patchUI = new PatchUI();
    const runner = new KoboPatchRunner();
    const nmInstaller = new NickelMenuInstaller();

    let firmwareURL = null;
    let resultTgz = null;
    let resultNmZip = null;
    let manualMode = false;
    let selectedPrefix = null;
    let patchesLoaded = false;
    let isRestore = false;
    let availablePatches = null;
    let selectedMode = null;        // 'nickelmenu' | 'patches'
    let nickelMenuOption = null;    // 'sample' | 'nickelmenu-only' | 'remove'

    // Fetch data eagerly so it's ready when needed.
    const softwareUrlsReady = loadSoftwareUrls();
    const availablePatchesReady = scanAvailablePatches().then(p => { availablePatches = p; });

    // --- Helpers ---

    const $ = (id) => document.getElementById(id);
    const $q = (sel, ctx = document) => ctx.querySelector(sel);
    const $qa = (sel, ctx = document) => ctx.querySelectorAll(sel);

    function formatMB(bytes) {
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    function populateSelect(selectEl, placeholder, items) {
        selectEl.innerHTML = '';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = placeholder;
        selectEl.appendChild(defaultOpt);
        for (const { value, text, data } of items) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = text;
            if (data) {
                for (const [k, v] of Object.entries(data)) {
                    opt.dataset[k] = v;
                }
            }
            selectEl.appendChild(opt);
        }
    }

    function triggerDownload(data, filename, mimeType) {
        const blob = new Blob([data], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // --- DOM elements ---
    const stepNav = $('step-nav');
    const stepConnect = $('step-connect');
    const stepManualVersion = $('step-manual-version');
    const stepDevice = $('step-device');
    const stepMode = $('step-mode');
    const stepNickelMenu = $('step-nickelmenu');
    const stepNmInstalling = $('step-nm-installing');
    const stepNmDone = $('step-nm-done');
    const stepPatches = $('step-patches');
    const stepFirmware = $('step-firmware');
    const stepBuilding = $('step-building');
    const stepDone = $('step-done');
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
    const btnNmBack = $('btn-nm-back');
    const btnNmNext = $('btn-nm-next');
    const btnNmReviewBack = $('btn-nm-review-back');
    const btnNmWrite = $('btn-nm-write');
    const btnNmDownload = $('btn-nm-download');
    const btnPatchesBack = $('btn-patches-back');
    const btnPatchesNext = $('btn-patches-next');
    const btnBuildBack = $('btn-build-back');
    const btnWrite = $('btn-write');
    const btnDownload = $('btn-download');
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
    const buildStatus = $('build-status');
    const existingTgzWarning = $('existing-tgz-warning');
    const writeInstructions = $('write-instructions');
    const downloadInstructions = $('download-instructions');
    const firmwareVersionLabel = $('firmware-version-label');
    const firmwareDeviceLabel = $('firmware-device-label');
    const patchCountHint = $('patch-count-hint');

    const stepNmReview = $('step-nm-review');

    const allSteps = [
        stepConnect, stepManualVersion, stepDevice,
        stepMode, stepNickelMenu, stepNmReview, stepNmInstalling, stepNmDone,
        stepPatches, stepFirmware, stepBuilding, stepDone,
        stepError,
    ];

    // --- Step navigation ---
    const NAV_NICKELMENU = ['Device', 'Mode', 'Configure', 'Review', 'Install'];
    const NAV_PATCHES = ['Device', 'Mode', 'Patches', 'Build', 'Install'];
    const NAV_DEFAULT = ['Device', 'Mode', 'Patches', 'Build', 'Install'];

    let currentNavLabels = NAV_DEFAULT;

    const stepHistory = [stepConnect];

    function pushStep(step) {
        stepHistory.push(step);
    }

    function popStep() {
        stepHistory.pop();
        return stepHistory[stepHistory.length - 1];
    }

    function setNavLabels(labels) {
        currentNavLabels = labels;
        const ol = $q('ol', stepNav);
        ol.innerHTML = '';
        for (const label of labels) {
            const li = document.createElement('li');
            li.textContent = label;
            ol.appendChild(li);
        }
    }

    function showStep(step, updateHistory = true) {
        for (const s of allSteps) {
            s.hidden = (s !== step);
        }
        if (updateHistory) {
            stepHistory[stepHistory.length - 1] = step;
        }
    }

    function setNavStep(num) {
        const items = $qa('li', stepNav);
        items.forEach((li, i) => {
            const stepNum = i + 1;
            li.classList.remove('active', 'done');
            if (stepNum < num) li.classList.add('done');
            else if (stepNum === num) li.classList.add('active');
        });
        stepNav.hidden = false;
    }

    function hideNav() {
        stepNav.hidden = true;
    }

    function showNav() {
        stepNav.hidden = false;
    }

    // --- Mode selection card interactivity ---
    function setupCardRadios(container, selectedClass) {
        const labels = $qa('label', container);
        for (const label of labels) {
            const radio = $q('input[type="radio"]', label);
            if (!radio) continue;
            radio.addEventListener('change', () => {
                for (const l of labels) {
                    if ($q('input[type="radio"]', l)) l.classList.remove(selectedClass);
                }
                if (radio.checked) label.classList.add(selectedClass);
            });
        }
    }

    setupCardRadios(stepMode, 'mode-card-selected');
    setupCardRadios(stepNickelMenu, 'nm-option-selected');

    // --- Patch count ---
    function updatePatchCount() {
        const count = patchUI.getEnabledCount();
        btnPatchesNext.disabled = false;
        if (count === 0) {
            patchCountHint.textContent = 'No patches selected \u2014 continuing will restore the original unpatched software.';
        } else {
            patchCountHint.textContent = count === 1 ? '1 patch selected.' : count + ' patches selected.';
        }
    }

    patchUI.onChange = updatePatchCount;

    // --- Firmware step config ---
    function configureFirmwareStep(version, prefix) {
        firmwareURL = prefix ? getSoftwareUrl(prefix, version) : null;
        firmwareVersionLabel.textContent = version;
        firmwareDeviceLabel.textContent = KoboModels[prefix] || prefix;
        $('firmware-download-url').textContent = firmwareURL || '';
    }

    // --- Initial state ---
    const loader = $('initial-loader');
    if (loader) loader.remove();

    const hasFileSystemAccess = KoboDevice.isSupported();

    // Disable "Connect my Kobo" button on unsupported browsers
    if (!hasFileSystemAccess) {
        btnConnect.disabled = true;
        $('connect-unsupported-hint').hidden = false;
    }

    setNavLabels(NAV_DEFAULT);
    setNavStep(1);
    showStep(stepConnect);

    // --- Step 1: Connection method ---
    // "Connect my Kobo" — triggers File System Access API
    // (click handler is further below where device connection is handled)

    // "Download files manually" — enter manual mode, go to mode selection
    btnManual.addEventListener('click', () => {
        manualMode = true;
        goToModeSelection();
    });

    manualVersion.addEventListener('change', () => {
        const version = manualVersion.value;
        selectedPrefix = null;

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
        selectedPrefix = manualModel.value || null;
        btnManualConfirm.disabled = !manualVersion.value || !manualModel.value;
    });

    // Manual confirm -> load patches -> go to patches step
    btnManualConfirm.addEventListener('click', async () => {
        const version = manualVersion.value;
        if (!version || !selectedPrefix) return;

        try {
            const loaded = await loadPatchesForVersion(version, availablePatches);
            if (!loaded) {
                showError('Could not load patches for software version ' + version);
                return;
            }
            configureFirmwareStep(version, selectedPrefix);
            goToPatches();
        } catch (err) {
            showError(err.message);
        }
    });

    // Auto connect -> show device info
    function displayDeviceInfo(info) {
        $('device-model').textContent = info.model;
        const serialEl = $('device-serial');
        serialEl.textContent = '';
        const prefixLen = info.serialPrefix.length;
        const u = document.createElement('u');
        u.textContent = info.serial.slice(0, prefixLen);
        serialEl.appendChild(u);
        serialEl.appendChild(document.createTextNode(info.serial.slice(prefixLen)));
        $('device-firmware').textContent = info.firmware;
    }

    btnConnect.addEventListener('click', async () => {
        try {
            const info = await device.connect();

            displayDeviceInfo(info);

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

            selectedPrefix = info.serialPrefix;

            await Promise.all([softwareUrlsReady, availablePatchesReady]);
            const match = availablePatches.find(p => p.version === info.firmware);

            configureFirmwareStep(info.firmware, info.serialPrefix);

            if (match) {
                await patchUI.loadFromURL('patches/' + match.filename);
                patchUI.render(patchContainer);
                updatePatchCount();
                patchesLoaded = true;
            }

            btnDeviceRestore.hidden = !patchesLoaded || !firmwareURL;

            deviceStatus.classList.remove('error');
            const isUnknownModel = info.model.startsWith('Unknown');
            if (isUnknownModel) {
                deviceStatus.textContent = '';
                deviceUnknownWarning.hidden = false;
                deviceUnknownAck.hidden = false;
                deviceUnknownCheckbox.checked = false;
                btnDeviceNext.disabled = true;
            } else {
                deviceStatus.textContent = 'Your device has been recognized. You can continue to the next step!';
                deviceUnknownWarning.hidden = true;
                deviceUnknownAck.hidden = true;
                deviceUnknownCheckbox.checked = false;
                btnDeviceNext.disabled = false;
            }
            btnDeviceNext.hidden = false;
            showStep(stepDevice);
        } catch (err) {
            if (err.name === 'AbortError') return;
            showError(err.message);
        }
    });

    // Device info -> mode selection
    btnDeviceNext.addEventListener('click', () => {
        goToModeSelection();
    });

    deviceUnknownCheckbox.addEventListener('change', () => {
        btnDeviceNext.disabled = !deviceUnknownCheckbox.checked;
    });

    btnDeviceRestore.addEventListener('click', () => {
        if (!patchesLoaded) return;
        selectedMode = 'patches';
        isRestore = true;
        setNavLabels(NAV_PATCHES);
        goToBuild();
    });

    async function loadPatchesForVersion(version, available) {
        const match = available.find(p => p.version === version);
        if (!match) return false;

        await patchUI.loadFromURL('patches/' + match.filename);
        patchUI.render(patchContainer);
        updatePatchCount();
        patchesLoaded = true;
        return true;
    }

    // --- Step 2: Mode selection ---
    function goToModeSelection() {
        // In auto mode, disable custom patches if firmware or download URL isn't available
        const patchesRadio = $q('input[value="patches"]', stepMode);
        const patchesCard = patchesRadio.closest('.mode-card');
        const autoModeNoPatchesAvailable = !manualMode && (!patchesLoaded || !firmwareURL);

        const patchesHint = $('mode-patches-hint');
        if (autoModeNoPatchesAvailable) {
            patchesRadio.disabled = true;
            patchesCard.style.opacity = '0.5';
            patchesCard.style.cursor = 'not-allowed';
            patchesHint.hidden = false;
            const nmRadio = $q('input[value="nickelmenu"]', stepMode);
            nmRadio.checked = true;
            nmRadio.dispatchEvent(new Event('change'));
        } else {
            patchesRadio.disabled = false;
            patchesCard.style.opacity = '';
            patchesCard.style.cursor = '';
            patchesHint.hidden = true;
        }

        setNavLabels(NAV_DEFAULT);
        setNavStep(2);
        showStep(stepMode);
    }

    btnModeBack.addEventListener('click', () => {
        setNavStep(1);
        if (manualMode) {
            showStep(stepConnect);
        } else {
            showStep(stepDevice);
        }
    });

    btnModeNext.addEventListener('click', async () => {
        const selected = $q('input[name="mode"]:checked', stepMode);
        if (!selected) return;
        selectedMode = selected.value;

        if (selectedMode === 'nickelmenu') {
            setNavLabels(NAV_NICKELMENU);
            goToNickelMenuConfig();
        } else if (manualMode && !patchesLoaded) {
            // Manual mode: need version/model selection before patches
            setNavLabels(NAV_PATCHES);
            await enterManualVersionSelection();
        } else {
            setNavLabels(NAV_PATCHES);
            goToPatches();
        }
    });

    // --- Manual version/model selection (only for custom patches in manual mode) ---
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

    // --- Step 2b: NickelMenu configuration ---
    const nmConfigOptions = $('nm-config-options');

    // Show/hide config checkboxes based on radio selection, enable Continue
    for (const radio of $qa('input[name="nm-option"]', stepNickelMenu)) {
        radio.addEventListener('change', () => {
            nmConfigOptions.hidden = radio.value !== 'sample' || !radio.checked;
            btnNmNext.disabled = false;
        });
    }

    async function checkNickelMenuInstalled() {
        const removeOption = $('nm-option-remove');
        const removeRadio = $q('input[value="remove"]', removeOption);
        const removeDesc = $('nm-remove-desc');

        if (!manualMode && device.directoryHandle) {
            try {
                const addsDir = await device.directoryHandle.getDirectoryHandle('.adds');
                await addsDir.getDirectoryHandle('nm');
                removeRadio.disabled = false;
                removeOption.classList.remove('nm-option-disabled');
                removeDesc.textContent = 'Removes NickelMenu from your device. You must restart your Kobo to complete the uninstall!';
                return;
            } catch {
                // .adds/nm not found
            }
        }

        removeRadio.disabled = true;
        removeOption.classList.add('nm-option-disabled');
        removeDesc.textContent = 'Removes NickelMenu from your device. Only available when a Kobo with NickelMenu installed is connected.';
        if (removeRadio.checked) {
            const sampleRadio = $q('input[value="sample"]', stepNickelMenu);
            sampleRadio.checked = true;
            sampleRadio.dispatchEvent(new Event('change'));
        }
    }

    function getNmConfig() {
        return {
            fonts: $q('input[name="nm-cfg-fonts"]').checked,
            screensaver: $q('input[name="nm-cfg-screensaver"]').checked,
            simplifyTabs: $q('input[name="nm-cfg-simplify-tabs"]').checked,
            simplifyHome: $q('input[name="nm-cfg-simplify-home"]').checked,
        };
    }

    function goToNickelMenuConfig() {
        checkNickelMenuInstalled();
        const currentOption = $q('input[name="nm-option"]:checked', stepNickelMenu);
        nmConfigOptions.hidden = !currentOption || currentOption.value !== 'sample';
        btnNmNext.disabled = !currentOption;
        setNavStep(3);
        showStep(stepNickelMenu);
    }

    btnNmBack.addEventListener('click', () => {
        goToModeSelection();
    });

    // Continue from configure to review
    btnNmNext.addEventListener('click', () => {
        const selected = $q('input[name="nm-option"]:checked', stepNickelMenu);
        if (!selected) return;
        nickelMenuOption = selected.value;

        if (nickelMenuOption === 'remove') {
            goToNmReview();
            return;
        }

        goToNmReview();
    });

    function goToNmReview() {
        const summary = $('nm-review-summary');
        const list = $('nm-review-list');
        list.innerHTML = '';

        if (nickelMenuOption === 'remove') {
            summary.textContent = 'NickelMenu will be updated and marked for removal. It will uninstall itself when your Kobo reboots.';
            btnNmWrite.hidden = manualMode;
            btnNmWrite.textContent = 'Remove from Kobo';
            btnNmDownload.hidden = true;
        } else if (nickelMenuOption === 'nickelmenu-only') {
            summary.textContent = 'The following will be installed on your Kobo:';
            const li = document.createElement('li');
            li.textContent = 'NickelMenu (KoboRoot.tgz)';
            list.appendChild(li);
            btnNmWrite.hidden = false;
            btnNmWrite.textContent = 'Write to Kobo';
            btnNmDownload.hidden = false;
        } else {
            summary.textContent = 'The following will be installed on your Kobo:';
            const items = ['NickelMenu (KoboRoot.tgz)', 'Custom menu configuration'];
            const cfg = getNmConfig();
            if (cfg.fonts) items.push('Readerly fonts');
            if (cfg.screensaver) items.push('Custom screensaver');
            if (cfg.simplifyTabs) items.push('Simplified tab menu');
            if (cfg.simplifyHome) items.push('Simplified homescreen');
            for (const text of items) {
                const li = document.createElement('li');
                li.textContent = text;
                list.appendChild(li);
            }
            btnNmWrite.hidden = false;
            btnNmWrite.textContent = 'Write to Kobo';
            btnNmDownload.hidden = false;
        }

        // In manual mode, hide write button
        if (manualMode || !device.directoryHandle) {
            btnNmWrite.hidden = true;
        }

        btnNmWrite.disabled = false;
        btnNmWrite.className = 'primary';
        btnNmDownload.disabled = false;

        setNavStep(4);
        showStep(stepNmReview);
    }

    btnNmReviewBack.addEventListener('click', () => {
        goToNickelMenuConfig();
    });

    async function executeNmInstall(writeToDevice) {
        const nmProgress = $('nm-progress');
        showStep(stepNmInstalling);

        try {
            if (nickelMenuOption === 'remove') {
                await nmInstaller.loadAssets((msg) => { nmProgress.textContent = msg; }, false);
                nmProgress.textContent = 'Writing KoboRoot.tgz...';
                const tgz = await nmInstaller.getKoboRootTgz();
                await device.writeFile(['.kobo', 'KoboRoot.tgz'], tgz);
                nmProgress.textContent = 'Marking NickelMenu for removal...';
                await device.writeFile(['.adds', 'nm', 'uninstall'], new Uint8Array(0));
                showNmDone('remove');
                return;
            }

            const cfg = nickelMenuOption === 'sample' ? getNmConfig() : null;

            if (writeToDevice && device.directoryHandle) {
                await nmInstaller.installToDevice(device, nickelMenuOption, cfg, (msg) => {
                    nmProgress.textContent = msg;
                });
                showNmDone('written');
            } else {
                resultNmZip = await nmInstaller.buildDownloadZip(nickelMenuOption, cfg, (msg) => {
                    nmProgress.textContent = msg;
                });
                showNmDone('download');
            }
        } catch (err) {
            showError('NickelMenu installation failed: ' + err.message);
        }
    }

    btnNmWrite.addEventListener('click', () => executeNmInstall(true));
    btnNmDownload.addEventListener('click', () => executeNmInstall(false));

    function showNmDone(mode) {
        const nmDoneStatus = $('nm-done-status');
        $('nm-write-instructions').hidden = true;
        $('nm-download-instructions').hidden = true;
        $('nm-reboot-instructions').hidden = true;

        if (mode === 'remove') {
            nmDoneStatus.textContent = 'NickelMenu will be removed on next reboot.';
            $('nm-reboot-instructions').hidden = false;
        } else if (mode === 'written') {
            nmDoneStatus.textContent = 'NickelMenu has been installed on your Kobo.';
            $('nm-write-instructions').hidden = false;
        } else {
            nmDoneStatus.textContent = 'Your NickelMenu package is ready to download.';
            triggerDownload(resultNmZip, 'NickelMenu-install.zip', 'application/zip');
            $('nm-download-instructions').hidden = false;
            // Show eReader.conf step only when sample config is included
            $('nm-download-conf-step').hidden = nickelMenuOption !== 'sample';
        }

        setNavStep(5);
        showStep(stepNmDone);
    }

    // --- Step 3 (patches path): Configure patches ---
    function goToPatches() {
        setNavStep(3);
        showStep(stepPatches);
    }

    btnPatchesBack.addEventListener('click', () => {
        if (manualMode) {
            // Go back to version selection in manual mode
            setNavStep(2);
            showStep(stepManualVersion);
        } else {
            goToModeSelection();
        }
    });

    btnPatchesNext.addEventListener('click', () => {
        isRestore = patchUI.getEnabledCount() === 0;
        goToBuild();
    });

    // --- Step 4 (patches path): Review & Build ---
    const btnBuild = $('btn-build');
    const firmwareDescription = $('firmware-description');

    function populateSelectedPatchesList() {
        const patchList = $('selected-patches-list');
        patchList.innerHTML = '';
        const enabled = patchUI.getEnabledPatches();
        for (const name of enabled) {
            const li = document.createElement('li');
            li.textContent = name;
            patchList.appendChild(li);
        }
        const hasPatches = enabled.length > 0;
        patchList.hidden = !hasPatches;
        $('selected-patches-heading').hidden = !hasPatches;
    }

    function goToBuild() {
        if (isRestore) {
            firmwareDescription.textContent =
                'will be downloaded and extracted without modifications to restore the original unpatched software.';
            btnBuild.textContent = 'Restore Original Software';
        } else {
            firmwareDescription.textContent =
                'will be downloaded automatically from Kobo\u2019s servers and will be patched after the download completes.';
            btnBuild.textContent = 'Build Patched Software';
        }
        populateSelectedPatchesList();
        setNavStep(4);
        showStep(stepFirmware);
    }

    btnBuildBack.addEventListener('click', () => {
        if (isRestore) {
            // Restore was triggered directly from the device step
            isRestore = false;
            setNavLabels(NAV_DEFAULT);
            setNavStep(1);
            showStep(stepDevice);
        } else {
            goToPatches();
        }
    });

    const buildProgress = $('build-progress');
    const buildLog = $('build-log');

    function appendLog(msg) {
        buildLog.textContent += msg + '\n';
        buildLog.scrollTop = buildLog.scrollHeight;
    }

    async function downloadFirmware(url) {
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error('Download failed: HTTP ' + resp.status);
        }

        const contentLength = resp.headers.get('Content-Length');
        if (!contentLength || !resp.body) {
            buildProgress.textContent = 'Downloading software update...';
            return new Uint8Array(await resp.arrayBuffer());
        }

        const total = parseInt(contentLength, 10);
        const reader = resp.body.getReader();
        const chunks = [];
        let received = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            const pct = ((received / total) * 100).toFixed(0);
            buildProgress.textContent =
                `Downloading software update... ${formatMB(received)} / ${formatMB(total)} (${pct}%)`;
        }

        const result = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }

    async function extractOriginalTgz(firmwareBytes) {
        buildProgress.textContent = 'Extracting KoboRoot.tgz...';
        appendLog('Extracting original KoboRoot.tgz from software update...');
        const zip = await JSZip.loadAsync(firmwareBytes);
        const koboRoot = zip.file('KoboRoot.tgz');
        if (!koboRoot) throw new Error('KoboRoot.tgz not found in software update');
        const tgz = new Uint8Array(await koboRoot.async('arraybuffer'));
        appendLog('Extracted KoboRoot.tgz: ' + formatMB(tgz.length));
        return tgz;
    }

    async function runPatcher(firmwareBytes) {
        buildProgress.textContent = 'Applying patches...';
        const configYAML = patchUI.generateConfig();
        const patchFiles = patchUI.getPatchFileBytes();

        const result = await runner.patchFirmware(configYAML, firmwareBytes, patchFiles, (msg) => {
            appendLog(msg);
            const trimmed = msg.trimStart();
            if (trimmed.startsWith('Patching ') || trimmed.startsWith('Checking ') ||
                trimmed.startsWith('Loading WASM') || trimmed.startsWith('WASM module')) {
                buildProgress.textContent = trimmed;
            }
        });

        return result.tgz;
    }

    function showBuildResult() {
        const action = isRestore ? 'Software extracted' : 'Patching complete';
        const description = isRestore ? 'This will restore the original unpatched software.' : '';
        const deviceName = KoboModels[selectedPrefix] || 'Kobo';
        const installHint = manualMode
            ? 'Download the file and copy it to your ' + deviceName + '.'
            : 'Write it directly to your connected Kobo, or download for manual installation.';

        buildStatus.innerHTML =
            action + '. <strong>KoboRoot.tgz</strong> (' + formatMB(resultTgz.length) + ') is ready. ' +
            (description ? description + ' ' : '') + installHint;

        const doneLog = $('done-log');
        doneLog.textContent = buildLog.textContent;

        // Reset install step state.
        btnWrite.hidden = manualMode;
        btnWrite.disabled = false;
        btnWrite.className = 'primary';
        btnWrite.textContent = 'Write to Kobo';
        btnDownload.disabled = false;
        writeInstructions.hidden = true;
        downloadInstructions.hidden = true;
        existingTgzWarning.hidden = true;

        setNavStep(5);
        showStep(stepDone);

        requestAnimationFrame(() => {
            doneLog.scrollTop = doneLog.scrollHeight;
        });
    }

    async function checkExistingTgz() {
        if (manualMode || !device.directoryHandle) return;
        try {
            const koboDir = await device.directoryHandle.getDirectoryHandle('.kobo');
            await koboDir.getFileHandle('KoboRoot.tgz');
            existingTgzWarning.hidden = false;
        } catch {
            // No existing file — that's fine.
        }
    }

    btnBuild.addEventListener('click', async () => {
        showStep(stepBuilding);
        buildLog.textContent = '';
        buildProgress.textContent = 'Starting...';
        $('build-wait-hint').textContent = isRestore
            ? 'Please wait while the original software is being downloaded and extracted...'
            : 'Please wait while the patch is being applied...';

        try {
            if (!firmwareURL) {
                showError('No download URL available for this device.');
                return;
            }

            const firmwareBytes = await downloadFirmware(firmwareURL);
            appendLog('Download complete: ' + formatMB(firmwareBytes.length));

            resultTgz = isRestore
                ? await extractOriginalTgz(firmwareBytes)
                : await runPatcher(firmwareBytes);

            showBuildResult();
            await checkExistingTgz();
        } catch (err) {
            showError('Build failed: ' + err.message, buildLog.textContent);
        }
    });

    // --- Install step (patches path) ---
    btnWrite.addEventListener('click', async () => {
        if (!resultTgz || !device.directoryHandle) return;

        btnWrite.disabled = true;
        btnWrite.textContent = 'Writing...';
        downloadInstructions.hidden = true;

        try {
            const koboDir = await device.directoryHandle.getDirectoryHandle('.kobo');
            const fileHandle = await koboDir.getFileHandle('KoboRoot.tgz', { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(resultTgz);
            await writable.close();

            btnWrite.textContent = 'Written';
            btnWrite.className = 'btn-success';
            writeInstructions.hidden = false;
        } catch (err) {
            btnWrite.disabled = false;
            btnWrite.textContent = 'Write to Kobo';
            showError('Failed to write KoboRoot.tgz: ' + err.message);
        }
    });

    btnDownload.addEventListener('click', () => {
        if (!resultTgz) return;
        triggerDownload(resultTgz, 'KoboRoot.tgz', 'application/gzip');
        writeInstructions.hidden = true;
        downloadInstructions.hidden = false;
        $('download-device-name').textContent = KoboModels[selectedPrefix] || 'Kobo';
    });

    // --- Error / Retry ---
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

        const hasBackStep = stepHistory[stepHistory.length - 1] === stepPatches;
        if (hasBackStep) {
            errorTitle.textContent = 'The patch failed to apply';
            errorHint.hidden = false;
            btnErrorBack.hidden = false;
            btnRetry.classList.add('danger');
        } else {
            errorTitle.textContent = 'Something went wrong';
            errorHint.hidden = true;
            btnErrorBack.hidden = true;
            btnRetry.classList.remove('danger');
        }
        hideNav();
        pushStep(stepError);
        showStep(stepError, false);
    }

    btnErrorBack.addEventListener('click', () => {
        btnErrorBack.hidden = true;
        btnRetry.classList.remove('danger');
        const prev = popStep();
        showNav();
        showStep(prev);
    });

    btnRetry.addEventListener('click', () => {
        device.disconnect();
        firmwareURL = null;
        resultTgz = null;
        resultNmZip = null;
        manualMode = false;
        selectedPrefix = null;
        patchesLoaded = false;
        isRestore = false;
        selectedMode = null;
        nickelMenuOption = null;
        btnDeviceNext.hidden = false;
        btnDeviceRestore.hidden = false;

        setNavLabels(NAV_DEFAULT);
        setNavStep(1);
        showStep(stepConnect);
    });

    // --- How it works dialog ---
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
})();
