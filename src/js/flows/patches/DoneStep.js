/**
 * DoneStep.js — `step-done`, the result screen for a finished build: write the
 * KoboRoot.tgz to the connected Kobo, or download it as a ZIP.
 *
 * This is the device-write path for custom patches. Everything the two buttons
 * share — the conf side effects and the persisted manifest plus its companion
 * Additional Files archive — lives here as private methods, and the two handlers
 * each call them fresh.
 */

import { AUDIT_LOG_DIRECTORY } from '../../kobo/audit-log.js';
import { formatBytes, renderDownloadConfSettings, requireButton, requireElement } from '../../shell/dom.js';
import { buildPatchesInstructions } from '../../shell/instructions.js';
import { TL } from '../../shell/strings.js';
import { buildPatchesManifest, checkExistingTgz } from '../patches-execute.js';
import { applyPatchSideEffectConfSettings, patchSideEffectConfSettings } from '../../patches/side-effects.js';
import { additionalFilesArchiveName, buildAdditionalFilesTgz, patchManifestName, sha256Hex } from '../../patches/additional-files.js';
import { Step } from '../Step.js';

const CONF_PATH = ['.kobo', 'Kobo', 'Kobo eReader.conf'];

export class DoneStep extends Step {
    /** @param {import('./PatchesFlow.js').PatchesFlow} owner */
    constructor(owner) {
        super(owner, { id: 'done', domId: 'step-done', navLabels: TL.NAV_PATCHES, navIndex: 5 });

        this.buildStatus = requireElement('build-status');
        this.doneLog = requireElement('done-log');
        this.existingTgzWarning = requireElement('existing-tgz-warning');
        this.writeInstructions = requireElement('write-instructions');
        this.downloadInstructions = requireElement('download-instructions');
        this.writeConfSettingsNote = requireElement('write-conf-settings-note');
        this.downloadConfSettingsStep = requireElement('patch-download-conf-settings-step');
        this.downloadConfSettings = requireElement('patch-download-conf-settings');
        this.downloadDeviceName = requireElement('download-device-name');
        this.btnWrite = requireButton('btn-write');
        this.btnDownload = requireButton('btn-download');

        this.#wireListeners();
    }

    async onEnter(_ctx) {
        const session = this.session;
        const additionalFilesOnly = !session.isRestore && session.patchUI.getEnabledCount() === 0;
        const action = session.isRestore ? 'Software extracted' : additionalFilesOnly ? 'Files packaged' : 'Patching complete';
        const description = session.isRestore ? 'This will restore the original unpatched software.' : '';
        const deviceName = session.deviceModelLabel || 'Kobo';
        const installHint = session.manualMode
            ? 'Download the file and copy it to your ' + deviceName + '.'
            : 'Write it directly to your connected Kobo, or download for manual installation.';

        this.buildStatus.innerHTML =
            action +
            '. <strong>KoboRoot.tgz</strong> (' +
            formatBytes(this.owner.build.tgz.length) +
            ') is ready. ' +
            (description ? description + ' ' : '') +
            installHint;

        this.doneLog.textContent = this.owner.building.log.textContent;

        this.btnWrite.hidden = session.manualMode;
        this.btnWrite.disabled = false;
        this.btnWrite.className = 'primary';
        this.btnWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
        this.btnDownload.disabled = false;
        this.writeInstructions.hidden = true;
        this.writeConfSettingsNote.hidden = true;
        this.downloadInstructions.hidden = true;
        this.downloadConfSettingsStep.hidden = true;
        this.existingTgzWarning.hidden = true;

        // Wired before the device probe below, so a slow read does not delay it.
        this.owner.terminal.wireFeedback();

        requestAnimationFrame(() => {
            this.doneLog.scrollTop = this.doneLog.scrollHeight;
        });

        // Awaited last, so the warning appears after the buttons and instructions
        // are already in their final state.
        if (await checkExistingTgz(session.device, session.manualMode)) {
            this.existingTgzWarning.hidden = false;
        }
    }

