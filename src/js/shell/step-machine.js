import { $ } from './dom.js';
import { setNavLabels, setNavStep } from './navigation.js';

// Steps owned by the shell (not a flow): shared parts of the wizard.
const SHELL_STEP_IDS = [
    'step-connect', 'step-connect-instructions', 'step-manual-version', 'step-device',
    'step-mode', 'step-error',
];

// Accumulated domIds registered by createFlow calls.
const flowStepIds = new Set();

function buildAllSteps() {
    const ids = [...SHELL_STEP_IDS, ...flowStepIds];
    return ids.map(id => $(id));
}

let activeFlow = null;

export function getActiveFlow() {
    return activeFlow;
}

export function deactivateFlow() {
    activeFlow = null;
}

export function createFlow({ id, steps }) {
    const history = [];
    let activeStepId = null;

    // Register this flow's step domIds for the hide-list.
    for (const step of steps) {
        flowStepIds.add(step.domId);
    }

    function findStep(stepId) {
        return steps.find(s => s.id === stepId);
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
        activeFlow = flow;

        const labels = step.navLabels;
        if (labels !== undefined) {
            setNavLabels(typeof labels === 'function' ? labels(ctx) : labels);
        }
        const index = step.navIndex;
        if (index !== undefined) {
            setNavStep(typeof index === 'function' ? index(ctx) : index);
        }

        const allSteps = buildAllSteps();
        for (const s of allSteps) {
            s.hidden = (s !== $(step.domId));
        }

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

    function canGoBack(ctx) {
        if (history.length <= 1) return false;

        const active = findStep(activeStepId);
        if (active && active.back) {
            const target = active.back(ctx);
            if (target) return true;
        }

        for (let i = history.length - 2; i >= 0; i--) {
            const prevStep = findStep(history[i]);
            if (!prevStep || !prevStep.transient) return true;
        }
        return false;
    }

    function refreshNav(ctx) {
        const active = findStep(activeStepId);
        if (!active) return;
        const labels = active.navLabels;
        if (labels !== undefined) {
            setNavLabels(typeof labels === 'function' ? labels(ctx) : labels);
        }
        const index = active.navIndex;
        if (index !== undefined) {
            setNavStep(typeof index === 'function' ? index(ctx) : index);
        }
    }

    function recoveryTarget() {
        const active = findStep(activeStepId);
        if (active && active.recoveryStep) {
            const recoveryStep = findStep(active.recoveryStep);
            return recoveryStep ? recoveryStep.domId : null;
        }
        return null;
    }

    const flow = { id, go, back, current, canGoBack, refreshNav, recoveryTarget };

    return flow;
}
