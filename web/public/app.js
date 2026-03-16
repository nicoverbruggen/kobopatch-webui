(() => {
    const device = new KoboDevice();
    const patchUI = new PatchUI();
    const runner = new KobopatchRunner();

    let firmwareURL = null;
    let resultTgz = null;
    let manualMode = false;
    let selectedPrefix = null;
    let patchesLoaded = false;

    // DOM elements
    const stepNav = document.getElementById('step-nav');
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
    const btnDeviceNext = document.getElementById('btn-device-next');
    const btnPatchesBack = document.getElementById('btn-patches-back');
    const btnPatchesNext = document.getElementById('btn-patches-next');
    const btnBuildBack = document.getElementById('btn-build-back');
    const btnBuild = document.getElementById('btn-build');
    const btnWrite = document.getElementById('btn-write');
    const btnDownload = document.getElementById('btn-download');
    const btnRetry = document.getElementById('btn-retry');

    const firmwareAutoInfo = document.getElementById('firmware-auto-info');
    const errorMessage = document.getElementById('error-message');
    const errorLog = document.getElementById('error-log');
    const deviceStatus = document.getElementById('device-status');
    const patchContainer = document.getElementById('patch-container');
    const buildStatus = document.getElementById('build-status');
    const writeSuccess = document.getElementById('write-success');
    const firmwareVersionLabel = document.getElementById('firmware-version-label');
    const firmwareDeviceLabel = document.getElementById('firmware-device-label');
    const patchCountHint = document.getElementById('patch-count-hint');

    const allSteps = [stepConnect, stepManual, stepDevice, stepPatches, stepFirmware, stepBuilding, stepDone, stepError];

    // --- Step navigation ---
    function showStep(step) {
        for (const s of allSteps) {
            s.hidden = (s !== step);
        }
    }

    function setNavStep(num) {
        const items = stepNav.querySelectorAll('li');
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

    // --- Patch count ---
    function updatePatchCount() {
        const count = patchUI.getEnabledCount();
        btnPatchesNext.disabled = count === 0;
        patchCountHint.textContent = count === 0
            ? 'Select at least one patch to continue.'
            : count === 1
                ? '1 patch selected.'
                : count + ' patches selected.';
    }

    patchUI.onChange = updatePatchCount;

    // --- Firmware step config ---
    function configureFirmwareStep(version, prefix) {
        firmwareURL = prefix ? getFirmwareURL(prefix, version) : null;
        firmwareVersionLabel.textContent = version;
        firmwareDeviceLabel.textContent = KOBO_MODELS[prefix] || prefix;
        document.getElementById('firmware-download-url').textContent = firmwareURL || '';
    }

    // --- Initial state ---
    const hasFileSystemAccess = KoboDevice.isSupported();
    if (hasFileSystemAccess) {
        setNavStep(1);
        showStep(stepConnect);
    } else {
        enterManualMode();
    }

    // --- Step 1: Device selection ---
    async function enterManualMode() {
        manualMode = true;
        if (hasFileSystemAccess) {
            manualChromeHint.hidden = false;
        }

        const available = await scanAvailablePatches();
        manualVersion.innerHTML = '<option value="">-- Select firmware version --</option>';
        for (const p of available) {
            const opt = document.createElement('option');
            opt.value = p.version;
            opt.textContent = p.version;
            opt.dataset.filename = p.filename;
            manualVersion.appendChild(opt);
        }

        manualModel.innerHTML = '<option value="">-- Select your Kobo model --</option>';
        manualModel.hidden = true;

        setNavStep(1);
        showStep(stepManual);
    }

    btnManualFromAuto.addEventListener('click', (e) => {
        e.preventDefault();
        enterManualMode();
    });

    manualVersion.addEventListener('change', () => {
        const version = manualVersion.value;
        selectedPrefix = null;

        if (!version) {
            manualModel.hidden = true;
            btnManualConfirm.disabled = true;
            return;
        }

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

    manualModel.addEventListener('change', () => {
        selectedPrefix = manualModel.value || null;
        btnManualConfirm.disabled = !manualVersion.value || !manualModel.value;
    });

    // Manual confirm → load patches → go to step 2
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
            goToPatches();
        } catch (err) {
            showError(err.message);
        }
    });

    // Auto connect → show device info
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
                patchesLoaded = true;
                configureFirmwareStep(info.firmware, info.serialPrefix);

                showStep(stepDevice);
            } else {
                deviceStatus.className = 'status-unsupported';
                deviceStatus.textContent =
                    'No patches available for firmware ' + info.firmware + '. ' +
                    'Supported versions: ' + available.map(p => p.version).join(', ');
                btnDeviceNext.hidden = true;
                showStep(stepDevice);
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            showError(err.message);
        }
    });

    // Device info → patches
    btnDeviceNext.addEventListener('click', () => {
        if (patchesLoaded) goToPatches();
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

    // --- Step 2: Patches ---
    function goToPatches() {
        setNavStep(2);
        showStep(stepPatches);
    }

    btnPatchesBack.addEventListener('click', () => {
        setNavStep(1);
        if (manualMode) {
            showStep(stepManual);
        } else {
            showStep(stepDevice);
        }
    });

    btnPatchesNext.addEventListener('click', () => {
        if (patchUI.getEnabledCount() === 0) return;
        goToBuild();
    });

    // --- Step 3: Review & Build ---
    function goToBuild() {
        setNavStep(3);
        showStep(stepFirmware);
    }

    btnBuildBack.addEventListener('click', () => {
        goToPatches();
    });

    const buildProgress = document.getElementById('build-progress');
    const buildLog = document.getElementById('build-log');

    async function downloadFirmware(url) {
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error('Firmware download failed: HTTP ' + resp.status);
        }

        const contentLength = resp.headers.get('Content-Length');
        if (!contentLength || !resp.body) {
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

    btnBuild.addEventListener('click', async () => {
        hideNav();
        showStep(stepBuilding);
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

            const doneLog = document.getElementById('done-log');
            doneLog.textContent = buildLog.textContent;
            doneLog.scrollTop = doneLog.scrollHeight;

            btnWrite.hidden = manualMode;
            hideNav();
            showStep(stepDone);
        } catch (err) {
            showError('Build failed: ' + err.message, buildLog.textContent);
        }
    });

    // --- Done step ---
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

    // --- Error / Retry ---
    function showError(message, log) {
        errorMessage.textContent = message;
        if (log) {
            errorLog.textContent = log;
            errorLog.hidden = false;
        } else {
            errorLog.hidden = true;
        }
        hideNav();
        showStep(stepError);
    }

    btnRetry.addEventListener('click', () => {
        device.disconnect();
        firmwareURL = null;
        resultTgz = null;
        manualMode = false;
        selectedPrefix = null;
        patchesLoaded = false;
        btnWrite.hidden = false;
        btnDeviceNext.hidden = false;

        if (hasFileSystemAccess) {
            setNavStep(1);
            showStep(stepConnect);
        } else {
            enterManualMode();
        }
    });
})();