    /** Conf settings the selected patches need. A restore contributes none. */
    #selectedPatchConfSettings() {
        if (this.session.isRestore) return [];
        return patchSideEffectConfSettings(this.session.patchUI.getEnabledPatches());
    }

    /**
     * Queue a `Kobo eReader.conf` update when the selected patches need one.
     *
     * Mutates `writes` in place. Queues nothing when there are no settings, and
     * nothing when applying them would leave the file unchanged — the conf is not
     * rewritten with identical content. The queued write is **not** `optional`,
     * so a failure aborts the whole batch.
     *
     * @param {object[]} writes - the write list, appended to in place
     * @param {object[]} confSettings - from `#selectedPatchConfSettings`
     * @returns {Promise<boolean>} whether a write was queued
     */
    async #addPatchSideEffectWrites(writes, confSettings) {
        if (confSettings.length === 0) return false;

        const current = (await this.session.device.readFile(CONF_PATH)) || '';
        const updated = applyPatchSideEffectConfSettings(current, confSettings);
        if (updated === current) return false;

        writes.push({
            path: CONF_PATH,
            data: new TextEncoder().encode(updated),
            label: 'Updated .kobo/Kobo/Kobo eReader.conf for selected patch side effects',
        });
        return true;
    }

    /**
     * Build the persisted manifest plus its companion Additional Files archive
     * (when any files were merged). The archive holds the files' bytes; the
     * manifest references it with a checksum so a later reload can verify and
     * restore them.
     *
     * **Building the archive and hashing it is one paired operation, and it must
     * stay that way.** `buildTarGz` stamps `Math.floor(Date.now() / 1000)` into
     * every tar header and the entries carry no `mtime`, so two calls a second
     * apart produce different bytes and a different checksum. That is fine
     * because each call pairs its own bytes with its own hash — the invariant is
     * the pairing, not determinism. Memoizing this, caching `archiveInfo` across
     * the write and download paths, or building here and hashing in a handler all
     * yield a manifest that can never verify. The failure is silent: the reload
     * banner still appears, the reload still reports success, and the user's
     * Additional Files are unrestorable forever.
     *
     * The write and download handlers therefore each call this directly, and each
     * gets its own self-consistent pair. They are not byte-equal to each other
     * and do not need to be.
     *
     * @returns {Promise<{archiveBytes: Uint8Array|null, manifestData: Uint8Array}>}
     */
    async #buildManifestArtifacts() {
        const session = this.session;
        // `|| []` is kept even though `PatchesBuild` initialises the field to an
        // array. It costs nothing and it is the last guard between a never-built
        // session and a TypeError on `.length`.
        const entries = this.owner.build.additionalFileEntries || [];
        let archiveBytes = null;
        let archiveInfo = null;
        if (entries.length > 0) {
            archiveBytes = await buildAdditionalFilesTgz(entries);
            archiveInfo = { sha256: await sha256Hex(archiveBytes), size: archiveBytes.length };
        }
        const manifest = buildPatchesManifest(session.patchUI, session.firmwareVersion, session.selectedChannel, entries, archiveInfo);
        const manifestData = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
        return { archiveBytes, manifestData };
    }

    /**
     * Write the result to the connected Kobo.
     *
     * Two stages with different failure handling. Preparing the write list can
     * throw (conf read, archive build, hashing) — that is caught here, reported
     * as a `write` category error, and returns without calling the device writer
     * at all, so nothing is written. The write itself routes its own errors and
     * reports back through `result.ok`; a failed write restores the button and
     * fires no `flow-end` event.
     *
     * Write order is load-bearing: conf first, then KoboRoot.tgz, then the
     * manifest and archive. Only the last two are `optional` — a failure there is
     * warned about and skipped, and the user simply gets no reload offer next
     * time, rather than an error screen.
     */
    async #write() {
        const session = this.session;
        const build = this.owner.build;
        if (!build.tgz || !session.device.directoryHandle) return;

        this.btnWrite.disabled = true;
        this.btnWrite.textContent = TL.BUTTON.WRITING;
        this.downloadInstructions.hidden = true;

        const confSettings = this.#selectedPatchConfSettings();
        const writes = [];
        let handledConfSettings = false;

        try {
            await this.#addPatchSideEffectWrites(writes, confSettings);
            // Deliberately tracks whether settings were *selected*, not whether a
            // write was queued: the note still shows when the conf already had
            // them and nothing needed rewriting.
            handledConfSettings = confSettings.length > 0;
            writes.push({
                path: ['.kobo', 'KoboRoot.tgz'],
                data: build.tgz,
                label: `Wrote .kobo/KoboRoot.tgz (${build.tgz.length} bytes)`,
            });
            if (!session.isRestore) {
                const { archiveBytes, manifestData } = await this.#buildManifestArtifacts();
                writes.push({
                    path: [AUDIT_LOG_DIRECTORY, patchManifestName],
                    data: manifestData,
                    label: `Wrote ${AUDIT_LOG_DIRECTORY}/${patchManifestName} manifest`,
                    optional: true,
                });
                if (archiveBytes) {
                    writes.push({
                        path: [AUDIT_LOG_DIRECTORY, additionalFilesArchiveName],
                        data: archiveBytes,
                        label: `Wrote ${AUDIT_LOG_DIRECTORY}/${additionalFilesArchiveName} (${archiveBytes.length} bytes)`,
                        optional: true,
                    });
                }
            }
        } catch (err) {
            this.nav.showError(TL.STATUS.WRITE_FAILED(err.message), null, { category: 'write' });
            this.btnWrite.disabled = false;
            this.btnWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
            return;
        }

        const result = await this.owner.terminal.writeToDevice({
            device: session.device,
            auditName: 'custom-patches',
            writes,
            failMessage: (err) => TL.STATUS.WRITE_FAILED(err.message),
        });

        if (!result.ok) {
            this.btnWrite.disabled = false;
            this.btnWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
            return;
        }

        this.btnWrite.textContent = TL.BUTTON.WRITTEN;
        this.btnWrite.className = 'btn-success';
        this.writeConfSettingsNote.hidden = !handledConfSettings;
        this.writeInstructions.hidden = false;
        this.owner.terminal.end(session.isRestore ? 'restore-write' : 'patches-write');
    }

    /**
     * Package the result as a ZIP for manual installation.
     *
     * Unlike the write path this needs no device, its `finally` always re-enables
     * the button, and a failure returns early so the download instructions stay
     * hidden and no `flow-end` event fires.
     */
    async #download() {
        const session = this.session;
        const build = this.owner.build;
        if (!build.tgz) return;

        this.btnDownload.disabled = true;
        try {
            const entries = [{ path: '.kobo/KoboRoot.tgz', data: build.tgz }];
            const confSettings = this.#selectedPatchConfSettings();
            if (!session.isRestore) {
                const { archiveBytes, manifestData } = await this.#buildManifestArtifacts();
                entries.push({ path: `${AUDIT_LOG_DIRECTORY}/${patchManifestName}`, data: manifestData });
                if (archiveBytes) {
                    entries.push({ path: `${AUDIT_LOG_DIRECTORY}/${additionalFilesArchiveName}`, data: archiveBytes });
                }
            }
            const version = typeof globalThis.__APP_VERSION__ !== 'undefined' ? globalThis.__APP_VERSION__ : 'unknown';
            await this.owner.terminal.download({
                entries,
                instructions: buildPatchesInstructions({
                    version,
                    deviceName: session.deviceModelLabel || 'Kobo',
                    confSettings,
                }),
                filename: 'custom-patches.zip',
            });
            renderDownloadConfSettings(this.downloadConfSettings, confSettings);
            this.downloadConfSettingsStep.hidden = confSettings.length === 0;
        } catch (err) {
            this.nav.showError(TL.ERROR.DOWNLOAD_FAILED_MESSAGE, err.message, {
                title: TL.ERROR.DOWNLOAD_FAILED_TITLE,
                category: 'download',
            });
            return;
        } finally {
            this.btnDownload.disabled = false;
        }

        this.writeInstructions.hidden = true;
        this.downloadInstructions.hidden = false;
        this.downloadDeviceName.textContent = session.deviceModelLabel || 'Kobo';
        this.owner.terminal.end(session.isRestore ? 'restore-download' : 'patches-download');
    }

    #wireListeners() {
        const { signal } = this.listeners;
        this.btnWrite.addEventListener('click', () => this.#write(), { signal });
        this.btnDownload.addEventListener('click', () => this.#download(), { signal });
    }
}
