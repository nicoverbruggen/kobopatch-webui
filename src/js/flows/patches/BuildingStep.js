/**
 * BuildingStep.js — `step-building`, the transient progress screen shown while
 * the firmware downloads and the patcher runs.
 *
 * It has no `onEnter`: the build driver on the firmware step writes these three
 * elements directly as it goes, and the done step reads the finished log off
 * them. An error here recovers to the patches step.
 *
 * Deliberately carries no `navLabels` and no `navIndex` — the baseline step
 * descriptor had neither, and the step machine only touches the breadcrumb when
 * they are defined, so a transient screen leaves it alone.
 */

import { requireElement } from '../../shell/dom.js';
import { Step } from '../Step.js';

export class BuildingStep extends Step {
    /** @param {import('./PatchesFlow.js').PatchesFlow} owner */
    constructor(owner) {
        super(owner, { id: 'building', domId: 'step-building', transient: true, recoveryStep: 'patches' });

        this.progress = requireElement('build-progress');
        this.log = requireElement('build-log');
        this.waitHint = requireElement('build-wait-hint');
    }
}
