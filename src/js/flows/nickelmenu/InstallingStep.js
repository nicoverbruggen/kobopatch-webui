/**
 * InstallingStep.js — `step-nm-installing`, the transient progress screen shown
 * while the install runs.
 *
 * It has no `onEnter` of its own: the install code drives the two progress
 * elements directly, and the review step hands them over when it starts a run.
 * An error recovers to the review step.
 */

import { requireElement } from '../../shell/dom.js';
import { NickelMenuStep } from './NickelMenuStep.js';

export class InstallingStep extends NickelMenuStep {
    /** @param {import('./NickelMenuFlow.js').NickelMenuFlow} owner */
    constructor(owner) {
        super(owner, { id: 'installing', domId: 'step-nm-installing', navIndex: 5, transient: true, recoveryStep: 'review' });

        this.progress = requireElement('nm-progress');
        this.progressDetail = requireElement('nm-progress-detail');
    }
}
