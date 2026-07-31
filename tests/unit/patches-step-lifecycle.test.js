import './dom-harness.js'; // the step constructors look their elements up in the real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { PatchesStep } from '../../src/js/flows/patches/PatchesStep.js';

// The patches flow's counterpart to `nm-step-lifecycle.test.js`. A step wires
// listeners onto markup that outlives it, so constructing one twice without
// destroying the first leaves both sets attached and one gesture runs handlers
// bound to two different sessions. `destroy()` is what makes that recoverable —
// it does not make construction idempotent, and the second test pins that
// distinction rather than hiding it.
//
// `PatchesStep` additionally owns a `ReloadBanner`, which has its own controller.
// Forgetting to chain it is the specific mistake this file exists to catch.

function makeStep() {
    const opened = [];
    const session = {
        manualMode: false,
        patchUI: {
            hasEdits: () => false,
            render: () => {},
            getAdditionalFiles: () => [],
        },
    };
    const nav = {
        goToModeSelection: () => opened.push('mode'),
        goToManualVersionStep: () => opened.push('manual'),
    };
    const owner = { session, nav, go: () => {}, goBack: async () => {} };
    return { step: new PatchesStep(owner), session, opened };
}

test('a destroyed step stops responding to its own controls', () => {
    const { step, opened } = makeStep();

    step.btnBack.dispatchEvent(new window.Event('click'));
    assert.deepEqual(opened, ['mode']);

    step.destroy();
    step.btnBack.dispatchEvent(new window.Event('click'));
    assert.deepEqual(opened, ['mode'], 'no further handler should run');
});

test('two live steps both respond — destroy is what closes the hole, not construction', () => {
    // Deliberately asserting the hazard rather than pretending it is gone.
    const first = makeStep();
    const second = makeStep();

    first.step.btnBack.dispatchEvent(new window.Event('click'));
    assert.deepEqual(first.opened, ['mode']);
    assert.deepEqual(second.opened, ['mode'], 'the second step is wired to the same button');

    first.step.destroy();
    second.step.destroy();
    first.step.btnBack.dispatchEvent(new window.Event('click'));
    assert.deepEqual(first.opened, ['mode']);
    assert.deepEqual(second.opened, ['mode']);
});

test('destroying the step also detaches the reload banner it owns', () => {
    // `ReloadBanner` carries its own AbortController, so `PatchesStep.destroy`
    // has to chain to it. Without that, the banner's dialog and reload listeners
    // survive every teardown.
    const { step, session } = makeStep();
    session.reloadManifest = null;

    const banner = step.reloadBanner;
    banner.dialog.open = true;
    banner.btnDialogClose.dispatchEvent(new window.Event('click'));
    assert.equal(banner.dialog.open, false, 'the close button works while the step is live');

    step.destroy();

    banner.dialog.open = true;
    banner.btnDialogClose.dispatchEvent(new window.Event('click'));
    assert.equal(banner.dialog.open, true, 'the banner listener should have gone with the step');
});
