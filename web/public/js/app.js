(() => {
    const device = new KoboDevice();
    const patchUI = new PatchUI();
    const runner = new KobopatchRunner();

    let firmwareURL = null;
    let resultTgz = null;
    let manualMode = false;
    let selectedPrefix = null;
    let patchesLoaded = false;
    let isRestore = false;
    let availablePatches = null;

    // Fetch patch index immediately so it's ready when needed.
    const availablePatchesReady = scanAvailablePatches().then(p => { availablePatches = p; });

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
    const btnDeviceRestore = document.getElementById('btn-device-restore');
    const btnPatchesBack = document.getElementById('btn-patches-back');
    const btnPatchesNext = document.getElementById('btn-patches-next');
    const btnBuildBack = document.getElementById('btn-build-back');
    const btnWrite = document.getElementById('btn-write');
    const btnDownload = document.getElementById('btn-download');
    const btnRetry = document.getElementById('btn-retry');

    const firmwareAutoInfo = document.getElementById('firmware-auto-info');
    const errorMessage = document.getElementById('error-message');
    const errorLog = document.getElementById('error-log');
    const deviceStatus = document.getElementById('device-status');
    const patchContainer = document.getElementById('patch-container');
    const buildStatus = document.getElementById('build-status');
    const existingTgzWarning = document.getElementById('existing-tgz-warning');
    const writeInstructions = document.getElementById('write-instructions');
    const downloadInstructions = document.getElementById('download-instructions');
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
        btnPatchesNext.disabled = false;
        if (count === 0) {
            patchCountHint.textContent = 'No patches selected — continuing will restore the original unpatched software.';
        } else {
            patchCountHint.textContent = count === 1 ? '1 patch selected.' : count + ' patches selected.';
        }
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
        manualChromeHint.hidden = false;

        await availablePatchesReady;
        manualVersion.innerHTML = '<option value="">-- Select software version --</option>';
        for (const p of availablePatches) {
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

        const modelHint = document.getElementById('manual-model-hint');
        if (!version) {
            manualModel.hidden = true;
            modelHint.hidden = true;
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
        modelHint.hidden = false;
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

    // Auto connect → show device info
    btnConnect.addEventListener('click', async () => {
        try {
            const info = await device.connect();

            document.getElementById('device-model').textContent = info.model;
            const serialEl = document.getElementById('device-serial');
            serialEl.textContent = '';
            const prefixLen = info.serialPrefix.length;
            const u = document.createElement('u');
            u.textContent = info.serial.slice(0, prefixLen);
            serialEl.appendChild(u);
            serialEl.appendChild(document.createTextNode(info.serial.slice(prefixLen)));
            document.getElementById('device-firmware').textContent = info.firmware;

            selectedPrefix = info.serialPrefix;

            await availablePatchesReady;
            const match = availablePatches.find(p => p.version === info.firmware);

            if (match) {
                deviceStatus.className = '';
                deviceStatus.textContent =
                    'KoboPatch Web UI currently supports this version of the software. ' +
                    'You can choose to customize it or simply restore the original software.';

                await patchUI.loadFromURL('patches/' + match.filename);
                patchUI.render(patchContainer);
                updatePatchCount();
                patchesLoaded = true;
                configureFirmwareStep(info.firmware, info.serialPrefix);

                btnDeviceNext.hidden = false;
                btnDeviceRestore.hidden = false;
                showStep(stepDevice);
            } else {
                deviceStatus.className = 'warning';
                deviceStatus.textContent =
                    'No patch available for this specific version and model combination. Currently, only Kobo Libra Colour, Kobo Clara Colour and Kobo Clara BW can be patched via this website.';
                btnDeviceNext.hidden = true;
                btnDeviceRestore.hidden = true;
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

    btnDeviceRestore.addEventListener('click', () => {
        if (!patchesLoaded) return;
        isRestore = true;
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
        isRestore = patchUI.getEnabledCount() === 0;
        goToBuild();
    });

    // --- Step 3: Review & Build ---
    const btnBuild = document.getElementById('btn-build');
    const firmwareDescription = document.getElementById('firmware-description');

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
        // Populate selected patches list.
        const patchList = document.getElementById('selected-patches-list');
        patchList.innerHTML = '';
        const enabled = patchUI.getEnabledPatches();
        if (enabled.length > 0) {
            for (const name of enabled) {
                const li = document.createElement('li');
                li.textContent = name;
                patchList.appendChild(li);
            }
        }
        const hasPatches = enabled.length > 0;
        patchList.hidden = !hasPatches;
        document.getElementById('selected-patches-heading').hidden = !hasPatches;

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
            const mb = (received / 1024 / 1024).toFixed(1);
            const totalMB = (total / 1024 / 1024).toFixed(1);
            buildProgress.textContent = `Downloading software update... ${mb} / ${totalMB} MB (${pct}%)`;
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
        showStep(stepBuilding);
        buildLog.textContent = '';
        buildProgress.textContent = 'Starting...';
        document.getElementById('build-wait-hint').textContent = isRestore
            ? 'Please wait while the original software is being downloaded and extracted...'
            : 'Please wait while the patch is being applied...';

        try {
            if (!firmwareURL) {
                showError('No download URL available for this device.');
                return;
            }

            const firmwareBytes = await downloadFirmware(firmwareURL);
            appendLog('Download complete: ' + (firmwareBytes.length / 1024 / 1024).toFixed(1) + ' MB');

            if (isRestore) {
                buildProgress.textContent = 'Extracting KoboRoot.tgz...';
                appendLog('Extracting original KoboRoot.tgz from software update...');
                const zip = await JSZip.loadAsync(firmwareBytes);
                const koboRoot = zip.file('KoboRoot.tgz');
                if (!koboRoot) throw new Error('KoboRoot.tgz not found in software update');
                resultTgz = new Uint8Array(await koboRoot.async('arraybuffer'));
                appendLog('Extracted KoboRoot.tgz: ' + (resultTgz.length / 1024 / 1024).toFixed(1) + ' MB');
            } else {
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
            }
            const sizeTxt = (resultTgz.length / 1024 / 1024).toFixed(1) + ' MB';
            const action = isRestore ? 'Software extracted' : 'Patching complete';
            const description = isRestore
                ? 'This will restore the original unpatched software.'
                : '';
            buildStatus.innerHTML =
                action + '. <strong>KoboRoot.tgz</strong> (' + sizeTxt + ') is ready. ' +
                (description ? description + ' ' : '') +
                (manualMode
                    ? 'Download the file and copy it to your ' + (KOBO_MODELS[selectedPrefix] || 'Kobo') + '.'
                    : 'Write it directly to your connected Kobo, or download for manual installation.');

            const doneLog = document.getElementById('done-log');
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

            // Check if a KoboRoot.tgz already exists on the device.
            if (!manualMode && device.directoryHandle) {
                try {
                    const koboDir = await device.directoryHandle.getDirectoryHandle('.kobo');
                    await koboDir.getFileHandle('KoboRoot.tgz');
                    existingTgzWarning.hidden = false;
                } catch {
                    // No existing file — that's fine.
                }
            }

            setNavStep(4);
            showStep(stepDone);

            // Scroll log to bottom after the step becomes visible.
            requestAnimationFrame(() => {
                doneLog.scrollTop = doneLog.scrollHeight;
            });
        } catch (err) {
            showError('Build failed: ' + err.message, buildLog.textContent);
        }
    });

    // --- Install step ---
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
        const blob = new Blob([resultTgz], { type: 'application/gzip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'KoboRoot.tgz';
        a.click();
        URL.revokeObjectURL(url);

        writeInstructions.hidden = true;
        downloadInstructions.hidden = false;
        document.getElementById('download-device-name').textContent = KOBO_MODELS[selectedPrefix] || 'Kobo';
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
        isRestore = false;
        btnDeviceNext.hidden = false;
        btnDeviceRestore.hidden = false;

        if (hasFileSystemAccess) {
            setNavStep(1);
            showStep(stepConnect);
        } else {
            enterManualMode();
        }
    });

    // --- How it works dialog ---
    const dialog = document.getElementById('how-it-works-dialog');
    document.getElementById('btn-how-it-works').addEventListener('click', (e) => {
        e.preventDefault();
        dialog.showModal();
    });
    document.getElementById('btn-close-dialog').addEventListener('click', () => {
        dialog.close();
    });
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) dialog.close();
    });
})();
