/**
 * ReviewStep.js — `step-nm-review`, the last screen before anything is written:
 * what will be installed or removed, what is being kept, and the Write /
 * Download buttons that start the install.
 */

import { populateList, requireButton, requireElement } from '../../shell/dom.js';
import { nmReviewModel } from '../../nickelmenu/selection.js';
import { TL } from '../../shell/strings.js';
import { executeNmInstall, renderReviewNotices } from '../nickelmenu-execute.js';
import { NickelMenuStep } from './NickelMenuStep.js';

export class ReviewStep extends NickelMenuStep {
    /** @param {import('./NickelMenuFlow.js').NickelMenuFlow} owner */
    constructor(owner) {
        super(owner, { id: 'review', domId: 'step-nm-review', navIndex: 5 });

        this.root = requireElement('step-nm-review');
        this.btnBack = requireButton('btn-nm-review-back');
        this.btnWrite = requireButton('btn-nm-write');
        this.btnDownload = requireButton('btn-nm-download');
        this.summary = requireElement('nm-review-summary');
        this.listLabel = requireElement('nm-review-list-label');
        this.list = requireElement('nm-review-list');
        this.keptCard = requireElement('nm-review-kept');
        this.keptLabel = requireElement('nm-review-kept-label');
        this.keptList = requireElement('nm-review-kept-list');
        this.notices = requireElement('nm-review-notices');

        this.#wireListeners();
    }

    back(_ctx) {
        return 'backup';
    }

    async onEnter(_ctx) {
        const session = this.session;
        const model = nmReviewModel(this.owner.selection, this.owner.detected, session.device.deviceInfo);
        this.root.classList.toggle('review--removal', model.mode === 'remove');
        this.keptCard.classList.toggle('review-summary--pending-removals', model.mode !== 'remove' && model.removedFeatures.length > 0);

        if (model.mode === 'remove') {
            this.summary.textContent = TL.STATUS.NM_WILL_BE_REMOVED;
            this.summary.hidden = false;
            this.listLabel.textContent = TL.STATUS.NM_SELECTED_REMOVALS;
            populateList(this.list, [TL.STATUS.NM_REMOVAL_NICKELMENU, ...model.removedFeatures.map((f) => f.cleanup.title)]);
            populateList(
                this.keptList,
                model.keptFeatures.map((f) => f.cleanup.title),
            );
            this.keptLabel.textContent = TL.STATUS.NM_KEPT_FEATURES;
            this.keptCard.hidden = model.keptFeatures.length === 0;
            this.btnWrite.hidden = session.manualMode;
            this.btnWrite.textContent = TL.BUTTON.REMOVE_FROM_KOBO;
            this.btnDownload.hidden = true;
            renderReviewNotices(this.notices, []);
        } else {
            this.summary.hidden = true;
            this.summary.textContent = '';
            populateList(
                this.keptList,
                model.removedFeatures.map((f) => (f.modifyCleanup || f.cleanup).title),
            );
            this.keptLabel.textContent = 'These currently installed features will be removed:';
            this.keptCard.hidden = model.removedFeatures.length === 0;
            this.listLabel.textContent = TL.STATUS.NM_WILL_BE_INSTALLED;
            populateList(this.list, [TL.STATUS.NM_NICKEL_ROOT_TGZ, ...model.installFeatures.map((f) => f.title)]);
            this.btnWrite.hidden = false;
            this.btnWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
            this.btnDownload.hidden = false;
            renderReviewNotices(this.notices, model.notices);
        }

        if (session.manualMode || !session.device.directoryHandle) {
            this.btnWrite.hidden = true;
        }

        this.btnWrite.disabled = false;
        this.btnWrite.className = 'primary';
        this.btnDownload.disabled = false;
    }

    #wireListeners() {
        this.btnBack.addEventListener(
            'click',
            async () => {
                await this.owner.goBack();
            },
            { signal: this.listeners.signal },
        );

        this.btnWrite.addEventListener('click', () => this.#execute(true), { signal: this.listeners.signal });
        this.btnDownload.addEventListener('click', () => this.#execute(false), { signal: this.listeners.signal });
    }

    /**
     * Start the install. The progress elements live on `step-nm-installing`, so
     * they are read off that step rather than looked up again here.
     *
     * The two detected values are read at click time, which is when the baseline
     * built its argument object. Passing the flow's `DetectedInstallation`
     * instead would move the read inside the async function.
     *
     * @param {boolean} writeToDevice - write to the connected Kobo, or build a download
     */
    #execute(writeToDevice) {
        const installing = this.owner.installing;
        const detected = this.owner.detected;
        executeNmInstall({
            state: this.session,
            selection: this.owner.selection,
            outcome: this.owner.outcome,
            flow: this.owner.flow,
            previousConfiguration: detected.previousConfiguration,
            installedFeatureIds: detected.installedFeatureIds,
            optionalCleanupFeatures: detected.optionalCleanupFeatures,
            legacyItemsDetected: detected.legacyItemsDetected,
            dom: {
                progress: installing.progress,
                progressDetail: installing.progressDetail,
                writeToDevice,
            },
            showError: (...args) => this.nav.showError(...args),
        });
    }
}
