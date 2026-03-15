(() => {
    const device = new KoboDevice();
    const patchUI = new PatchUI();
    const runner = new KobopatchRunner();

    let firmwareURL = null;
    // let firmwareFile = null; // fallback: manual file input
    let resultTgz = null;
    let manualMode = false;
    let selectedPrefix = null;

    // DOM elements
    const stepConnect = document.getElementById('step-connect');
    const stepManual = document.getElementById('step-manual');
    const stepDevice = document.getElementById('step-device');
    const stepPatches = document.getElementById('step-patches');
    const stepFirmware = document.getElementById('step-firmware');
    const stepBuilding = document.getElementById('step-building');
    const stepDone = document.getElementById('step-done');
    const stepError = document.getElementById('step-error');

    const btnConnect = document.getElementById('btn-connect');
    const btnManualFromAuto = document.getElementById('btn-manual-from-auto');
    const btnManualConfirm = document.getElementById('btn-manual-confirm');
    const manualVersion = document.getElementById('manual-version');
    const manualModel = document.getElementById('manual-model');
    const manualChromeHint = document.getElementById('manual-chrome-hint');
    const btnBuild = document.getElementById('btn-build');
    const btnWrite = document.getElementById('btn-write');
    const btnDownload = document.getElementById('btn-download');
    const btnRetry = document.getElementById('btn-retry');

    // const firmwareInput = document.getElementById('firmware-input'); // fallback
    const firmwareAutoInfo = document.getElementById('firmware-auto-info');
    // const firmwareManualInfo = document.getElementById('firmware-manual-info'); // fallback
    const errorMessage = document.getElementById('error-message');
    const errorLog = document.getElementById('error-log');
    const deviceStatus = document.getElementById('device-status');
    const patchContainer = document.getElementById('patch-container');
    const buildStatus = document.getElementById('build-status');
    const writeSuccess = document.getElementById('write-success');
    const firmwareVersionLabel = document.getElementById('firmware-version-label');
    // const firmwareVersionLabelManual = document.getElementById('firmware-version-label-manual'); // fallback
    const patchCountHint = document.getElementById('patch-count-hint');

    function updatePatchCount() {
        const count = patchUI.getEnabledCount();
        btnBuild.disabled = count === 0;
        patchCountHint.textContent = count === 0
            ? 'Select at least one patch to continue.'
            : count === 1
                ? '1 patch selected.'
                : count + ' patches selected.';
    }

    patchUI.onChange = updatePatchCount;

    const allSteps = [stepConnect, stepManual, stepDevice, stepPatches, stepFirmware, stepBuilding, stepDone, stepError];

    // Decide initial step based on browser support
    const hasFileSystemAccess = KoboDevice.isSupported();
    if (hasFileSystemAccess) {
        showSteps(stepConnect);
    } else {
        // Skip straight to manual mode
        enterManualMode();
    }

    function showSteps(...steps) {
        for (const s of allSteps) {
            s.hidden = !steps.includes(s);
        }
    }

    function showError(message, log) {
        errorMessage.textContent = message;
        if (log) {
            errorLog.textContent = log;
            errorLog.hidden = false;
        } else {
            errorLog.hidden = true;
        }
        showSteps(stepError);
    }

    /**
     * Configure the firmware step for auto-download.
     */
    function configureFirmwareStep(version, prefix) {
        firmwareURL = prefix ? getFirmwareURL(prefix, version) : null;
        firmwareVersionLabel.textContent = version;
        document.getElementById('firmware-download-url').textContent = firmwareURL || '';
    }

    async function enterManualMode() {
        manualMode = true;

        // Show the Chrome hint only if the browser actually supports it
        // (i.e., user chose manual mode voluntarily)
        if (hasFileSystemAccess) {
            manualChromeHint.hidden = false;
        }

        // Populate version dropdown from available patches
        const available = await scanAvailablePatches();
        manualVersion.innerHTML = '<option value="">-- Select firmware version --</option>';
        for (const p of available) {
            const opt = document.createElement('option');
            opt.value = p.version;
            opt.textContent = p.version;
            opt.dataset.filename = p.filename;
            manualVersion.appendChild(opt);
        }

        // Reset model dropdown
        manualModel.innerHTML = '<option value="">-- Select your Kobo model --</option>';
        manualModel.hidden = true;

        showSteps(stepManual);
    }

    async function loadPatchesForVersion(version, available) {
        const match = available.find(p => p.version === version);
        if (!match) return false;

        await patchUI.loadFromURL('patches/' + match.filename);
        patchUI.render(patchContainer);
        updatePatchCount();
        return true;
    }

    // Switch to manual mode from auto mode
    btnManualFromAuto.addEventListener('click', (e) => {
        e.preventDefault();
        enterManualMode();
    });

    // Manual mode: version selected → populate model dropdown
    manualVersion.addEventListener('change', () => {
        const version = manualVersion.value;
        selectedPrefix = null;

        if (!version) {
            manualModel.hidden = true;
            btnManualConfirm.disabled = true;
            return;
        }

        // Populate device dropdown for this firmware version
        const devices = getDevicesForVersion(version);
        manualModel.innerHTML = '<option value="">-- Select your Kobo model --</option>';
        for (const d of devices) {
            const opt = document.createElement('option');
            opt.value = d.prefix;
            opt.textContent = d.model;
            manualModel.appendChild(opt);
        }
        manualModel.hidden = false;
        btnManualConfirm.disabled = true;
    });

    // Manual mode: model selected
    manualModel.addEventListener('change', () => {
        selectedPrefix = manualModel.value || null;
        btnManualConfirm.disabled = !manualVersion.value || !manualModel.value;
    });

    // Manual mode: confirm selection
    btnManualConfirm.addEventListener('click', async () => {
        const version = manualVersion.value;
        if (!version || !selectedPrefix) return;

        try {
            const available = await scanAvailablePatches();
            const loaded = await loadPatchesForVersion(version, available);
            if (!loaded) {
                showError('Could not load patches for firmware ' + version);
                return;
            }
            configureFirmwareStep(version, selectedPrefix);
            showSteps(stepPatches, stepFirmware);
        } catch (err) {
            showError(err.message);
        }
    });

    // Auto mode: connect device
    btnConnect.addEventListener('click', async () => {
        try {
            const info = await device.connect();

            document.getElementById('device-model').textContent = info.model;
            document.getElementById('device-serial').textContent = info.serial;
            document.getElementById('device-firmware').textContent = info.firmware;

            selectedPrefix = info.serialPrefix;

            const available = await scanAvailablePatches();
            const match = available.find(p => p.version === info.firmware);

            if (match) {
                deviceStatus.className = 'status-supported';
                deviceStatus.textContent = 'Patches available for firmware ' + info.firmware + '.';

                await patchUI.loadFromURL('patches/' + match.filename);
                patchUI.render(patchContainer);
                updatePatchCount();
                configureFirmwareStep(info.firmware, info.serialPrefix);

                showSteps(stepDevice, stepPatches, stepFirmware);
            } else {
                deviceStatus.className = 'status-unsupported';
                deviceStatus.textContent =
                    'No patches available for firmware ' + info.firmware + '. ' +
                    'Supported versions: ' + available.map(p => p.version).join(', ');
                showSteps(stepDevice);
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            showError(err.message);
        }
    });

    // // Firmware file selected (fallback for devices without auto-download URL)
    // firmwareInput.addEventListener('change', () => {
    //     firmwareFile = firmwareInput.files[0] || null;
    // });

    const buildProgress = document.getElementById('build-progress');
    const buildLog = document.getElementById('build-log');

    /**
     * Download firmware zip from Kobo's servers with progress tracking.
     * Returns Uint8Array of the zip file.
     */
    async function downloadFirmware(url) {
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error('Firmware download failed: HTTP ' + resp.status);
        }

        const contentLength = resp.headers.get('Content-Length');
        if (!contentLength || !resp.body) {
            // Fallback: no streaming progress
            buildProgress.textContent = 'Downloading firmware...';
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
            const mb = (received / 1024 / 1024).toFixed(1);
            const totalMB = (total / 1024 / 1024).toFixed(1);
            buildProgress.textContent = `Downloading firmware... ${mb} / ${totalMB} MB (${pct}%)`;
        }

        // Concatenate chunks into single Uint8Array
        const result = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }

    function appendLog(msg) {
        buildLog.textContent += msg + '\n';
        buildLog.scrollTop = buildLog.scrollHeight;
    }

    // Build
    btnBuild.addEventListener('click', async () => {
        const stepsToShow = manualMode ? [stepBuilding] : [stepDevice, stepBuilding];
        showSteps(...stepsToShow);
        buildLog.textContent = '';
        buildProgress.textContent = 'Starting...';

        try {
            if (!firmwareURL) {
                showError('No firmware download URL available for this device.');
                return;
            }

            const firmwareBytes = await downloadFirmware(firmwareURL);
            appendLog('Firmware downloaded: ' + (firmwareBytes.length / 1024 / 1024).toFixed(1) + ' MB');

            buildProgress.textContent = 'Applying patches...';
            const configYAML = patchUI.generateConfig();
            const patchFiles = patchUI.getPatchFileBytes();

            const result = await runner.patchFirmware(configYAML, firmwareBytes, patchFiles, (msg) => {
                appendLog(msg);
                // Update headline with high-level steps
                const trimmed = msg.trimStart();
                if (trimmed.startsWith('Patching ') || trimmed.startsWith('Checking ') ||
                    trimmed.startsWith('Loading WASM') || trimmed.startsWith('WASM module')) {
                    buildProgress.textContent = trimmed;
                }
            });

            resultTgz = result.tgz;
            buildStatus.textContent =
                'Patching complete. KoboRoot.tgz is ' +
                (resultTgz.length / 1024).toFixed(0) + ' KB.';
            writeSuccess.hidden = true;

            // Copy log to done step
            const doneLog = document.getElementById('done-log');
            doneLog.textContent = buildLog.textContent;
            doneLog.scrollTop = doneLog.scrollHeight;

            // In manual mode, hide the "Write to Kobo" button
            btnWrite.hidden = manualMode;

            const doneSteps = manualMode ? [stepDone] : [stepDevice, stepDone];
            showSteps(...doneSteps);
        } catch (err) {
            showError('Build failed: ' + err.message, buildLog.textContent);
        }
    });

    // Write to device (auto mode only)
    btnWrite.addEventListener('click', async () => {
        if (!resultTgz || !device.directoryHandle) return;

        try {
            const koboDir = await device.directoryHandle.getDirectoryHandle('.kobo');
            const fileHandle = await koboDir.getFileHandle('KoboRoot.tgz', { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(resultTgz);
            await writable.close();
            writeSuccess.hidden = false;
        } catch (err) {
            showError('Failed to write KoboRoot.tgz: ' + err.message);
        }
    });

    // Download
    btnDownload.addEventListener('click', () => {
        if (!resultTgz) return;
        const blob = new Blob([resultTgz], { type: 'application/gzip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'KoboRoot.tgz';
        a.click();
        URL.revokeObjectURL(url);
    });

    // Retry
    btnRetry.addEventListener('click', () => {
        device.disconnect();
        firmwareURL = null;
        resultTgz = null;
        manualMode = false;
        selectedPrefix = null;
        btnWrite.hidden = false;

        if (hasFileSystemAccess) {
            showSteps(stepConnect);
        } else {
            enterManualMode();
        }
    });
})();
