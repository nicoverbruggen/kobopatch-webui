/**
 * ReloadBanner.js — The "reload your previous patches" offer on the patches
 * screen, and the summary dialog it opens.
 *
 * Owns the banner, its button, and the nine elements of the summary modal. Two
 * jobs: decide whether there is anything worth offering (reading the on-device
 * manifest and its companion Additional Files archive), and apply it when the
 * user accepts.
 *
 * Not a `Step` — it is furniture inside `step-patches`, which `PatchesStep`
 * constructs and owns. It wires listeners onto markup that outlives it, and
 * borrows the step's signal to do so, so destroying the step detaches these too
 * and there is no `destroy()` here to forget to chain to. See `Step`.
 */

import { AUDIT_LOG_DIRECTORY } from '../../kobo/AuditLog.js';
import { requireButton, requireDialog, requireElement } from '../../shell/DOM.js';
import { TL } from '../../shell/Strings.js';
import { getPatchMeta } from '../../patches/PatchMetadata.js';
import { additionalFilesArchiveName, patchManifestName, readAdditionalFilesArchive, sha256Hex } from '../../patches/AdditionalFiles.js';

export class ReloadBanner {
    /**
     * @param {import('./PatchesStep.js').PatchesStep} step - the screen this banner lives on
     * @param {AbortSignal} signal - the step's listener signal; see `Step`
     */
    constructor(step, signal) {
        this.step = step;
        this.session = step.session;

        /** @type {object|null} the manifest read off the device, once it is worth offering */
        this.manifest = null;
        /** @type {Array<{sourceName: string, destination: string, data: Uint8Array}>|null} */
        this.additionalFiles = null;

        this.banner = requireElement('patch-reload-banner');
        this.text = requireElement('patch-reload-text');
        this.btnReload = requireButton('btn-patch-reload');

        this.dialog = requireDialog('patch-reload-dialog');
        this.btnDialogClose = requireButton('btn-patch-reload-dialog-close');
        this.dialogIntro = requireElement('patch-reload-dialog-intro');
        this.dialogList = requireElement('patch-reload-dialog-list');
        this.dialogNotes = requireElement('patch-reload-dialog-notes');
        this.dialogFootnote = requireElement('patch-reload-dialog-footnote');
        this.dialogModifiedNote = requireElement('patch-reload-dialog-modified-note');
        this.dialogAdditionalSummary = requireElement('patch-reload-dialog-additional-summary');
        this.dialogAdditionalNote = requireElement('patch-reload-dialog-additional-note');

        this.#wireListeners(signal);
    }

    /**
     * Decide whether to offer a reload, and reveal the banner if so.
     *
     * The prologue runs on **every** entry to the patches screen, including
     * back-navigation and before any early return: a user who reloads and then
     * navigates back gets a clean offer again rather than a stale green banner
     * with the button hidden. Putting any of it behind a guard changes that.
     *
     * The whole body is wrapped in a bare catch. A missing file, a corrupt
     * manifest, or anything thrown while reading the archive means no banner —
     * nothing is logged and nothing is shown to the user.
     */
    async maybeOffer() {
        const session = this.session;
        this.manifest = null;
        this.additionalFiles = null;
        this.banner.hidden = true;
        this.btnReload.hidden = false;
        this.btnReload.disabled = false;
        this.banner.classList.remove('banner--success', 'banner--warning');
        this.banner.classList.add('banner--info');
        this.text.textContent = TL.PATCH.RELOAD_OFFER;

        if (session.manualMode || !session.device?.directoryHandle || !session.patchesLoaded) return;

        try {
            const text = await session.device.readFile([AUDIT_LOG_DIRECTORY, patchManifestName]);
            if (!text) return;
            const manifest = JSON.parse(text);
            const hasEnabled =
                manifest?.overrides && Object.values(manifest.overrides).some((file) => file && typeof file === 'object' && Object.values(file).some(Boolean));
            const hasCustomized = manifest?.customized && Object.keys(manifest.customized).length > 0;
            const hasAdditional = Array.isArray(manifest?.files) && manifest.files.some((f) => f?.type === 'additional-file');
            if (!hasEnabled && !hasCustomized && !hasAdditional) return;
            this.manifest = manifest;
            // The archive read is awaited *before* the banner is revealed. Reveal
            // first and a fast click reads `additionalFiles` while it is still
            // null, silently restoring nothing.
            this.additionalFiles = await this.#readAdditionalFiles(manifest);
            this.banner.hidden = false;
        } catch {}
    }

