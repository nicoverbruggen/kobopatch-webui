/**
 * StepMachine.js — Generic wizard step/flow navigation primitives.
 *
 * `createFlow` builds a linear, history-aware sequence of steps; the active flow
 * is tracked here so shared chrome (back button, error recovery) can drive it.
 */

import { $ } from './DOM.js';
import { hideAllStepsExcept, setNavLabels, setNavStep } from './Navigation.js';

/**
 * Apply a step's breadcrumb labels and index, if it declares them.
 *
 * `navLabels`/`navIndex` may be a plain value, a constructor-assigned function,
 * or a **prototype method** — the read and the call are one expression, so `this`
 * binds and all three forms work. They used to be read into a local and called
 * detached, which crashed for a prototype method: a rule ("assign these as
 * constructor fields") that failed silently when forgotten, and one TypeScript
 * cannot check.
 *
 * The `!== undefined` guard is load-bearing and stays. A step that declares
 * neither — `patches/BuildingStep`, the transient build screen — leaves the
 * breadcrumb exactly as the previous step set it, for the whole build. Giving
 * either field a default here would reset it mid-build, and no screenshot would
 * catch that: the building screen's own shot looks right, and the wrong value
 * only appears on the step after.
 *
 * One deliberate difference from the old form: a *function* that returns
 * `undefined` now skips the call instead of passing `undefined` through. Nothing
 * does — `nickelMenuNavLabels` always returns a `TL.*` array and the patches
 * steps use plain values — but it is a change, not a no-op.
 *
 * @param {object} step
 * @param {object} ctx - the session the flow was navigated with
 */
function applyNav(step, ctx) {
    const labels = typeof step.navLabels === 'function' ? step.navLabels(ctx) : step.navLabels;
    if (labels !== undefined) setNavLabels(labels);

    const index = typeof step.navIndex === 'function' ? step.navIndex(ctx) : step.navIndex;
    if (index !== undefined) setNavStep(index);
}

/**
 * Build a linear, history-aware sequence of steps.
 *
 * @param {object} config
 * @param {string} config.id
 * @param {object[]} config.steps
 * @param {(flow: object) => void} [config.onActivate] - called from `go()` with
 *   this flow, every time it navigates. The wizard uses it to track which flow
 *   is active, which the error screen reads to pick a recovery target.
 *
 *   It is a callback rather than something the caller sets after navigating
 *   because "set it on every navigation" is what the old module-global did, and
 *   not every navigation goes through the flow classes' own `go()` wrappers:
 *   `PatchesFlow.goToPatches`/`goToBuild` and all four `flow.go` calls inside
 *   `executeNmInstall` reach this function directly. Hooking here cannot be
 *   bypassed; asking six call sites to remember is a rule that fails silently.
 */
export function createFlow({ id, steps, onActivate }) {
    const history = [];
    let activeStepId = null;

    function findStep(stepId) {
        return steps.find((s) => s.id === stepId);
    }

    async function go(stepId, ctx, options = {}) {
        const step = findStep(stepId);
        if (!step) throw new Error(`Step "${stepId}" not found in flow "${id}"`);

        if (!step.transient && !options.skipHistory) {
            const existingIdx = history.indexOf(stepId);
            if (existingIdx >= 0) {
                history.length = existingIdx + 1;
            } else {
                history.push(stepId);
            }
        }

        activeStepId = stepId;
        onActivate?.(flow);

        applyNav(step, ctx);

        // `navigation.js` owns the set of step elements; this hides without
        // focusing, so `onEnter` still runs before focus moves.
        hideAllStepsExcept($(step.domId));

        if (step.onEnter && !options.skipOnEnter) {
            await step.onEnter(ctx);
        }

        const visibleEl = $(step.domId);
        visibleEl.setAttribute('tabindex', '-1');
        visibleEl.focus({ preventScroll: true });
    }

    function back(ctx) {
        if (history.length <= 1) return null;

        const active = findStep(activeStepId);
        if (active && active.back) {
            const target = active.back(ctx);
            if (target) return target;
        }

        history.pop();
        while (history.length > 0) {
            const prevId = history[history.length - 1];
            const prevStep = findStep(prevId);
            if (!prevStep || !prevStep.transient) break;
            history.pop();
        }

        if (history.length === 0) return null;
        return history[history.length - 1];
    }

    function current() {
        return activeStepId;
    }

    function refreshNav(ctx) {
        const active = findStep(activeStepId);
        if (!active) return;
        applyNav(active, ctx);
    }

    function recoveryTarget() {
        const active = findStep(activeStepId);
        if (active && active.recoveryStep) {
            const recoveryStep = findStep(active.recoveryStep);
            return recoveryStep ? recoveryStep.domId : null;
        }
        return null;
    }

    const flow = { id, go, back, current, refreshNav, recoveryTarget };

    return flow;
}
