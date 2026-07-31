import './dom-harness.js'; // the step constructors look their elements up in the real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { ConfigStep } from '../../src/js/flows/nickelmenu/ConfigStep.js';
import { DetectedInstallation } from '../../src/js/flows/nickelmenu/DetectedInstallation.js';
import { NickelMenuSelection } from '../../src/js/flows/nickelmenu/NickelMenuSelection.js';
import { CustomizationDialogs } from '../../src/js/flows/nickelmenu/CustomizationDialogs.js';
import { CustomizationDrafts } from '../../src/js/flows/nickelmenu/CustomizationDrafts.js';
import { createDefaultMenuCustomization } from '../../src/js/nickelmenu/customization.js';

// A step wires listeners onto markup that outlives it, so constructing one twice
// without discarding the first leaves both sets attached and a single user
// gesture runs handlers bound to two different sessions. The app builds each step
// once, so this never bites there; it bites anything that constructs a step more
// than once, which is every spec file in this directory.
//
// These tests pin `destroy()` as the way out. If they fail, any spec that builds
// a step per test is silently running stale handlers.

function makeStep(label, fired) {
    const session = {
        manualMode: false,
        device: { deviceInfo: { firmware: '4.41.23145' }, directoryHandle: {} },
        goToModeSelection() {},
    };
    const owner = {
        session,
        detected: new DetectedInstallation(),
        selection: new NickelMenuSelection(),
        terminal: { end() {} },
        refreshNav: () => fired.push(label),
        go: async () => {},
        goBack: async () => {},
        features: { showInstalledNote() {}, showPreviousConfigActions() {} },
    };
    return new ConfigStep(owner);
}

function dispatchOptionChange() {
    const radio = document.querySelector('#step-nickelmenu input[name="nm-option"][value="preset"]');
    radio.checked = true;
    radio.dispatchEvent(new window.Event('change'));
}

test('a destroyed step stops responding to its own controls', () => {
    const fired = [];
    const first = makeStep('first', fired);

    dispatchOptionChange();
    assert.deepEqual(fired, ['first']);

    first.destroy();
    fired.length = 0;
    dispatchOptionChange();

    assert.deepEqual(fired, [], 'a destroyed step must not run its handlers');
});

test('constructing a second step without destroying the first runs both', () => {
    // Documenting the hazard rather than the fix: this is what happens if a spec
    // builds a step per test and never tears one down.
    const fired = [];
    const first = makeStep('first', fired);
    const second = makeStep('second', fired);

    try {
        dispatchOptionChange();
        assert.deepEqual(fired, ['first', 'second']);
    } finally {
        first.destroy();
        second.destroy();
    }
});

test('destroying both leaves nothing attached', () => {
    const fired = [];
    const first = makeStep('first', fired);
    const second = makeStep('second', fired);
    first.destroy();
    second.destroy();

    dispatchOptionChange();

    assert.deepEqual(fired, []);
});

test('destroy also detaches the card-radio highlighting', () => {
    // `setupCardRadios` is called from the constructor too, so it has to take the
    // same signal or it leaks a listener per construction on every radio.
    const fired = [];
    const step = makeStep('only', fired);
    const label = document.querySelector('#step-nickelmenu input[name="nm-option"][value="preset"]').closest('label');

    dispatchOptionChange();
    assert.equal(label.classList.contains('selection-card--selected'), true);

    label.classList.remove('selection-card--selected');
    step.destroy();
    dispatchOptionChange();

    assert.equal(label.classList.contains('selection-card--selected'), false);
});

test('a flow-owned component stops listening when the flow scope is aborted', () => {
    // `CustomizationDialogs` is owned by `NickelMenuFlow`, not by a step, so it
    // borrows the flow's signal. Nothing chains a `destroy()` to it — aborting
    // the scope is the whole mechanism, and this is what pins that.
    const listeners = new AbortController();
    const session = {
        menuCustomization: createDefaultMenuCustomization(),
        tabsCustomization: null,
        fontsCustomization: null,
    };
    const selection = new NickelMenuSelection();
    const dialogs = new CustomizationDialogs(session, selection, new CustomizationDrafts(selection), listeners.signal);
    // The registry hands the signal down to every dialog it builds, so aborting
    // the scope has to reach a subclass's own buttons, not just the registry.
    const menu = dialogs.byType.get('menu');

    menu.dialog.open = true;
    menu.btnClose.dispatchEvent(new window.Event('click'));
    assert.equal(menu.dialog.open, false, 'the close button works while the scope is live');

    listeners.abort();

    menu.dialog.open = true;
    menu.btnClose.dispatchEvent(new window.Event('click'));
    assert.equal(menu.dialog.open, true, 'the dialog listener should have gone with the flow scope');
});
