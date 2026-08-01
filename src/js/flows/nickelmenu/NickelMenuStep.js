/**
 * NickelMenuStep.js — The NickelMenu flow's shared step base.
 *
 * Every screen in this flow carries the same breadcrumb rule, so it lives here
 * once instead of on each step.
 */

import { Step } from '../Step.js';
import { TL } from '../../shell/Strings.js';

/**
 * Breadcrumb labels for every NickelMenu screen; the remove path has its own set,
 * and manual mode has a third.
 *
 * Takes plain values rather than an object so it stays a pure function of the two
 * things it actually depends on. Since Phase 3 those two live in different
 * places: the option is the user's NickelMenu selection, while manual mode is a
 * wizard-wide flag that is still on the session.
 *
 * @param {'preset'|'remove'|null} option - the NickelMenu option the user chose
 * @param {boolean} manualMode - the wizard is running without a connected device
 * @returns {string[]}
 */
export function nickelMenuNavLabels(option, manualMode) {
    if (option === 'remove' && manualMode) return TL.NAV_NICKELMENU_MANUAL_REMOVE;
    if (option === 'remove') return TL.NAV_NICKELMENU_REMOVE;
    return TL.NAV_NICKELMENU;
}

/** A NickelMenu wizard screen: a Step carrying the flow's shared breadcrumb rule. */
export class NickelMenuStep extends Step {
    /**
     * `navLabels` is a closure over the owning flow. A prototype method would
     * work too since Phase 6 — the step machine reads and calls in one
     * expression, so `this` binds — but this form is kept because it reads
     * `owner.selection` when it runs rather than when it is created, which is
     * what lets a step be built before the selection it will describe.
     *
     * @param {object} owner - the NickelMenuFlow that constructed this step
     * @param {object} config - as `Step`, minus `navLabels`
     */
    constructor(owner, config) {
        super(owner, { ...config, navLabels: (ctx) => nickelMenuNavLabels(owner.selection.option, ctx.manualMode) });
    }
}
