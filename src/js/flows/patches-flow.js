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

import { AuditLog, AUDIT_LOG_DIRECTORY } from '../kobo/audit-log.js';
import { $, formatMB, fetchWithProgress, triggerDownload, populateList, setupFeedback } from '../shell/dom.js';
import { showStep, setNavLabels, setNavStep } from '../shell/navigation.js';
import { buildPatchesInstructions } from '../shell/instructions.js';
import { koboModels } from '../kobo/version.js';
import { TL } from '../shell/strings.js';
import { isEnabled as analyticsEnabled, track } from '../shell/analytics.js';
import JSZip from 'jszip';

export function initPatchesFlow(state) {

    // --- DOM references (scoped to this flow) ---

    const stepPatches = $('step-patches');
    const stepBuilding = $('step-building');
    const stepDone = $('step-done');
    const patchContainer = $('patch-container');
    const patchReloadBanner = $('patch-reload-banner');
    const patchReloadText = $('patch-reload-text');
    const btnPatchReload = $('btn-patch-reload');
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
        state.firmwareVersion = version;
        state.deviceModelLabel = koboModels[prefix] || prefix;
        firmwareVersionLabel.textContent = version;
        firmwareDeviceLabel.textContent = state.deviceModelLabel;
        $('firmware-download-url').textContent = state.firmwareURL || '';
    }

    // --- Step: Configure patches ---

    function goToPatches() {
        setNavStep(3);
        showStep(stepPatches);
        // Offer to reload a previously applied patch set (connected mode only).
        void maybeOfferReload();
    }

    // --- Reload previously applied patches ---
    // When a connected device carries a custom-patches manifest from an earlier
    // run, offer to re-apply its selections and manual edits to the loaded set.

    /** Reset the banner to its default "offer" state and probe the device. */
    async function maybeOfferReload() {
        state.reloadManifest = null;
        patchReloadBanner.hidden = true;
        btnPatchReload.hidden = false;
        btnPatchReload.disabled = false;
        patchReloadBanner.classList.remove('banner--success', 'banner--warning');
        patchReloadBanner.classList.add('banner--info');
        patchReloadText.textContent = TL.PATCH.RELOAD_OFFER;

        if (state.manualMode || !state.device?.directoryHandle || !state.patchesLoaded) return;

        try {
            const text = await state.device.readFile([AUDIT_LOG_DIRECTORY, 'custom-patches.json']);
            if (!text) return;
            const manifest = JSON.parse(text);
            // Only offer when there is actually something to re-apply: at least one
            // enabled patch or a manual edit. A manifest left by a "restore original
            // firmware" run has every override set to false and no edits — there is
            // nothing to restore, so don't offer.
            const hasEnabled = manifest?.overrides && Object.values(manifest.overrides).some(
                file => file && typeof file === 'object' && Object.values(file).some(Boolean)
            );
            const hasCustomized = manifest?.customized && Object.keys(manifest.customized).length > 0;
            if (!hasEnabled && !hasCustomized) return;
            state.reloadManifest = manifest;
            patchReloadBanner.hidden = false;
        } catch {
            // No manifest, unreadable, or invalid JSON — silently skip the offer.
        }
    }

    btnPatchReload.addEventListener('click', () => {
        if (!state.reloadManifest) return;
        btnPatchReload.disabled = true;

        const summary = state.patchUI.applyReloadManifest(state.reloadManifest);
        state.patchUI.render(patchContainer);
        updatePatchCount();

        patchReloadBanner.classList.remove('banner--info');
        // "None matched" only when nothing in the manifest lined up with the loaded
        // patch set (e.g. a different software version) — not merely when the
        // restored selection happens to enable nothing.
        if (summary.matched === 0 && summary.edits === 0) {
            patchReloadBanner.classList.add('banner--warning');
            patchReloadText.textContent = TL.PATCH.RELOAD_NONE_MATCHED;
        } else {
            patchReloadBanner.classList.add('banner--success');
            patchReloadText.textContent = TL.PATCH.RELOAD_APPLIED;
        }
        btnPatchReload.hidden = true;
    });

    btnPatchesBack.addEventListener('click', () => {
        // Going back reloads patches from scratch, discarding any edits. Warn first.
        if (state.patchUI.hasEdits() && !window.confirm(TL.PATCH.DISCARD_EDITS_CONFIRM)) {
            return;
        }
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
        const enabled = state.patchUI.getEnabledPatches();
        populateList(patchList, enabled);
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
        buildProgress.textContent = TL.STATUS.DOWNLOADING;
        return fetchWithProgress(url, (received, total) => {
            if (!total) {
                // No usable Content-Length (e.g. a gzip-encoded response) — show
                // received bytes without a percentage rather than "NaN%".
                buildProgress.textContent = `${TL.STATUS.DOWNLOADING} ${formatMB(received)}`;
                return;
            }
            const pct = ((received / total) * 100).toFixed(0);
            buildProgress.textContent = TL.STATUS.DOWNLOADING_PROGRESS(formatMB(received), formatMB(total), pct);
        }, 'Download failed');
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
        const deviceName = koboModels[state.selectedPrefix] || 'Kobo';
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

        if (analyticsEnabled()) {
            setupFeedback(stepDone, (vote) => {
                track('feedback', { vote });
            });
        }

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

    function buildPatchesManifest() {
        const version = typeof globalThis.__APP_VERSION__ !== 'undefined' ? globalThis.__APP_VERSION__ : 'unknown';
        return {
            overrides: state.patchUI.getOverrides(),
            customized: state.patchUI.getCustomizations(),
            files: [
                { path: '.kobo/KoboRoot.tgz', type: 'file' },
            ],
            meta: {
                writer: { name: 'kobopatch-webui', version },
                installed: {
                    timestamp: new Date().toISOString(),
                    firmware: state.firmwareVersion,
                    model: state.selectedPrefix,
                },
            },
        };
    }

    btnWrite.addEventListener('click', async () => {
        if (!state.resultTgz || !state.device.directoryHandle) return;

        btnWrite.disabled = true;
        btnWrite.textContent = TL.BUTTON.WRITING;
        downloadInstructions.hidden = true;

        const audit = new AuditLog('custom-patches', new Date(), state.device);

        try {
            await state.device.writeFile(['.kobo', 'KoboRoot.tgz'], state.resultTgz);
            audit.record(`Wrote .kobo/KoboRoot.tgz (${state.resultTgz.length} bytes)`);

            // Best-effort manifest write — but never for a restore. The manifest
            // reflects the last *customized* state; restoring stock firmware is a
            // de-customization, so it must leave any existing manifest untouched
            // (so a later reload can still re-apply the genuine last patch set).
            if (!state.isRestore) {
                try {
                    const manifest = buildPatchesManifest();
                    const data = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
                    await state.device.writeFile([AUDIT_LOG_DIRECTORY, 'custom-patches.json'], data);
                    audit.record('Wrote .kobopatch-webui/custom-patches.json manifest');
                } catch (e) {
                    console.warn('Could not write custom-patches manifest:', e);
                }
            }

            await audit.write();
            btnWrite.textContent = TL.BUTTON.WRITTEN;
            btnWrite.className = 'btn-success';
            writeInstructions.hidden = false;
            track('flow-end', { result: state.isRestore ? 'restore-write' : 'patches-write' });
        } catch (err) {
            audit.record(`Failed: ${err.message}`);
            btnWrite.disabled = false;
            btnWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
            state.showError(TL.STATUS.WRITE_FAILED(err.message), null, {
                deviceWrite: !!err.deviceWrite,
                auditLog: audit,
            });
        }
    });

    btnDownload.addEventListener('click', async () => {
        if (!state.resultTgz) return;

        btnDownload.disabled = true;
        try {
            // Bundle KoboRoot.tgz together with the manifest, mirroring the
            // folder layout a USB install writes to the device. The manifest
            // carries the definitional info about the chosen patches/config.
            const zip = new JSZip();
            zip.file('.kobo/KoboRoot.tgz', state.resultTgz);
            // A restore carries no customization, so it omits the manifest — both
            // to reflect that nothing is applied and to avoid overwriting the
            // device's last-customized manifest when the ZIP is extracted.
            if (!state.isRestore) {
                const manifest = buildPatchesManifest();
                const manifestData = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
                zip.file(`${AUDIT_LOG_DIRECTORY}/custom-patches.json`, manifestData);
            }
            // Bundle the same manual-install guidance the wizard shows on screen.
            const version = typeof globalThis.__APP_VERSION__ !== 'undefined' ? globalThis.__APP_VERSION__ : 'unknown';
            zip.file('instructions.txt', buildPatchesInstructions({
                version,
                deviceName: koboModels[state.selectedPrefix] || 'Kobo',
            }));
            const bytes = await zip.generateAsync({ type: 'uint8array' });
            triggerDownload(bytes, 'custom-patches.zip', 'application/zip');
        } catch (err) {
            state.showError(TL.ERROR.DOWNLOAD_FAILED_MESSAGE, err.message, {
                title: TL.ERROR.DOWNLOAD_FAILED_TITLE,
            });
            return;
        } finally {
            btnDownload.disabled = false;
        }

        writeInstructions.hidden = true;
        downloadInstructions.hidden = false;
        $('download-device-name').textContent = koboModels[state.selectedPrefix] || 'Kobo';
        track('flow-end', { result: state.isRestore ? 'restore-download' : 'patches-download' });
    });

    // Expose only what the orchestrator needs.
    return { goToPatches, goToBuild, updatePatchCount, configureFirmwareStep };
}
