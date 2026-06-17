import { AUDIT_LOG_DIRECTORY } from '../kobo/audit-log.js';
import { collect, formatMB, fetchWithProgress, populateList } from '../shell/dom.js';
import { createFlow } from '../shell/step-machine.js';
import { createTerminal } from '../shell/terminal.js';
import { buildPatchesInstructions } from '../shell/instructions.js';
import { koboModels } from '../kobo/version.js';
import { TL } from '../shell/strings.js';
import JSZip from 'jszip';

export function initPatchesFlow(state) {

    const {
        'step-done': stepDone,
        'patch-container': patchContainer,
        'patch-reload-banner': patchReloadBanner,
        'patch-reload-text': patchReloadText,
        'btn-patch-reload': btnPatchReload,
        'btn-patches-back': btnPatchesBack,
        'btn-patches-next': btnPatchesNext,
        'btn-build-back': btnBuildBack,
        'btn-build': btnBuild,
        'btn-write': btnWrite,
        'btn-download': btnDownload,
        'build-progress': buildProgress,
        'build-log': buildLog,
        'build-status': buildStatus,
        'existing-tgz-warning': existingTgzWarning,
        'write-instructions': writeInstructions,
        'download-instructions': downloadInstructions,
        'firmware-version-label': firmwareVersionLabel,
        'firmware-device-label': firmwareDeviceLabel,
        'firmware-description': firmwareDescription,
        'patch-count-hint': patchCountHint,
        'done-log': _doneLog,
        'selected-patches-list': _selectedPatchesList,
        'selected-patches-heading': _selectedPatchesHeading,
        'build-wait-hint': _buildWaitHint,
        'firmware-download-url': _firmwareDownloadUrl,
        'download-device-name': _downloadDeviceName,
    } = collect([
        'step-done', 'patch-container', 'patch-reload-banner', 'patch-reload-text',
        'btn-patch-reload', 'btn-patches-back', 'btn-patches-next', 'btn-build-back',
        'btn-build', 'btn-write', 'btn-download', 'build-progress', 'build-log',
        'build-status', 'existing-tgz-warning', 'write-instructions', 'download-instructions',
        'firmware-version-label', 'firmware-device-label', 'firmware-description',
        'patch-count-hint', 'done-log', 'selected-patches-list', 'selected-patches-heading',
        'build-wait-hint', 'firmware-download-url', 'download-device-name',
    ]);

    const steps = [
        {
            id: 'patches',
            domId: 'step-patches',
            navLabels: TL.NAV_PATCHES,
            navIndex: 3,
            recoveryStep: 'patches',
            onEnter: async () => {
                void maybeOfferReload();
            },
        },
        {
            id: 'firmware',
            domId: 'step-firmware',
            navLabels: TL.NAV_PATCHES,
            navIndex: 4,
            recoveryStep: 'patches',
            back: (ctx) => ctx.isRestore ? null : 'patches',
            onEnter: async () => {
                if (state.isRestore) {
                    firmwareDescription.textContent = TL.STATUS.RESTORE_ORIGINAL;
                    btnBuild.textContent = TL.BUTTON.RESTORE_ORIGINAL;
                } else {
                    firmwareDescription.textContent = TL.STATUS.FIRMWARE_WILL_BE_DOWNLOADED;
                    btnBuild.textContent = TL.BUTTON.BUILD_PATCHED;
                }
                populateSelectedPatchesList();
            },
        },
        {
            id: 'building',
            domId: 'step-building',
            transient: true,
            recoveryStep: 'patches',
        },
        {
            id: 'done',
            domId: 'step-done',
            navLabels: TL.NAV_PATCHES,
            navIndex: 5,
            onEnter: async () => {
                const action = state.isRestore ? 'Software extracted' : 'Patching complete';
                const description = state.isRestore ? 'This will restore the original unpatched software.' : '';
                const deviceName = koboModels[state.selectedPrefix] || 'Kobo';
                const installHint = state.manualMode
                    ? 'Download the file and copy it to your ' + deviceName + '.'
                    : 'Write it directly to your connected Kobo, or download for manual installation.';

                buildStatus.innerHTML =
                    action + '. <strong>KoboRoot.tgz</strong> (' + formatMB(state.resultTgz.length) + ') is ready. ' +
                    (description ? description + ' ' : '') + installHint;

                const doneLog = _doneLog;
                doneLog.textContent = buildLog.textContent;

                btnWrite.hidden = state.manualMode;
                btnWrite.disabled = false;
                btnWrite.className = 'primary';
                btnWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
                btnDownload.disabled = false;
                writeInstructions.hidden = true;
                downloadInstructions.hidden = true;
                existingTgzWarning.hidden = true;

                terminal.wireFeedback();

                requestAnimationFrame(() => {
                    doneLog.scrollTop = doneLog.scrollHeight;
                });

                await checkExistingTgz();
            },
        },
    ];

    const flow = createFlow({ id: 'patches', steps });
    const terminal = createTerminal({
        doneStep: stepDone,
        showError: (...args) => state.showError(...args),
    });

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

    function configureFirmwareStep(version, prefix) {
        state.firmwareURL = prefix ? state.getSoftwareUrl(prefix, version) : null;
        state.firmwareVersion = version;
        state.deviceModelLabel = koboModels[prefix] || prefix;
        firmwareVersionLabel.textContent = version;
        firmwareDeviceLabel.textContent = state.deviceModelLabel;
        _firmwareDownloadUrl.textContent = state.firmwareURL || '';
    }

    function goToPatches() {
        flow.go('patches', state);
    }

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
            const hasEnabled = manifest?.overrides && Object.values(manifest.overrides).some(
                file => file && typeof file === 'object' && Object.values(file).some(Boolean)
            );
            const hasCustomized = manifest?.customized && Object.keys(manifest.customized).length > 0;
            if (!hasEnabled && !hasCustomized) return;
            state.reloadManifest = manifest;
            patchReloadBanner.hidden = false;
        } catch {
        }
    }

    btnPatchReload.addEventListener('click', () => {
        if (!state.reloadManifest) return;
        btnPatchReload.disabled = true;

        const summary = state.patchUI.applyReloadManifest(state.reloadManifest);
        state.patchUI.render(patchContainer);
        updatePatchCount();

        patchReloadBanner.classList.remove('banner--info');
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
        if (state.patchUI.hasEdits() && !window.confirm(TL.PATCH.DISCARD_EDITS_CONFIRM)) {
            return;
        }
        if (state.manualMode) {
            state.goToManualVersionStep();
        } else {
            state.goToModeSelection();
        }
    });

    btnPatchesNext.addEventListener('click', () => {
        state.isRestore = state.patchUI.getEnabledCount() === 0;
        flow.go('firmware', state, { skipHistory: true });
    });

    function populateSelectedPatchesList() {
        const patchList = _selectedPatchesList;
        const enabled = state.patchUI.getEnabledPatches();
        populateList(patchList, enabled);
        const hasPatches = enabled.length > 0;
        patchList.hidden = !hasPatches;
        _selectedPatchesHeading.hidden = !hasPatches;
    }

    function goToBuild() {
        flow.go('firmware', state, { skipHistory: true });
    }

    btnBuildBack.addEventListener('click', async () => {
        if (state.isRestore) {
            state.isRestore = false;
            state.goBackToDeviceStep();
        } else {
            const target = flow.back(state);
            if (target) await flow.go(target, state);
        }
    });

    function appendLog(msg) {
        buildLog.textContent += msg + '\n';
        buildLog.scrollTop = buildLog.scrollHeight;
    }

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

    async function runPatcher(firmwareBytes) {
        buildProgress.textContent = TL.STATUS.APPLYING_PATCHES;
        const configYAML = state.patchUI.generateConfig();
        const patchFiles = state.patchUI.getPatchFileBytes();

        const result = await state.runner.patchFirmware(configYAML, firmwareBytes, patchFiles, (msg) => {
            appendLog(msg);
            const trimmed = msg.trimStart();
            if (trimmed.startsWith('Patching ') || trimmed.startsWith('Checking ') ||
                trimmed.startsWith('Loading WASM') || trimmed.startsWith('WASM module')) {
                buildProgress.textContent = trimmed;
            }
        });

        return result.tgz;
    }

    async function checkExistingTgz() {
        if (state.manualMode || !state.device.directoryHandle) return;
        try {
            const koboDir = await state.device.directoryHandle.getDirectoryHandle('.kobo');
            await koboDir.getFileHandle('KoboRoot.tgz');
            existingTgzWarning.hidden = false;
        } catch {
        }
    }

    btnBuild.addEventListener('click', async () => {
        await flow.go('building', state, { skipHistory: true });
        buildLog.textContent = '';
        buildProgress.textContent = TL.STATUS.BUILDING_STARTING;
        _buildWaitHint.textContent = state.isRestore
            ? 'Please wait while the original software is being downloaded and extracted...'
            : 'Please wait while the patch is being applied...';

        try {
            if (!state.firmwareURL) {
                state.showError(TL.STATUS.NO_FIRMWARE_URL);
                return;
            }

            const firmwareBytes = await downloadFirmware(state.firmwareURL);
            appendLog('Download complete: ' + formatMB(firmwareBytes.length));

            state.resultTgz = state.isRestore
                ? await extractOriginalTgz(firmwareBytes)
                : await runPatcher(firmwareBytes);

            await flow.go('done', state);
        } catch (err) {
            state.showError('Build failed: ' + err.message, buildLog.textContent);
        }
    });

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

        const writes = [{
            path: ['.kobo', 'KoboRoot.tgz'],
            data: state.resultTgz,
            label: `Wrote .kobo/KoboRoot.tgz (${state.resultTgz.length} bytes)`,
        }];
        if (!state.isRestore) {
            const manifestData = new TextEncoder().encode(JSON.stringify(buildPatchesManifest(), null, 2) + '\n');
            writes.push({
                path: [AUDIT_LOG_DIRECTORY, 'custom-patches.json'],
                data: manifestData,
                label: 'Wrote .kobopatch-webui/custom-patches.json manifest',
                optional: true,
            });
        }

        const result = await terminal.writeToDevice({
            device: state.device,
            auditName: 'custom-patches',
            writes,
            failMessage: (err) => TL.STATUS.WRITE_FAILED(err.message),
        });

        if (!result.ok) {
            btnWrite.disabled = false;
            btnWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
            return;
        }

        btnWrite.textContent = TL.BUTTON.WRITTEN;
        btnWrite.className = 'btn-success';
        writeInstructions.hidden = false;
        terminal.end(state.isRestore ? 'restore-write' : 'patches-write');
    });

    btnDownload.addEventListener('click', async () => {
        if (!state.resultTgz) return;

        btnDownload.disabled = true;
        try {
            const entries = [{ path: '.kobo/KoboRoot.tgz', data: state.resultTgz }];
            if (!state.isRestore) {
                const manifestData = new TextEncoder().encode(JSON.stringify(buildPatchesManifest(), null, 2) + '\n');
                entries.push({ path: `${AUDIT_LOG_DIRECTORY}/custom-patches.json`, data: manifestData });
            }
            const version = typeof globalThis.__APP_VERSION__ !== 'undefined' ? globalThis.__APP_VERSION__ : 'unknown';
            await terminal.download({
                entries,
                instructions: buildPatchesInstructions({
                    version,
                    deviceName: koboModels[state.selectedPrefix] || 'Kobo',
                }),
                filename: 'custom-patches.zip',
            });
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
        _downloadDeviceName.textContent = koboModels[state.selectedPrefix] || 'Kobo';
        terminal.end(state.isRestore ? 'restore-download' : 'patches-download');
    });

    return { goToPatches, goToBuild, updatePatchCount, configureFirmwareStep };
}
