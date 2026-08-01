/**
 * PatchesStep.js — `step-patches`, where the user picks which patches to apply
 * and attaches any Additional Files.
 *
 * Owns the patch list container, the count hint, the Advanced section and its
 * file picker, and the two navigation buttons. The reload offer and the
 * Additional Files table are cohesive enough to have their own classes; this
 * step constructs both and is the only thing that talks to them.
 */

import { requireButton, requireElement, requireInput } from '../../shell/DOM.js';
import { TL } from '../../shell/Strings.js';
import { openBlacklistDialog } from '../../patches/PatchListView.js';
import { Step } from '../Step.js';
import { AdditionalFilesList } from './AdditionalFilesList.js';
import { ReloadBanner } from './ReloadBanner.js';

export class PatchesStep extends Step {
    /** @param {import('./PatchesFlow.js').PatchesFlow} owner */
    constructor(owner) {
        super(owner, { id: 'patches', domId: 'step-patches', navLabels: TL.NAV_PATCHES, navIndex: 3, recoveryStep: 'patches' });

        this.patchContainer = requireElement('patch-container');
        this.advancedSection = requireElement('patch-advanced-section');
        this.countHint = requireElement('patch-count-hint');
        this.additionalFilesError = requireElement('patch-additional-files-error');
        this.btnBlacklist = requireButton('btn-patch-blacklist');
        this.originalFormat = requireInput('patch-original-format');
        this.btnAddFiles = requireButton('btn-patch-additional-files');
        this.fileInput = requireInput('patch-additional-file-input');
        this.btnBack = requireButton('btn-patches-back');
        this.btnNext = requireButton('btn-patches-next');

        this.additionalFiles = new AdditionalFilesList(this.session);
        this.reloadBanner = new ReloadBanner(this, this.listeners.signal);

        this.#wireListeners();
    }

    async onEnter(_ctx) {
        // Deliberately not awaited: the step becomes visible and focusable while
        // the manifest read is still in flight, and the banner appears later if it
        // appears at all.
        void this.reloadBanner.maybeOffer();
    }

    /** Re-render the patch list into this screen's container. */
    renderPatchList() {
        this.session.patchUI.render(this.patchContainer);
    }

    /** Open the collapsed Advanced section, where Additional Files live. */
    revealAdvancedSection() {
        this.advancedSection.open = true;
    }

    /**
     * Refresh everything that depends on the current selection: the Next button's
     * enabled state, the Additional Files table and its validation error, and the
     * four-way count hint.
     *
     * Wired to `patchUI.onChange`, so it runs on every selection change. The
     * table is re-rendered *before* the error text is set — the other order would
     * re-render over the message that was just written.
     */
    updatePatchCount() {
        const patchUI = this.session.patchUI;
        const count = patchUI.getEnabledCount();
        const additionalCount = patchUI.getAdditionalFileCount();
        const additionalValidation = patchUI.validateAdditionalFiles();
        this.btnNext.disabled = !additionalValidation.ok;
        this.additionalFiles.render();
        this.additionalFilesError.hidden = additionalValidation.ok;
        this.additionalFilesError.textContent = additionalValidation.message;
        if (!additionalValidation.ok) this.revealAdvancedSection();

        if (count === 0 && additionalCount === 0) {
            this.countHint.textContent = TL.STATUS.PATCH_COUNT_ZERO;
        } else if (count === 0) {
            this.countHint.textContent = additionalCount === 1 ? TL.STATUS.PATCH_EXTRA_FILE_COUNT_ONE : TL.STATUS.PATCH_EXTRA_FILE_COUNT_MULTI(additionalCount);
        } else if (additionalCount === 0) {
            this.countHint.textContent = count === 1 ? TL.STATUS.PATCH_COUNT_ONE : TL.STATUS.PATCH_COUNT_MULTI(count);
        } else {
            this.countHint.textContent = TL.STATUS.PATCH_AND_EXTRA_FILE_COUNT(count, additionalCount);
        }
    }

    #wireListeners() {
        const { signal } = this.listeners;

        this.btnBack.addEventListener(
            'click',
            () => {
                if (this.session.patchUI.hasEdits() && !window.confirm(TL.PATCH.DISCARD_EDITS_CONFIRM)) {
                    return;
                }
                if (this.session.manualMode) {
                    this.nav.goToManualVersionStep();
                } else {
                    this.nav.goToModeSelection();
                }
            },
            { signal },
        );

        this.btnNext.addEventListener(
            'click',
            () => {
                const patchUI = this.session.patchUI;
                if (!patchUI.validateAdditionalFiles().ok) return;
                // Additional files alone are not a restore.
                this.session.isRestore = patchUI.getEnabledCount() === 0 && !patchUI.hasAdditionalFiles();
                this.owner.go('firmware', { skipHistory: true });
            },
            { signal },
        );

        this.btnBlacklist.addEventListener('click', () => openBlacklistDialog(this.session.patchUI, this.patchContainer), { signal });

        // Toggle between the themed metadata view and the original kobopatch/MobileRead
        // format (grouped by source file, raw YAML titles). The preference lives on the
        // patch container so renderPatchList/updatePatchCounts read it across re-renders.
        this.originalFormat.addEventListener(
            'change',
            () => {
                this.patchContainer.dataset.originalFormat = this.originalFormat.checked ? 'true' : 'false';
                this.renderPatchList();
            },
            { signal },
        );

        this.btnAddFiles.addEventListener('click', () => this.fileInput.click(), { signal });

        this.fileInput.addEventListener(
            'change',
            () => {
                this.session.patchUI.addAdditionalFiles(Array.from(this.fileInput.files || []));
                // Cleared so re-picking the same file fires `change` again.
                this.fileInput.value = '';
                this.revealAdvancedSection();
                this.additionalFiles.render();
                this.updatePatchCount();
            },
            { signal },
        );
    }
}
