/**
 * patches-flow.js — Custom firmware patching flow.
 *
 * Handles the entire custom-patches path through the wizard:
 *   1. Configure patches — toggle individual patches on/off
 *   2. Review & build    — confirm selections, download firmware, apply patches
 *   3. Install/download  — write KoboRoot.tgz to device or trigger browser download
 *
 * Also supports "restore" mode where no patches are applied — the original
 * KoboRoot.tgz is extracted from the firmware ZIP and offered as-is.
 *
 * Exported `initPatchesFlow(state)` receives the shared app state and returns
 * functions the orchestrator needs: `goToPatches`, `goToBuild`,
 * `updatePatchCount`, and `configureFirmwareStep`.
 */

import { $, formatMB, triggerDownload } from './dom.js';
import { showStep, setNavLabels, setNavStep } from './nav.js';
import { KoboModels } from './kobo-device.js';
import { TL } from './strings.js';
import { track } from './analytics.js';
import JSZip from 'jszip';

export function initPatchesFlow(state) {

    // --- DOM references (scoped to this flow) ---

    const stepPatches = $('step-patches');
    const stepBuilding = $('step-building');
    const stepDone = $('step-done');
    const btnPatchesBack = $('btn-patches-back');
    const btnPatchesNext = $('btn-patches-next');
    const btnBuildBack = $('btn-build-back');
    const btnBuild = $('btn-build');
    const btnWrite = $('btn-write');
    const btnDownload = $('btn-download');
    const buildProgress = $('build-progress');
    const buildLog = $('build-log');
    const buildStatus = $('build-status');
    const existingTgzWarning = $('existing-tgz-warning');
    const writeInstructions = $('write-instructions');
    const downloadInstructions = $('download-instructions');
    const firmwareVersionLabel = $('firmware-version-label');
    const firmwareDeviceLabel = $('firmware-device-label');
    const firmwareDescription = $('firmware-description');
    const patchCountHint = $('patch-count-hint');

    // --- Patch count ---
    // Updates the hint text below the patch list ("3 patches selected", etc.).
    // Also wired as the onChange callback on PatchUI so it updates live.

    function updatePatchCount() {
        const count = state.patchUI.getEnabledCount();
        btnPatchesNext.disabled = false;
        if (count === 0) {
            patchCountHint.textContent = TL.STATUS.PATCH_COUNT_ZERO;
        } else {
            patchCountHint.textContent = count === 1 ? TL.STATUS.PATCH_COUNT_ONE : TL.STATUS.PATCH_COUNT_MULTI(count);
        }
    }

    state.patchUI.onChange = updatePatchCount;

    // --- Firmware step config ---
    // Sets the firmware download URL and labels shown on the review step.
    // Called once when the device is detected or the user picks a manual version.

    function configureFirmwareStep(version, prefix) {
        state.firmwareURL = prefix ? state.getSoftwareUrl(prefix, version) : null;
        firmwareVersionLabel.textContent = version;
        firmwareDeviceLabel.textContent = KoboModels[prefix] || prefix;
        $('firmware-download-url').textContent = state.firmwareURL || '';
    }

    // --- Step: Configure patches ---

    function goToPatches() {
        setNavStep(3);
        showStep(stepPatches);
    }

    btnPatchesBack.addEventListener('click', () => {
        if (state.manualMode) {
            setNavStep(2);
            showStep($('step-manual-version'));
        } else {
            state.goToModeSelection();
        }
    });

    btnPatchesNext.addEventListener('click', () => {
        // If zero patches are enabled, treat this as a firmware restore.
        state.isRestore = state.patchUI.getEnabledCount() === 0;
        goToBuild();
    });

    // --- Step: Review & Build ---
    // Shows the list of selected patches and a "Build" button.

    function populateSelectedPatchesList() {
        const patchList = $('selected-patches-list');
        patchList.innerHTML = '';
        const enabled = state.patchUI.getEnabledPatches();
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
        // Adjust labels for restore vs patch mode.
        if (state.isRestore) {
            firmwareDescription.textContent = TL.STATUS.RESTORE_ORIGINAL;
            btnBuild.textContent = TL.BUTTON.RESTORE_ORIGINAL;
        } else {
            firmwareDescription.textContent = TL.STATUS.FIRMWARE_WILL_BE_DOWNLOADED;
            btnBuild.textContent = TL.BUTTON.BUILD_PATCHED;
        }
        populateSelectedPatchesList();
        setNavStep(4);
        // `false` = don't push to step history (building is a transient state).
        showStep($('step-firmware'), false);
    }

    btnBuildBack.addEventListener('click', () => {
        if (state.isRestore) {
            // Restore was entered from the device step — go back there.
            state.isRestore = false;
            setNavLabels(TL.NAV_DEFAULT);
            setNavStep(1);
            showStep($('step-device'));
        } else {
            goToPatches();
        }
    });

    // --- Download & patch ---
    // These functions handle the heavy lifting: downloading firmware,
    // extracting the original tgz, and running the WASM patcher.

    function appendLog(msg) {
        buildLog.textContent += msg + '\n';
        buildLog.scrollTop = buildLog.scrollHeight;
    }

    /**
     * Download firmware from the given URL with progress reporting.
     * Uses a ReadableStream reader when Content-Length is available
     * so we can show "Downloading X / Y MB (Z%)".
     */
    async function downloadFirmware(url) {
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error('Download failed: HTTP ' + resp.status);
        }

        const contentLength = resp.headers.get('Content-Length');
        if (!contentLength || !resp.body) {
            // No progress info available — download in one shot.
            buildProgress.textContent = TL.STATUS.DOWNLOADING;
            return new Uint8Array(await resp.arrayBuffer());
        }

        // Stream download with progress updates.
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
            buildProgress.textContent = TL.STATUS.DOWNLOADING_PROGRESS(formatMB(received), formatMB(total), pct);
        }

        // Reassemble chunks into a single Uint8Array.
        const result = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }

    /** Extract the original KoboRoot.tgz from a Kobo firmware ZIP. */
    async function extractOriginalTgz(firmwareBytes) {
        buildProgress.textContent = TL.STATUS.EXTRACTING;
        appendLog('Extracting original KoboRoot.tgz from firmware...');
        const zip = await JSZip.loadAsync(firmwareBytes);
        const koboRoot = zip.file('KoboRoot.tgz');
        if (!koboRoot) throw new Error(TL.STATUS.EXTRACT_FAILED);
        const tgz = new Uint8Array(await koboRoot.async('arraybuffer'));
        appendLog('Extracted KoboRoot.tgz: ' + formatMB(tgz.length));
        return tgz;
    }

    /**
     * Run the WASM patcher on downloaded firmware bytes.
     * Generates a kobopatch YAML config from the UI selections,
     * then delegates to the Web Worker via KoboPatchRunner.
     */
    async function runPatcher(firmwareBytes) {
        buildProgress.textContent = TL.STATUS.APPLYING_PATCHES;
        const configYAML = state.patchUI.generateConfig();
        const patchFiles = state.patchUI.getPatchFileBytes();

        const result = await state.runner.patchFirmware(configYAML, firmwareBytes, patchFiles, (msg) => {
            appendLog(msg);
            // Surface key progress lines in the status bar.
            const trimmed = msg.trimStart();
            if (trimmed.startsWith('Patching ') || trimmed.startsWith('Checking ') ||
                trimmed.startsWith('Loading WASM') || trimmed.startsWith('WASM module')) {
                buildProgress.textContent = trimmed;
            }
        });

        return result.tgz;
    }

    // --- Build result ---
    // Shown after a successful build/extract. Offers "Write to Kobo" and
    // "Download" buttons. Also warns if a KoboRoot.tgz already exists on
    // the device (which would be overwritten).

    function showBuildResult() {
        const action = state.isRestore ? 'Software extracted' : 'Patching complete';
        const description = state.isRestore ? 'This will restore the original unpatched software.' : '';
        const deviceName = KoboModels[state.selectedPrefix] || 'Kobo';
        const installHint = state.manualMode
            ? 'Download the file and copy it to your ' + deviceName + '.'
            : 'Write it directly to your connected Kobo, or download for manual installation.';

        buildStatus.innerHTML =
            action + '. <strong>KoboRoot.tgz</strong> (' + formatMB(state.resultTgz.length) + ') is ready. ' +
            (description ? description + ' ' : '') + installHint;

        const doneLog = $('done-log');
        doneLog.textContent = buildLog.textContent;

        btnWrite.hidden = state.manualMode;
        btnWrite.disabled = false;
        btnWrite.className = 'primary';
        btnWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
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

    /** Check if the device already has a KoboRoot.tgz and show a warning if so. */
    async function checkExistingTgz() {
        if (state.manualMode || !state.device.directoryHandle) return;
        try {
            const koboDir = await state.device.directoryHandle.getDirectoryHandle('.kobo');
            await koboDir.getFileHandle('KoboRoot.tgz');
            existingTgzWarning.hidden = false;
        } catch {
            // No existing file — that's fine.
        }
    }

    // --- Build button ---
    // Orchestrates the full pipeline: download firmware -> extract/patch -> show result.

    btnBuild.addEventListener('click', async () => {
        showStep(stepBuilding, false);
        buildLog.textContent = '';
        buildProgress.textContent = TL.STATUS.BUILDING_STARTING;
        $('build-wait-hint').textContent = state.isRestore
            ? 'Please wait while the original software is being downloaded and extracted...'
            : 'Please wait while the patch is being applied...';

        try {
            if (!state.firmwareURL) {
                state.showError(TL.STATUS.NO_FIRMWARE_URL);
                return;
            }

            const firmwareBytes = await downloadFirmware(state.firmwareURL);
            appendLog('Download complete: ' + formatMB(firmwareBytes.length));

            // Either extract the original tgz (restore) or run the patcher.
            state.resultTgz = state.isRestore
                ? await extractOriginalTgz(firmwareBytes)
                : await runPatcher(firmwareBytes);

            showBuildResult();
            await checkExistingTgz();
        } catch (err) {
            state.showError('Build failed: ' + err.message, buildLog.textContent);
        }
    });

    // --- Install step ---
    // Writes the built KoboRoot.tgz to the device via File System Access API,
    // or triggers a browser download.

    btnWrite.addEventListener('click', async () => {
        if (!state.resultTgz || !state.device.directoryHandle) return;

        btnWrite.disabled = true;
        btnWrite.textContent = TL.BUTTON.WRITING;
        downloadInstructions.hidden = true;

        try {
            const koboDir = await state.device.directoryHandle.getDirectoryHandle('.kobo');
            const fileHandle = await koboDir.getFileHandle('KoboRoot.tgz', { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(state.resultTgz);
            await writable.close();

            btnWrite.textContent = TL.BUTTON.WRITTEN;
            btnWrite.className = 'btn-success';
            writeInstructions.hidden = false;
            track('flow-end', { result: state.isRestore ? 'restore-write' : 'patches-write' });
        } catch (err) {
            btnWrite.disabled = false;
            btnWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
            state.showError(TL.STATUS.WRITE_FAILED(err.message));
        }
    });

    btnDownload.addEventListener('click', () => {
        if (!state.resultTgz) return;
        triggerDownload(state.resultTgz, 'KoboRoot.tgz', 'application/gzip');
        writeInstructions.hidden = true;
        downloadInstructions.hidden = false;
        $('download-device-name').textContent = KoboModels[state.selectedPrefix] || 'Kobo';
        track('flow-end', { result: state.isRestore ? 'restore-download' : 'patches-download' });
    });

    // Expose only what the orchestrator needs.
    return { goToPatches, goToBuild, updatePatchCount, configureFirmwareStep };
}
