import './dom-harness.js'; // every shell screen binds its elements from the real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { ConnectScreen } from '../../src/js/shell/ConnectScreen.js';
import { ConnectInstructionsScreen } from '../../src/js/shell/ConnectInstructionsScreen.js';
import { DeviceScreen } from '../../src/js/shell/DeviceScreen.js';
import { ManualVersionScreen } from '../../src/js/shell/ManualVersionScreen.js';
import { ModeScreen } from '../../src/js/shell/ModeScreen.js';

// The shell counterpart to `nm-step-lifecycle.test.js`. Two jobs:
//
// 1. **Constructing each screen at all.** Every screen looks its elements up
//    with the typed `require*` helpers, which assert the tag. A wrong helper is
//    an exception at construction — the whole app fails to boot — and no unit
//    test noticed, because until this file nothing constructed a shell screen.
//    `ManualVersionScreen` shipped `requireInput` on two `<select>`s and the unit
//    suite stayed green while the app was dead. That is what this catches.
// 2. **`destroy()` detaching the listeners.** The markup outlives the screen, so
//    a second instance without a teardown leaves both sets attached and one
//    gesture runs handlers bound to two different wizards.

function makeNav() {
    const calls = [];
    const record =
        (name) =>
        (...args) => {
            calls.push({ name, args });
        };
    return {
        calls,
        session: {
            manualMode: false,
            patchesLoaded: false,
            firmwareURL: null,
            patchesUnavailableReason: null,
            selectedChannel: null,
            availablePatches: [],
            softwareUrlsReady: Promise.resolve(),
            availablePatchesReady: Promise.resolve(),
            blacklistReady: Promise.resolve(),
            patchUI: { loadFromURL: async () => {}, render: () => {} },
            device: { reset: () => {} },
        },
        patches: {
            renderPatchList: record('renderPatchList'),
            updatePatchCount: record('updatePatchCount'),
            configureFirmwareStep: record('configureFirmwareStep'),
        },
        nickelMenu: { resetNickelMenuState: record('resetNickelMenuState') },
        showError: record('showError'),
        goToModeSelection: record('goToModeSelection'),
        goToConnectStep: record('goToConnectStep'),
        goToDeviceStep: record('goToDeviceStep'),
        goBackToDeviceStep: record('goBackToDeviceStep'),
        showConnectInstructions: record('showConnectInstructions'),
        connectDevice: record('connectDevice'),
        startManualMode: record('startManualMode'),
        enterManualVersionSelection: record('enterManualVersionSelection'),
        goToPatches: record('goToPatches'),
        goToBuild: record('goToBuild'),
        goToNickelMenuConfig: record('goToNickelMenuConfig'),
        resetDeviceContext: record('resetDeviceContext'),
    };
}

const SCREENS = [
    ['ConnectScreen', ConnectScreen, (s) => s.btnManual, 'startManualMode'],
    ['ConnectInstructionsScreen', ConnectInstructionsScreen, (s) => s.btnBack, 'goToConnectStep'],
    ['DeviceScreen', DeviceScreen, (s) => s.btnNext, 'goToModeSelection'],
    ['ManualVersionScreen', ManualVersionScreen, (s) => s.btnBack, 'goToModeSelection'],
    ['ModeScreen', ModeScreen, (s) => s.btnBack, null], // back branches on manualMode; asserted separately
];

for (const [name, Screen] of SCREENS) {
    test(`${name} constructs against the real markup`, () => {
        // A wrong `require*` helper throws here rather than at app boot.
        const screen = new Screen(makeNav());
        assert.ok(screen.root, 'the screen resolved its own step element');
        screen.destroy();
    });
}

for (const [name, Screen, control, expected] of SCREENS) {
    if (!expected) continue;
    test(`a destroyed ${name} stops responding to its own controls`, () => {
        const nav = makeNav();
        const screen = new Screen(nav);

        control(screen).dispatchEvent(new window.Event('click'));
        assert.deepEqual(
            nav.calls.map((c) => c.name),
            [expected],
        );

        screen.destroy();
        control(screen).dispatchEvent(new window.Event('click'));
        assert.deepEqual(
            nav.calls.map((c) => c.name),
            [expected],
            'no further handler should run',
        );
    });
}

test('ModeScreen Back goes to the device screen when a device is connected, connect in manual mode', () => {
    const nav = makeNav();
    const screen = new ModeScreen(nav);

    screen.btnBack.dispatchEvent(new window.Event('click'));
    assert.deepEqual(
        nav.calls.map((c) => c.name),
        ['goToDeviceStep'],
    );

    nav.session.manualMode = true;
    screen.btnBack.dispatchEvent(new window.Event('click'));
    assert.deepEqual(
        nav.calls.map((c) => c.name),
        ['goToDeviceStep', 'goToConnectStep'],
    );

    screen.destroy();
});

test('two live screens both respond — destroy is what closes the hole, not construction', () => {
    // Deliberately asserting the hazard rather than pretending it is gone.
    const first = makeNav();
    const second = makeNav();
    const a = new ConnectInstructionsScreen(first);
    const b = new ConnectInstructionsScreen(second);

    a.btnBack.dispatchEvent(new window.Event('click'));
    assert.equal(first.calls.length, 1);
    assert.equal(second.calls.length, 1, 'the second screen is wired to the same button');

    a.destroy();
    b.destroy();
    a.btnBack.dispatchEvent(new window.Event('click'));
    assert.equal(first.calls.length, 1);
    assert.equal(second.calls.length, 1);
});
