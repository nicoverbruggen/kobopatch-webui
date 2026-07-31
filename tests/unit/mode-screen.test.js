import './dom-harness.js'; // the mode screen binds its cards from the real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { ModeScreen } from '../../src/js/shell/ModeScreen.js';
import { $, $q } from '../../src/js/shell/dom.js';

// `goToModeSelection` decides whether custom patches are offered at all, and it
// is the shared re-entry point three different places come back to. The gating
// rule reads four session fields, and the "no patches" branch relies on a
// synthetic `change` event to apply the selected-card class — a direct call
// would set `checked` and silently lose the styling.

function makeScreen(sessionOverrides = {}) {
    const calls = [];
    const nav = {
        calls,
        session: {
            manualMode: false,
            patchesLoaded: true,
            firmwareURL: 'https://dl/fw.zip',
            patchesUnavailableReason: null,
            selectedMode: null,
            ...sessionOverrides,
        },
        nickelMenu: { resetNickelMenuState: () => calls.push('resetNickelMenuState') },
        goToConnectStep: () => calls.push('connect'),
        goToDeviceStep: () => calls.push('device'),
        goToNickelMenuConfig: async () => calls.push('nickelmenu'),
        enterManualVersionSelection: async () => calls.push('manualVersion'),
        goToPatches: () => calls.push('patches'),
    };
    return { screen: new ModeScreen(nav), nav };
}

function patchesRadio() {
    return $q('input[value="patches"]', $('step-mode'));
}
function nickelMenuRadio() {
    return $q('input[value="nickelmenu"]', $('step-mode'));
}

test('patches are offered when a device is connected with a firmware URL and patches loaded', () => {
    const { screen } = makeScreen();

    screen.goToModeSelection();

    assert.equal(patchesRadio().disabled, false);
    assert.equal(patchesRadio().closest('.selection-card').classList.contains('selection-card--disabled'), false);
    assert.equal(screen.patchesHint.hidden, true);
    screen.destroy();
});

// The gate is `!manualMode && (!patchesLoaded || !firmwareURL)`. Manual mode is
// exempt because the manual flow loads its own patches later.
for (const [label, overrides, expectDisabled] of [
    ['no patches loaded', { patchesLoaded: false }, true],
    ['no firmware URL', { firmwareURL: null }, true],
    ['neither', { patchesLoaded: false, firmwareURL: null }, true],
    ['manual mode with neither', { manualMode: true, patchesLoaded: false, firmwareURL: null }, false],
]) {
    test(`patches card disabled=${expectDisabled} when ${label}`, () => {
        const { screen } = makeScreen(overrides);

        screen.goToModeSelection();

        assert.equal(patchesRadio().disabled, expectDisabled);
        assert.equal(patchesRadio().closest('.selection-card').classList.contains('selection-card--disabled'), expectDisabled);
        assert.equal(screen.patchesHint.hidden, !expectDisabled);
        screen.destroy();
    });
}

test('the unavailable hint uses the session reason, falling back to the generic sentence', () => {
    const withReason = makeScreen({ patchesLoaded: false, patchesUnavailableReason: 'Because this device is odd.' });
    withReason.screen.goToModeSelection();
    assert.equal(withReason.screen.patchesHint.textContent, 'Because this device is odd.');
    withReason.screen.destroy();

    const withoutReason = makeScreen({ patchesLoaded: false });
    withoutReason.screen.goToModeSelection();
    assert.match(withoutReason.screen.patchesHint.textContent, /^Custom patches are not available for your software version\./);
    withoutReason.screen.destroy();
});

test('the auto-selected NickelMenu card gets its selected styling — the synthetic change fired', () => {
    // The branch sets `checked` and dispatches `change`. Only that event runs
    // `setupCardRadios`' handler, which is what applies the class *and* sets the
    // breadcrumb. Setting `checked` and calling the nav helper directly would
    // leave the card looking unselected, which no other assertion would catch.
    const { screen } = makeScreen({ patchesLoaded: false });

    screen.goToModeSelection();

    assert.equal(nickelMenuRadio().checked, true);
    assert.equal(
        nickelMenuRadio().closest('.selection-card').classList.contains('selection-card--selected'),
        true,
        'the card class only lands if the change event fired',
    );
    assert.equal(screen.btnNext.disabled, false, 'and the handler also enables Next');
    screen.destroy();
});

test('re-entering clears any previous choice', () => {
    const { screen } = makeScreen();

    screen.goToModeSelection();
    patchesRadio().checked = true;
    patchesRadio().dispatchEvent(new window.Event('change'));
    assert.equal(screen.btnNext.disabled, false);

    screen.goToModeSelection();

    assert.equal(patchesRadio().checked, false);
    assert.equal(nickelMenuRadio().checked, false);
    assert.equal(screen.btnNext.disabled, true, 'Next is gated again until a card is picked');
    screen.destroy();
});

test('Next dispatches to each of the three destinations', async () => {
    const nickelMenu = makeScreen();
    nickelMenu.screen.goToModeSelection();
    nickelMenuRadio().checked = true;
    await nickelMenu.screen.btnNext.onclick?.();
    nickelMenu.screen.btnNext.dispatchEvent(new window.Event('click'));
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(nickelMenu.nav.calls.includes('nickelmenu'));
    assert.equal(nickelMenu.nav.session.selectedMode, 'nickelmenu');
    nickelMenu.screen.destroy();

    // Manual mode without patches loaded routes through version selection first.
    const manual = makeScreen({ manualMode: true, patchesLoaded: false });
    manual.screen.goToModeSelection();
    patchesRadio().checked = true;
    manual.screen.btnNext.dispatchEvent(new window.Event('click'));
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(manual.nav.calls.includes('manualVersion'));
    manual.screen.destroy();

    // Patches already loaded goes straight into the flow.
    const patches = makeScreen();
    patches.screen.goToModeSelection();
    patchesRadio().checked = true;
    patches.screen.btnNext.dispatchEvent(new window.Event('click'));
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(patches.nav.calls.includes('patches'));
    patches.screen.destroy();
});

test('Next does nothing when no card is selected', async () => {
    const { screen, nav } = makeScreen();
    screen.goToModeSelection();

    screen.btnNext.dispatchEvent(new window.Event('click'));
    await new Promise((r) => setTimeout(r, 0));

    assert.deepEqual(
        nav.calls.filter((c) => c !== 'resetNickelMenuState'),
        [],
    );
    screen.destroy();
});
