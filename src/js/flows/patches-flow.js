import { AUDIT_LOG_DIRECTORY } from '../kobo/audit-log.js';
import { collect, formatBytes, populateList } from '../shell/dom.js';
import { createFlow } from '../shell/step-machine.js';
import { createTerminal } from '../shell/terminal.js';
import { buildPatchesInstructions } from '../shell/instructions.js';
import { TL } from '../shell/strings.js';
import { appendLog, downloadFirmware, extractOriginalTgz, runPatcher, buildPatchesManifest, checkExistingTgz } from './patches-execute.js';
import { applyPatchSideEffectConfSettings, patchSideEffectConfSettings } from '../patches/side-effects.js';
import { getPatchMeta } from '../patches/patch-metadata.js';
import { openBlacklistDialog } from '../patches/patch-list-view.js';
import { buildAdditionalFilesTgz, mergeAdditionalFilesIntoTgz } from '../patches/additional-files.js';

export function initPatchesFlow(state) {
    const {
        'step-done': stepDone,
        'patch-container': patchContainer,
        'patch-reload-banner': patchReloadBanner,
        'patch-reload-text': patchReloadText,
        'btn-patch-reload': btnPatchReload,
        'patch-reload-dialog': patchReloadDialog,
        'btn-patch-reload-dialog-close': btnPatchReloadDialogClose,
        'patch-reload-dialog-intro': patchReloadDialogIntro,
        'patch-reload-dialog-list': patchReloadDialogList,
        'patch-reload-dialog-notes': patchReloadDialogNotes,
        'patch-reload-dialog-footnote': patchReloadDialogFootnote,
        'patch-reload-dialog-modified-note': patchReloadDialogModifiedNote,
        'patch-reload-dialog-additional-note': patchReloadDialogAdditionalNote,
        'patch-advanced-section': patchAdvancedSection,
        'btn-patch-blacklist': btnPatchBlacklist,
        'patch-original-format': patchOriginalFormat,
        'btn-patch-additional-files': btnPatchAdditionalFiles,
        'patch-additional-file-input': patchAdditionalFileInput,
        'patch-additional-files-empty': patchAdditionalFilesEmpty,
        'patch-additional-files-list': patchAdditionalFilesList,
        'patch-additional-files-error': patchAdditionalFilesError,
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
        'write-conf-settings-note': writeConfSettingsNote,
        'patch-download-conf-settings-step': patchDownloadConfSettingsStep,
        'patch-download-conf-settings': patchDownloadConfSettings,
        'firmware-version-label': firmwareVersionLabel,
        'firmware-device-label': firmwareDeviceLabel,
        'firmware-description': firmwareDescription,
        'firmware-download-details': firmwareDownloadDetails,
        'patch-count-hint': patchCountHint,
        'done-log': _doneLog,
        'selected-patches-list': _selectedPatchesList,
        'selected-patches-heading': _selectedPatchesHeading,
        'selected-additional-files-list': _selectedAdditionalFilesList,
        'selected-additional-files-heading': _selectedAdditionalFilesHeading,
        'build-wait-hint': _buildWaitHint,
        'firmware-download-url': _firmwareDownloadUrl,
        'download-device-name': _downloadDeviceName,
    } = collect([
        'step-done',
        'patch-container',
        'patch-reload-banner',
        'patch-reload-text',
        'btn-patch-reload',
        'patch-reload-dialog',
        'btn-patch-reload-dialog-close',
        'patch-reload-dialog-intro',
        'patch-reload-dialog-list',
        'patch-reload-dialog-notes',
        'patch-reload-dialog-footnote',
        'patch-reload-dialog-modified-note',
        'patch-reload-dialog-additional-note',
        'patch-advanced-section',
        'btn-patch-blacklist',
        'patch-original-format',
        'btn-patch-additional-files',
        'patch-additional-file-input',
        'patch-additional-files-empty',
        'patch-additional-files-list',
        'patch-additional-files-error',
        'btn-patches-back',
        'btn-patches-next',
        'btn-build-back',
        'btn-build',
        'btn-write',
        'btn-download',
        'build-progress',
        'build-log',
        'build-status',
        'existing-tgz-warning',
        'write-instructions',
        'download-instructions',
        'write-conf-settings-note',
        'patch-download-conf-settings-step',
        'patch-download-conf-settings',
        'firmware-version-label',
        'firmware-device-label',
        'firmware-description',
        'firmware-download-details',
        'patch-count-hint',
        'done-log',
        'selected-patches-list',
        'selected-patches-heading',
        'selected-additional-files-list',
        'selected-additional-files-heading',
        'build-wait-hint',
        'firmware-download-url',
        'download-device-name',
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
            back: (ctx) => (ctx.isRestore ? null : 'patches'),
            onEnter: async () => {
                const additionalFilesOnly = !state.isRestore && state.patchUI.getEnabledCount() === 0;
                if (state.isRestore) {
                    firmwareDescription.textContent = TL.STATUS.RESTORE_ORIGINAL;
                    btnBuild.textContent = TL.BUTTON.RESTORE_ORIGINAL;
                } else if (additionalFilesOnly) {
                    firmwareDescription.textContent = TL.STATUS.ADDITIONAL_FILES_ONLY;
                    btnBuild.textContent = TL.BUTTON.BUILD_ADDITIONAL_FILES;
                } else {
                    firmwareDescription.textContent = TL.STATUS.FIRMWARE_WILL_BE_DOWNLOADED;
                    btnBuild.textContent = TL.BUTTON.BUILD_PATCHED;
                }
                // The download URL is only relevant when the firmware is actually fetched.
                firmwareDownloadDetails.hidden = additionalFilesOnly;
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
                const additionalFilesOnly = !state.isRestore && state.patchUI.getEnabledCount() === 0;
                const action = state.isRestore ? 'Software extracted' : additionalFilesOnly ? 'Files packaged' : 'Patching complete';
                const description = state.isRestore ? 'This will restore the original unpatched software.' : '';
                const deviceName = state.deviceModelLabel || 'Kobo';
                const installHint = state.manualMode
                    ? 'Download the file and copy it to your ' + deviceName + '.'
                    : 'Write it directly to your connected Kobo, or download for manual installation.';

                buildStatus.innerHTML =
                    action +
                    '. <strong>KoboRoot.tgz</strong> (' +
                    formatBytes(state.resultTgz.length) +
                    ') is ready. ' +
                    (description ? description + ' ' : '') +
                    installHint;

                const doneLog = _doneLog;
                doneLog.textContent = buildLog.textContent;

                btnWrite.hidden = state.manualMode;
                btnWrite.disabled = false;
                btnWrite.className = 'primary';
                btnWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
                btnDownload.disabled = false;
                writeInstructions.hidden = true;
                writeConfSettingsNote.hidden = true;
                downloadInstructions.hidden = true;
                patchDownloadConfSettingsStep.hidden = true;
                existingTgzWarning.hidden = true;

                terminal.wireFeedback();

                requestAnimationFrame(() => {
                    doneLog.scrollTop = doneLog.scrollHeight;
                });

                if (await checkExistingTgz(state.device, state.manualMode)) {
                    existingTgzWarning.hidden = false;
                }
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
        const additionalCount = state.patchUI.getAdditionalFileCount();
        const additionalValidation = state.patchUI.validateAdditionalFiles();
        btnPatchesNext.disabled = !additionalValidation.ok;
        renderAdditionalFiles();
        patchAdditionalFilesError.hidden = additionalValidation.ok;
        patchAdditionalFilesError.textContent = additionalValidation.message;
        if (!additionalValidation.ok) patchAdvancedSection.open = true;

        if (count === 0 && additionalCount === 0) {
            patchCountHint.textContent = TL.STATUS.PATCH_COUNT_ZERO;
        } else if (count === 0) {
            patchCountHint.textContent = additionalCount === 1 ? TL.STATUS.PATCH_EXTRA_FILE_COUNT_ONE : TL.STATUS.PATCH_EXTRA_FILE_COUNT_MULTI(additionalCount);
        } else if (additionalCount === 0) {
            patchCountHint.textContent = count === 1 ? TL.STATUS.PATCH_COUNT_ONE : TL.STATUS.PATCH_COUNT_MULTI(count);
        } else {
            patchCountHint.textContent = TL.STATUS.PATCH_AND_EXTRA_FILE_COUNT(count, additionalCount);
        }
    }

    state.patchUI.onChange = updatePatchCount;

    function configureFirmwareStep(version, channel, deviceLabel = channel) {
        state.selectedChannel = channel;
        state.firmwareURL = channel ? state.getSoftwareUrl(channel, version) : null;
        state.firmwareVersion = version;
        state.deviceModelLabel = deviceLabel;
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
            const hasEnabled =
                manifest?.overrides && Object.values(manifest.overrides).some((file) => file && typeof file === 'object' && Object.values(file).some(Boolean));
            const hasCustomized = manifest?.customized && Object.keys(manifest.customized).length > 0;
            if (!hasEnabled && !hasCustomized) return;
            state.reloadManifest = manifest;
            patchReloadBanner.hidden = false;
        } catch {}
    }

    function showReloadSummaryDialog({ applied, showModifiedNote, showAdditionalFilesNote }) {
        patchReloadDialogIntro.textContent = TL.PATCH.RELOAD_SUMMARY_INTRO;

        patchReloadDialogList.innerHTML = '';
        let anyIncompatible = false;
        for (const patch of applied) {
            const li = document.createElement('li');
            li.textContent = getPatchMeta(patch.name).label || patch.name;
            if (patch.incompatible) {
                li.append(' ⚠️');
                anyIncompatible = true;
            }
            patchReloadDialogList.appendChild(li);
        }

        // Conditional footer notices. A normal "just checked patches" reload shows
        // none of these; each only appears for the situation it describes.
        patchReloadDialogFootnote.textContent = anyIncompatible ? `⚠️ ${TL.PATCH.RELOAD_SUMMARY_INCOMPATIBLE}` : '';
        patchReloadDialogFootnote.hidden = !anyIncompatible;

        patchReloadDialogModifiedNote.textContent = showModifiedNote ? TL.PATCH.RELOAD_SUMMARY_MODIFIED_NOTE : '';
        patchReloadDialogModifiedNote.hidden = !showModifiedNote;

        patchReloadDialogAdditionalNote.textContent = showAdditionalFilesNote ? TL.PATCH.RELOAD_SUMMARY_ADDITIONAL_FILES_NOTE : '';
        patchReloadDialogAdditionalNote.hidden = !showAdditionalFilesNote;

        patchReloadDialogNotes.hidden = !(anyIncompatible || showModifiedNote || showAdditionalFilesNote);

        patchReloadDialog.showModal();
    }

    btnPatchReloadDialogClose.addEventListener('click', () => patchReloadDialog.close());
    patchReloadDialog.addEventListener('click', (e) => {
        if (e.target === patchReloadDialog) patchReloadDialog.close();
    });

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
            // Only surface the summary modal when there are re-enabled patches to
            // list; an edits-only reload just updates the banner.
            if (summary.applied.length > 0) {
                const manifest = state.reloadManifest;
                // Re-applying onto the same firmware re-runs identical edits, so the
                // "modified patches may not apply" caveat only applies across versions.
                const recordedFirmware = manifest?.meta?.installed?.firmware;
                const sameFirmware = !!recordedFirmware && recordedFirmware === state.patchUI.firmwareVersion;
                showReloadSummaryDialog({
                    applied: summary.applied,
                    showModifiedNote: summary.edits > 0 && !sameFirmware,
                    showAdditionalFilesNote: Array.isArray(manifest?.files) && manifest.files.some((f) => f?.type === 'additional-file'),
                });
            }
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
        if (!state.patchUI.validateAdditionalFiles().ok) return;
        state.isRestore = state.patchUI.getEnabledCount() === 0 && !state.patchUI.hasAdditionalFiles();
        flow.go('firmware', state, { skipHistory: true });
    });

    function populateSelectedPatchesList() {
        const patchList = _selectedPatchesList;
        const enabled = state.patchUI.getEnabledPatches();
        populateList(patchList, enabled);
        const hasPatches = enabled.length > 0;
        patchList.hidden = !hasPatches;
        _selectedPatchesHeading.hidden = !hasPatches;

        const additionalFiles = state.patchUI.getAdditionalFiles().map((file) => `${file.name} -> ${file.validation.path || file.destination}`);
        populateList(_selectedAdditionalFilesList, additionalFiles);
        const hasAdditionalFiles = additionalFiles.length > 0;
        _selectedAdditionalFilesList.hidden = !hasAdditionalFiles;
        _selectedAdditionalFilesHeading.hidden = !hasAdditionalFiles;
    }

    function renderAdditionalFiles() {
        const files = state.patchUI.getAdditionalFiles();
        patchAdditionalFilesEmpty.hidden = files.length > 0;
        patchAdditionalFilesList.innerHTML = '';

        for (const file of files) {
            const row = document.createElement('div');
            row.className = 'patch-additional-file-row';

            const name = document.createElement('div');
            name.className = 'patch-additional-file-name';
            name.textContent = file.name;

            const size = document.createElement('span');
            size.className = 'patch-additional-file-size';
            size.textContent = formatBytes(file.size);
            name.appendChild(size);

            const target = document.createElement('div');
            target.className = 'patch-additional-file-target';

            const label = document.createElement('label');
            label.setAttribute('for', `patch-additional-file-destination-${file.id}`);
            label.textContent = 'Destination';

            const input = document.createElement('input');
            input.id = `patch-additional-file-destination-${file.id}`;
            input.value = file.destination;
            input.placeholder = 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Font.ttf';
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.setAttribute('aria-invalid', file.validation.ok ? 'false' : 'true');
            if (!file.validation.ok) input.setAttribute('aria-describedby', `patch-additional-file-error-${file.id}`);
            input.addEventListener('change', () => state.patchUI.updateAdditionalFileDestination(file.id, input.value));
            target.append(label, input);

            if (!file.validation.ok) {
                const error = document.createElement('p');
                error.id = `patch-additional-file-error-${file.id}`;
                error.className = 'patch-additional-file-error';
                error.textContent = file.validation.message;
                target.appendChild(error);
            }

            const remove = document.createElement('button');
            remove.className = 'secondary patch-additional-file-remove';
            remove.type = 'button';
            remove.setAttribute('aria-label', `Remove ${file.name}`);
            remove.title = `Remove ${file.name}`;
            remove.textContent = '\u00d7';
            remove.addEventListener('click', () => state.patchUI.removeAdditionalFile(file.id));

            row.append(name, target, remove);
            patchAdditionalFilesList.appendChild(row);
        }
    }

    function selectedPatchConfSettings() {
        if (state.isRestore) return [];
        return patchSideEffectConfSettings(state.patchUI.getEnabledPatches());
    }

    async function addPatchSideEffectWrites(writes, confSettings) {
        if (confSettings.length === 0) return false;

        const confPath = ['.kobo', 'Kobo', 'Kobo eReader.conf'];
        const current = (await state.device.readFile(confPath)) || '';
        const updated = applyPatchSideEffectConfSettings(current, confSettings);
        if (updated === current) return false;

        writes.push({
            path: confPath,
            data: new TextEncoder().encode(updated),
            label: 'Updated .kobo/Kobo/Kobo eReader.conf for selected patch side effects',
        });
        return true;
    }

    function renderDownloadConfSettings(container, settings) {
        container.innerHTML = '';

        const sections = new Map();
        for (const { section, key, value } of settings) {
            if (!sections.has(section)) sections.set(section, []);
            sections.get(section).push(`${key}=${value}`);
        }

        for (const [section, lines] of sections) {
            const intro = document.createElement('p');
            const sectionCode = document.createElement('code');
            sectionCode.textContent = `[${section}]`;
            intro.append('In the ', sectionCode, ' section (add it if it is missing):');
            container.appendChild(intro);

            for (const line of lines) {
                const lineCode = document.createElement('code');
                lineCode.textContent = line;
                container.append(lineCode, document.createElement('br'));
            }
        }
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

    btnBuild.addEventListener('click', async () => {
        await flow.go('building', state, { skipHistory: true });
        buildLog.textContent = '';
        buildProgress.textContent = TL.STATUS.BUILDING_STARTING;
        _buildWaitHint.textContent = state.isRestore
            ? 'Please wait while the original software is being downloaded and extracted...'
            : state.patchUI.getEnabledCount() === 0
              ? 'Please wait while KoboRoot.tgz is being built...'
              : 'Please wait while the patch is being applied...';

        try {
            const log = (msg) => appendLog(buildLog, msg);

            // No patches selected, only additional files: build a KoboRoot.tgz
            // containing just those files. The firmware and patched libraries are
            // not needed, so skip the download and the patcher entirely.
            if (!state.isRestore && state.patchUI.getEnabledCount() === 0) {
                state.additionalFileEntries = await state.patchUI.readAdditionalFileEntries();
                buildProgress.textContent = 'Building KoboRoot.tgz...';
                log(
                    `Building KoboRoot.tgz with ${state.additionalFileEntries.length} additional file${state.additionalFileEntries.length === 1 ? '' : 's'} (no patches selected)...`,
                );
                state.resultTgz = await buildAdditionalFilesTgz(state.additionalFileEntries);
                for (const entry of state.additionalFileEntries) {
                    log(`  ADD ${entry.sourceName} -> ${entry.path}`);
                }
                await flow.go('done', state);
                return;
            }

            if (!state.firmwareURL) {
                state.showError(TL.STATUS.NO_FIRMWARE_URL);
                return;
            }

            const firmwareBytes = await downloadFirmware(state.firmwareURL, buildProgress);
            log('Download complete: ' + formatBytes(firmwareBytes.length));

            state.resultTgz = state.isRestore
                ? await extractOriginalTgz(firmwareBytes, buildProgress, log)
                : await runPatcher(state.runner, state.patchUI.generateConfig(), firmwareBytes, state.patchUI.getPatchFileBytes(), buildProgress, log);

            state.additionalFileEntries = state.isRestore ? [] : await state.patchUI.readAdditionalFileEntries();
            if (state.additionalFileEntries.length > 0) {
                log(`Adding ${state.additionalFileEntries.length} additional file${state.additionalFileEntries.length === 1 ? '' : 's'}...`);
                state.resultTgz = await mergeAdditionalFilesIntoTgz(state.resultTgz, state.additionalFileEntries);
                for (const entry of state.additionalFileEntries) {
                    log(`  ADD ${entry.sourceName} -> ${entry.path}`);
                }
            }

            await flow.go('done', state);
        } catch (err) {
            state.showError('Build failed: ' + err.message, buildLog.textContent);
        }
    });

    btnWrite.addEventListener('click', async () => {
        if (!state.resultTgz || !state.device.directoryHandle) return;

        btnWrite.disabled = true;
        btnWrite.textContent = TL.BUTTON.WRITING;
        downloadInstructions.hidden = true;

        const confSettings = selectedPatchConfSettings();
        const writes = [];
        let handledConfSettings = false;

        try {
            await addPatchSideEffectWrites(writes, confSettings);
            handledConfSettings = confSettings.length > 0;
            writes.push({
                path: ['.kobo', 'KoboRoot.tgz'],
                data: state.resultTgz,
                label: `Wrote .kobo/KoboRoot.tgz (${state.resultTgz.length} bytes)`,
            });
            if (!state.isRestore) {
                const manifest = buildPatchesManifest(state.patchUI, state.firmwareVersion, state.selectedChannel, state.additionalFileEntries || []);
                const manifestData = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
                writes.push({
                    path: [AUDIT_LOG_DIRECTORY, 'custom-patches.json'],
                    data: manifestData,
                    label: 'Wrote .kobopatch-webui/custom-patches.json manifest',
                    optional: true,
                });
            }
        } catch (err) {
            state.showError(TL.STATUS.WRITE_FAILED(err.message));
            btnWrite.disabled = false;
            btnWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
            return;
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
        writeConfSettingsNote.hidden = !handledConfSettings;
        writeInstructions.hidden = false;
        terminal.end(state.isRestore ? 'restore-write' : 'patches-write');
    });

    btnDownload.addEventListener('click', async () => {
        if (!state.resultTgz) return;

        btnDownload.disabled = true;
        try {
            const entries = [{ path: '.kobo/KoboRoot.tgz', data: state.resultTgz }];
            const confSettings = selectedPatchConfSettings();
            if (!state.isRestore) {
                const manifest = buildPatchesManifest(state.patchUI, state.firmwareVersion, state.selectedChannel, state.additionalFileEntries || []);
                const manifestData = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
                entries.push({ path: `${AUDIT_LOG_DIRECTORY}/custom-patches.json`, data: manifestData });
            }
            const version = typeof globalThis.__APP_VERSION__ !== 'undefined' ? globalThis.__APP_VERSION__ : 'unknown';
            await terminal.download({
                entries,
                instructions: buildPatchesInstructions({
                    version,
                    deviceName: state.deviceModelLabel || 'Kobo',
                    confSettings,
                }),
                filename: 'custom-patches.zip',
            });
            renderDownloadConfSettings(patchDownloadConfSettings, confSettings);
            patchDownloadConfSettingsStep.hidden = confSettings.length === 0;
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
        _downloadDeviceName.textContent = state.deviceModelLabel || 'Kobo';
        terminal.end(state.isRestore ? 'restore-download' : 'patches-download');
    });

    btnPatchBlacklist.addEventListener('click', () => {
        openBlacklistDialog(state.patchUI, patchContainer);
    });

    // Toggle between the themed metadata view and the original kobopatch/MobileRead
    // format (grouped by source file, raw YAML titles). The preference lives on the
    // patch container so renderPatchList/updatePatchCounts read it across re-renders.
    patchOriginalFormat.addEventListener('change', () => {
        patchContainer.dataset.originalFormat = patchOriginalFormat.checked ? 'true' : 'false';
        state.patchUI.render(patchContainer);
    });

    btnPatchAdditionalFiles.addEventListener('click', () => {
        patchAdditionalFileInput.click();
    });

    patchAdditionalFileInput.addEventListener('change', () => {
        state.patchUI.addAdditionalFiles(Array.from(patchAdditionalFileInput.files || []));
        patchAdditionalFileInput.value = '';
        patchAdvancedSection.open = true;
        renderAdditionalFiles();
        updatePatchCount();
    });

    return { goToPatches, goToBuild, updatePatchCount, configureFirmwareStep };
}