    /**
     * Forget the offer on a device reconnect.
     *
     * Belt-and-braces: `maybeOffer`'s prologue already nulls both on every entry
     * to the patches screen. Kept because the session cleared them on reconnect
     * before Phase 3, and this preserves that.
     */
    clear() {
        this.manifest = null;
        this.additionalFiles = null;
    }

    /**
     * Load the bytes of the Additional Files recorded in a manifest from the
     * companion archive, verifying its checksum first.
     *
     * `null` is the only failure signal: there is no archive, it is missing, its
     * size or checksum does not match, or it is unreadable. Nothing is logged and
     * the caller cannot tell those apart — the files simply are not restored
     * (older manifests predate the archive entirely). Turning any rung of this
     * ladder into a thrown error would reach `maybeOffer`'s catch and suppress
     * the *banner*, not just the files.
     *
     * @param {object} manifest
     * @returns {Promise<Array<{sourceName: string, destination: string, data: Uint8Array}>|null>}
     */
    async #readAdditionalFiles(manifest) {
        const archiveRef = manifest?.additionalFilesArchive;
        if (!archiveRef?.sha256) return null;
        const fileEntries = (manifest.files || []).filter((f) => f?.type === 'additional-file' && f.path);
        if (fileEntries.length === 0) return null;

        try {
            const bytes = await this.session.device.readFileBytes([AUDIT_LOG_DIRECTORY, additionalFilesArchiveName]);
            if (!bytes) return null;
            // Size before hash: cheap check first. The `typeof === 'number'` guard
            // is what lets an older manifest that recorded a sha256 but no size
            // still verify on the hash alone, and a truthy check would wrongly
            // reject a recorded `size: 0`.
            if (typeof archiveRef.size === 'number' && bytes.length !== archiveRef.size) return null;
            if ((await sha256Hex(bytes)) !== archiveRef.sha256) return null;

            const archive = await readAdditionalFilesArchive(bytes);
            const restored = [];
            // The manifest decides which files and their `sourceName`; the archive
            // is authoritative for bytes. A path the archive does not carry is
            // skipped, so a partially populated archive restores a subset — only a
            // completely unmatched one returns null.
            for (const entry of fileEntries) {
                const data = archive.get(entry.path);
                if (!data) continue;
                restored.push({
                    sourceName: entry.sourceName || entry.path.split('/').pop(),
                    destination: entry.path,
                    data,
                });
            }
            return restored.length > 0 ? restored : null;
        } catch {
            return null;
        }
    }

    /**
     * Render and open the "here is what we re-applied" modal.
     *
     * Four independent visibility decisions: the footnote always shows, the
     * modified note tracks `showModifiedNote`, and the restored-files summary and
     * the could-not-restore note are mutually exclusive by construction. The
     * notes container follows the *rendered* note rather than the flag.
     *
     * @param {object} opts
     * @param {object[]} opts.applied - re-enabled patches, in display order
     * @param {boolean} opts.showModifiedNote - the manifest carried manual edits
     * @param {number} opts.restoredCount - Additional Files actually restored
     * @param {boolean} opts.additionalFilesUnavailable - the manifest listed files but none came back
     */
    #showSummaryDialog({ applied, showModifiedNote, restoredCount, additionalFilesUnavailable }) {
        this.dialogIntro.textContent = TL.PATCH.RELOAD_SUMMARY_INTRO;

        this.dialogList.innerHTML = '';
        let anyIncompatible = false;
        for (const patch of applied) {
            const li = document.createElement('li');
            const label = document.createElement('span');
            label.textContent = getPatchMeta(patch.name).label || patch.name;
            li.appendChild(label);
            if (patch.customized) {
                const badge = document.createElement('span');
                badge.className = 'patch-reload-dialog-badge';
                badge.textContent = TL.PATCH.RELOAD_SUMMARY_CUSTOMIZED;
                li.appendChild(badge);
            }
            if (patch.incompatible) {
                const badge = document.createElement('span');
                badge.className = 'patch-reload-dialog-badge patch-reload-dialog-badge--warning';
                badge.textContent = 'Known to fail';
                li.appendChild(badge);
                anyIncompatible = true;
            }
            this.dialogList.appendChild(li);
        }

        // The compatibility status always appears; the remaining notes only show
        // for the situations they describe.
        this.dialogFootnote.textContent = anyIncompatible ? TL.PATCH.RELOAD_SUMMARY_INCOMPATIBLE : TL.PATCH.RELOAD_SUMMARY_COMPATIBLE;
        this.dialogFootnote.hidden = false;

        this.dialogModifiedNote.textContent = showModifiedNote ? TL.PATCH.RELOAD_SUMMARY_MODIFIED_NOTE : '';
        this.dialogModifiedNote.hidden = !showModifiedNote;

        // Restored Additional Files are a call to review, shown above the divider
        // directly under the re-applied patch list.
        const restoredSummary = restoredCount > 0 ? TL.PATCH.RELOAD_SUMMARY_ADDITIONAL_FILES_RESTORED(restoredCount) : '';
        this.dialogAdditionalSummary.textContent = restoredSummary;
        this.dialogAdditionalSummary.hidden = !restoredSummary;

        // When the files could not be restored (an older manifest, or a missing /
        // checksum-mismatched archive that was not trusted), a caveat sits with the
        // other notes below the divider.
        const unavailableNote = restoredCount === 0 && additionalFilesUnavailable ? TL.PATCH.RELOAD_SUMMARY_ADDITIONAL_FILES_UNAVAILABLE : '';
        this.dialogAdditionalNote.textContent = unavailableNote;
        this.dialogAdditionalNote.hidden = !unavailableNote;

        this.dialogNotes.hidden = !(applied.length > 0 || showModifiedNote || unavailableNote);

        this.dialog.showModal();
    }

    #wireListeners(signal) {
        this.btnDialogClose.addEventListener('click', () => this.dialog.close(), { signal });
        this.dialog.addEventListener(
            'click',
            (e) => {
                if (e.target === this.dialog) this.dialog.close();
            },
            { signal },
        );

        this.btnReload.addEventListener(
            'click',
            () => {
                const session = this.session;
                if (!this.manifest) return;
                this.btnReload.disabled = true;

                const summary = session.patchUI.applyReloadManifest(this.manifest);
                const restoredAdditional = this.additionalFiles?.length ? session.patchUI.addRestoredAdditionalFiles(this.additionalFiles) : 0;
                this.step.renderPatchList();
                this.step.updatePatchCount();

                // Reveal the restored files so the user can review them right away
                // (they live in the collapsed Advanced section).
                if (restoredAdditional > 0) this.step.revealAdvancedSection();

                const manifest = this.manifest;
                const hadAdditional = Array.isArray(manifest?.files) && manifest.files.some((f) => f?.type === 'additional-file');

                this.banner.classList.remove('banner--info');
                if (summary.matched === 0 && summary.edits === 0 && restoredAdditional === 0) {
                    this.banner.classList.add('banner--warning');
                    this.text.textContent = TL.PATCH.RELOAD_NONE_MATCHED;
                } else {
                    this.banner.classList.add('banner--success');
                    this.text.textContent = TL.PATCH.RELOAD_APPLIED;
                    // Only surface the summary modal when there are re-enabled patches to
                    // list; an edits-only or additional-files-only reload just updates the banner.
                    if (summary.applied.length > 0) {
                        this.#showSummaryDialog({
                            applied: summary.applied,
                            showModifiedNote: summary.edits > 0,
                            restoredCount: restoredAdditional,
                            additionalFilesUnavailable: hadAdditional && restoredAdditional === 0,
                        });
                    }
                }
                this.btnReload.hidden = true;
            },
            { signal },
        );
    }
}
