import './dom-harness.js'; // the wizard builds every screen and flow from the real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { Wizard } from '../../src/js/Wizard.js';
import { Session } from '../../src/js/shell/session.js';
import { $ } from '../../src/js/shell/dom.js';
import { stepHistory } from '../../src/js/shell/navigation.js';

// The wizard owns every screen and flow *and* is handed to each of them. That
// cycle closes only because no constructor reads a sibling field — the rule in
// `Step`'s JSDoc. The first test is the one that matters: it is what a premature
// `this.mode.something` would break, and it is why none of those fields needs to
// be nullable.

// The stubs below are only deep enough for a *real* `Wizard` to build a *real*
// `PatchesFlow` and `NickelMenuFlow` against the harness markup. Keep it that
// way. Constructing those flows for real is what gives sixteen step and
// component classes their only constructor coverage: every one looks its
// elements up with the typed `require*` helpers, and a wrong helper — say
// `requireInput` on a `<select>` — throws at construction and takes the whole
// app down at boot. Nothing else in the unit suite builds them.
//
// So do not stub `patches`/`nickelMenu` on the wizard to make this file faster.
// It would still pass, and it would silently delete that coverage: the suite
// would stay green while the app could not start. That has already happened once
// (`ManualVersionScreen`, two `<select>`s bound with `requireInput`) and only the
// 90-second E2E gate caught it.
function makeSession() {
    return new Session({
        device: { reset: () => {}, directoryHandle: null },
        patchUI: {
            onChange: null,
            render: () => {},
            getEnabledCount: () => 0,
            getAdditionalFileCount: () => 0,
            getAdditionalFiles: () => [],
            validateAdditionalFiles: () => ({ ok: true, message: '' }),
            hasEdits: () => false,
        },
        runner: {},
        nmInstaller: {},
        getSoftwareUrl: () => null,
        softwareUrlsReady: Promise.resolve(),
        blacklistReady: Promise.resolve(),
    });
}

test('the wizard constructs without any constructor reading a sibling field', () => {
    // A screen or flow that reached `nav.mode` (or any other sibling) from its
    // own constructor would throw here, because those fields fill in one at a
    // time. This passing is what makes them non-nullable.
    const wizard = new Wizard(makeSession());

    for (const field of ['errorScreen', 'patches', 'nickelMenu', 'connect', 'connectInstructions', 'device', 'manualVersion', 'mode']) {
        assert.ok(wizard[field], `expected wizard.${field} to be assigned`);
    }
    wizard.destroy();
});

test('every screen and flow receives the wizard itself, not a copy', () => {
    const wizard = new Wizard(makeSession());

    assert.equal(wizard.mode.nav, wizard);
    assert.equal(wizard.device.nav, wizard);
    assert.equal(wizard.connect.nav, wizard);
    assert.equal(wizard.patches.nav, wizard);
    assert.equal(wizard.nickelMenu.nav, wizard);
    // Steps reach it through their flow, which is what `Step.nav` is for.
    assert.equal(wizard.patches.patches.nav, wizard);
    assert.equal(wizard.nickelMenu.config.nav, wizard);

    wizard.destroy();
});

test('start() shows the landing screen with the breadcrumb hidden', () => {
    stepHistory.length = 1;
    const wizard = new Wizard(makeSession());

    wizard.start();

    assert.equal($('step-connect').hidden, false);
    // `showStep(step-connect)` hides the breadcrumb, whatever `start` set first.
    assert.equal($('step-nav').hidden, true);
    wizard.destroy();
});

test('navigation methods forward to the screen that owns the transition', () => {
    const wizard = new Wizard(makeSession());
    const seen = [];
    wizard.mode.goToModeSelection = () => seen.push('mode');
    wizard.manualVersion.goToStep = () => seen.push('manualStep');
    wizard.device.goBack = () => seen.push('deviceBack');
    wizard.connectInstructions.show = () => seen.push('instructions');
    wizard.errorScreen.showError = () => seen.push('error');

    wizard.goToModeSelection();
    wizard.goToManualVersionStep();
    wizard.goBackToDeviceStep();
    wizard.showConnectInstructions();
    wizard.showError('m');

    assert.deepEqual(seen, ['mode', 'manualStep', 'deviceBack', 'instructions', 'error']);
    wizard.destroy();
});

