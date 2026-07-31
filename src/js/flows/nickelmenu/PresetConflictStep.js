/**
 * PresetConflictStep.js — `step-nm-preset-conflict`, the acknowledgement screen
 * shown when the device already carries an add-on the preset would clash with.
 *
 * Read-only apart from the acknowledgement checkbox, which gates Continue.
 */

import { populateList, requireButton, requireElement, requireInput } from '../../shell/dom.js';
import { TL } from '../../shell/strings.js';
import { NickelMenuStep } from './NickelMenuStep.js';

export class PresetConflictStep extends NickelMenuStep {
    /** @param {import('./NickelMenuFlow.js').NickelMenuFlow} owner */
    constructor(owner) {
        super(owner, { id: 'preset-conflict', domId: 'step-nm-preset-conflict', navIndex: 3 });

        this.btnBack = requireButton('btn-nm-preset-conflict-back');
        this.btnNext = requireButton('btn-nm-preset-conflict-next');
        this.summary = requireElement('nm-preset-conflict-summary');
        this.list = requireElement('nm-preset-conflict-list');
        this.acknowledgement = requireInput('nm-preset-conflict-ack');

        this.#wireListeners();
    }

    back(_ctx) {
        return 'config';
    }

    async onEnter(_ctx) {
        this.summary.textContent = TL.STATUS.NM_PRESET_CONFLICT;
        populateList(
            this.list,
            this.owner.detected.presetConflicts.map((c) => c.label),
        );
        this.acknowledgement.checked = false;
        this.btnNext.disabled = true;
    }

    reset() {
        this.list.innerHTML = '';
        this.acknowledgement.checked = false;
        this.btnNext.disabled = true;
    }

    #wireListeners() {
        this.btnBack.addEventListener(
            'click',
            async () => {
                await this.owner.goBack();
            },
            { signal: this.listeners.signal },
        );

        this.acknowledgement.addEventListener(
            'change',
            () => {
                this.btnNext.disabled = !this.acknowledgement.checked;
            },
            { signal: this.listeners.signal },
        );

        this.btnNext.addEventListener(
            'click',
            async () => {
                if (!this.acknowledgement.checked) return;
                await this.owner.go('features');
            },
            { signal: this.listeners.signal },
        );
    }
}
