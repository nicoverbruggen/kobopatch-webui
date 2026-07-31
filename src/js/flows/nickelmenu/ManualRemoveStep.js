/**
 * ManualRemoveStep.js — `step-nm-manual-remove`, the printed instructions shown
 * when the user picks "remove" in manual mode.
 *
 * Static markup: no elements to bind, no entry behavior. It exists as a class so
 * the flow's step list is uniform and the screen has an obvious home.
 */

import { NickelMenuStep } from './NickelMenuStep.js';

export class ManualRemoveStep extends NickelMenuStep {
    /** @param {import('./NickelMenuFlow.js').NickelMenuFlow} owner */
    constructor(owner) {
        super(owner, { id: 'manual-remove', domId: 'step-nm-manual-remove', navIndex: 4 });
    }
}