test('startManualMode flips the session into manual mode and re-enters mode selection', () => {
    const wizard = new Wizard(makeSession());
    const seen = [];
    wizard.mode.goToModeSelection = () => seen.push('mode');

    wizard.startManualMode();

    assert.equal(wizard.session.manualMode, true);
    assert.deepEqual(seen, ['mode'], 'and it lands on mode selection, not somewhere else');
    wizard.destroy();
});

test('resetDeviceContext clears the session, the device screen, both flows, and the device', () => {
    // Completeness is what matters here, not order: every one of these bodies is
    // plain assignment, but missing one leaves stale device data behind.
    const wizard = new Wizard(makeSession());
    const seen = [];
    wizard.session.resetDeviceContext = () => seen.push('session');
    wizard.device.resetDeviceContext = () => seen.push('deviceScreen');
    wizard.nickelMenu.resetDeviceContext = () => seen.push('nickelMenu');
    wizard.patches.resetDeviceContext = () => seen.push('patches');
    wizard.session.device.reset = () => seen.push('device');

    wizard.resetDeviceContext();

    assert.deepEqual(seen.sort(), ['device', 'deviceScreen', 'nickelMenu', 'patches', 'session']);
    wizard.destroy();
});

// `showStep(step-connect)` hides the breadcrumb, so a `setNavStep(1)` before it
// changes nothing visible *then*. The value persists, and the next thing to
// reveal the nav — `btn-connect`'s `showNav()` — does not set a step, so what was
// written here is what the user sees one screen later.
//
// Nothing else in the repo catches this. Dropping `setNavStep(1)` from either
// Back handler passes the entire gate: 569 unit, 140 E2E, 84 screenshots.
// `manual.spec.js:407-412` already walks the broken path and asserts every
// transition without ever looking at the breadcrumb, and the screenshot suite is
// structurally blind — every shot of `step-connect-instructions` arrives from a
// fresh `start()`, so there is no differing prior value for a pixel diff to
// differ from. Asserting the *persisted* state while the nav is hidden is what
// closes it, and it needs a real wizard so the transition really runs.
function markedStep() {
    const items = [...document.querySelectorAll('#step-nav li')];
    return items.findIndex((li) => li.getAttribute('aria-current') === 'step') + 1;
}

test('mode-Back leaves the breadcrumb on step 1 for the next screen to reveal', () => {
    const wizard = new Wizard(makeSession());
    wizard.session.manualMode = true;
    wizard.mode.goToModeSelection(); // sets step 2

    wizard.mode.btnBack.dispatchEvent(new window.Event('click'));

    assert.equal($('step-nav').hidden, true, 'hidden, which is why no screenshot can see this');
    assert.equal(markedStep(), 1, 'the persisted breadcrumb must be step 1');
    wizard.destroy();
});

test('device-Back leaves the breadcrumb on step 1 for the next screen to reveal', () => {
    const wizard = new Wizard(makeSession());
    wizard.mode.goToModeSelection(); // sets step 2

    wizard.device.btnBack.dispatchEvent(new window.Event('click'));

    assert.equal($('step-nav').hidden, true);
    assert.equal(markedStep(), 1, 'the persisted breadcrumb must be step 1');
    wizard.destroy();
});

test('destroy() tears down every screen and flow', () => {
    const wizard = new Wizard(makeSession());
    const destroyed = [];
    for (const field of ['errorScreen', 'connect', 'connectInstructions', 'device', 'manualVersion', 'mode', 'patches', 'nickelMenu']) {
        wizard[field].destroy = () => destroyed.push(field);
    }

    wizard.destroy();

    assert.deepEqual(destroyed.sort(), ['connect', 'connectInstructions', 'device', 'errorScreen', 'manualVersion', 'mode', 'nickelMenu', 'patches']);
});
