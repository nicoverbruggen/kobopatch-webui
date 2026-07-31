/**
 * DoneStep.js — `step-nm-done`, the result screen for all three outcomes:
 * removed, written to the device, or packaged for manual installation.
 *
 * The copy and the download side effects are `nickelmenu-execute.js`'s
 * `renderNmDoneStatus`; this step owns the elements it writes into.
 */

import { requireElement } from '../../shell/dom.js';
import { renderNmDoneStatus } from '../nickelmenu-execute.js';
import { NickelMenuStep } from './NickelMenuStep.js';

export class DoneStep extends NickelMenuStep {
    /** @param {import('./NickelMenuFlow.js').NickelMenuFlow} owner */
    constructor(owner) {
        super(owner, { id: 'done', domId: 'step-nm-done', navIndex: 6 });

        this.doneStatus = requireElement('nm-done-status');
        this.writeInstructions = requireElement('nm-write-instructions');
        this.downloadInstructions = requireElement('nm-download-instructions');
        this.rebootInstructions = requireElement('nm-reboot-instructions');
        this.downloadConfStep = requireElement('nm-download-conf-step');
        this.downloadRebootStep = requireElement('nm-download-reboot-step');
        this.downloadConfLine = requireElement('nm-download-conf-line');
        this.downloadConfDesc = requireElement('nm-download-conf-desc');
        this.downloadConfSettings = requireElement('nm-download-conf-settings');
        this.downloadConfSettingsStep = requireElement('nm-download-conf-settings-step');
    }

    async onEnter(_ctx) {
        renderNmDoneStatus(this.session, this.owner.selection, this.owner.outcome, this.owner.terminal, {
            doneStatus: this.doneStatus,
            writeInstructions: this.writeInstructions,
            downloadInstructions: this.downloadInstructions,
            rebootInstructions: this.rebootInstructions,
            downloadConfStep: this.downloadConfStep,
            downloadRebootStep: this.downloadRebootStep,
            downloadConfLine: this.downloadConfLine,
            downloadConfDesc: this.downloadConfDesc,
            downloadConfSettings: this.downloadConfSettings,
            downloadConfSettingsStep: this.downloadConfSettingsStep,
        });
    }
}
