import './dom-harness.js'; // the step constructors look their elements up in the real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { ConfigStep } from '../../src/js/flows/nickelmenu/ConfigStep.js';
import { DetectedInstallation } from '../../src/js/flows/nickelmenu/DetectedInstallation.js';
import { NickelMenuSelection } from '../../src/js/flows/nickelmenu/NickelMenuSelection.js';

// `renderCleanupCheckboxes` is what the first-visit detection guard protects.
// These tests pin what running it a second time would cost, which is the reason
// the guard has to stay an emptiness check rather than becoming a boolean.
//
// Baseline: `nickelmenu-flow.js:553-582` and the guard at 646, at `e18299f`.

const CLEANUP_FEATURES = [
    { id: 'exclude-calibre', cleanup: { title: 'Calibre sync exclusion', description: 'Removes the exclusion.' } },
    { id: 'sideloaded-mode', cleanup: { title: 'Sideload Mode', removeLabel: 'Turn off Sideload Mode', description: 'Restores sign-in.' } },
];

// Steps wire listeners onto markup that outlives them, so every one built here
// is torn down when its test ends.
const built = [];
function makeStep({ manualMode = false } = {}) {
    const session = {
        manualMode,
        device: { deviceInfo: { firmware: '4.41.23145' }, directoryHandle: {} },
    };
    const owner = {
        session,
        detected: new DetectedInstallation(),
        selection: new NickelMenuSelection(),
        terminal: { end() {} },
        refreshNav() {},
        go: async () => {},
        goBack: async () => {},
        features: { showInstalledNote() {}, showPreviousConfigActions() {} },
    };
    const step = new ConfigStep(owner);
    built.push(step);
    return { step, owner, session, selection: owner.selection };
}

test.afterEach(() => {
    while (built.length) built.pop().destroy();
});

test('the preset title is captured before any probe can retitle it', () => {
    // The probe overwrites this element with "Modify current setup" when a webui
    // preset is already installed, and the flow reset puts the original back. If
    // it were read after a retitle, the install title would be lost for good.
    const { step } = makeStep();

    assert.equal(typeof step.presetTitleInstall, 'string');
    assert.ok(step.presetTitleInstall.length > 0);
    assert.notEqual(step.presetTitleInstall, 'Modify current setup (and customize)');

    step.presetTitle.textContent = 'Modify current setup (and customize)';
    step.reset();

    assert.equal(step.presetTitle.textContent, step.presetTitleInstall);
});

test('rendering the cleanup checkboxes seeds the removal list from every box', () => {
    const { step, owner, selection } = makeStep();
    owner.detected.optionalCleanupFeatures.push(...CLEANUP_FEATURES);

    step.renderCleanupCheckboxes();

    assert.deepEqual(selection.optionalCleanupIds, ['exclude-calibre', 'sideloaded-mode']);
    for (const feature of CLEANUP_FEATURES) {
        const checkbox = document.querySelector(`input[name="nm-uninstall-${feature.id}"]`);
        assert.ok(checkbox, `a checkbox should exist for ${feature.id}`);
        assert.equal(checkbox.checked, true);
    }
});

test('unchecking a box removes it from the removal list', () => {
    const { step, owner, selection } = makeStep();
    owner.detected.optionalCleanupFeatures.push(...CLEANUP_FEATURES);
    step.renderCleanupCheckboxes();

    const checkbox = document.querySelector('input[name="nm-uninstall-exclude-calibre"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new window.Event('change'));

    assert.deepEqual(selection.optionalCleanupIds, ['sideloaded-mode']);
});

test('re-rendering re-checks everything and re-seeds the removal list', () => {
    // This is the damage the first-visit guard exists to prevent. The list drives
    // what is deleted from a real device, so a silent re-check here means
    // removing files the user chose to keep. `needsOptionalCleanupDetection` is
    // what stops this from running again on back-navigation.
    const { step, owner, selection } = makeStep();
    owner.detected.optionalCleanupFeatures.push(...CLEANUP_FEATURES);
    step.renderCleanupCheckboxes();

    const checkbox = document.querySelector('input[name="nm-uninstall-exclude-calibre"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new window.Event('change'));
    assert.deepEqual(selection.optionalCleanupIds, ['sideloaded-mode']);

    step.renderCleanupCheckboxes();

    assert.deepEqual(selection.optionalCleanupIds, ['exclude-calibre', 'sideloaded-mode']);
    assert.equal(document.querySelector('input[name="nm-uninstall-exclude-calibre"]').checked, true);
    assert.equal(owner.detected.needsOptionalCleanupDetection, false, 'which is why detection must not be asked for again');
});

test('rendering with nothing detected empties the container', () => {
    const { step, owner } = makeStep();
    owner.detected.optionalCleanupFeatures.push(...CLEANUP_FEATURES);
    step.renderCleanupCheckboxes();
    assert.ok(step.uninstallOptions.innerHTML.length > 0);

    owner.detected.reset();
    step.renderCleanupCheckboxes();

    assert.equal(step.uninstallOptions.innerHTML, '');
});

test('reset clears the cleanup list and hides it', () => {
    const { step, owner } = makeStep();
    owner.detected.optionalCleanupFeatures.push(...CLEANUP_FEATURES);
    step.renderCleanupCheckboxes();
    step.uninstallOptions.hidden = false;

    step.reset();

    assert.equal(step.uninstallOptions.hidden, true);
    assert.equal(step.uninstallOptions.innerHTML, '');
});

test('entering the config step checks the preset option through a real change event', async () => {
    // The synthetic `presetRadio.dispatchEvent(new Event('change'))` in `onEnter`
    // is the *only* thing that sets `selection.option` on first arrival — the
    // radio handler does it, and `setupCardRadios` paints the selected card off
    // the same event. A "clean rewrite" that sets `checked = true` and assigns
    // the option directly leaves the card unpainted and skips `refreshNav`.
    //
    // Reachable without a device because `manualMode` short-circuits all three
    // probes: `checkNickelMenuInstalled` returns early, the previous
    // configuration reads as null and the installed feature ids as [].
    const { step, selection, owner } = makeStep({ manualMode: true });
    const navRefreshes = [];
    owner.refreshNav = () => navRefreshes.push(true);

    for (const radio of document.querySelectorAll('#step-nickelmenu input[name="nm-option"]')) {
        radio.checked = false;
        radio.closest('.selection-card')?.classList.remove('selection-card--selected');
    }
    selection.option = null;

    await step.onEnter(step.session);

    const preset = document.querySelector('#step-nickelmenu input[name="nm-option"][value="preset"]');
    assert.equal(preset.checked, true);
    assert.equal(selection.option, 'preset', 'set by the radio handler the synthetic event ran');
    assert.equal(preset.closest('.selection-card').classList.contains('selection-card--selected'), true, 'and the card was painted by setupCardRadios');
    assert.deepEqual(navRefreshes, [true], 'and the breadcrumb was refreshed');
    assert.equal(step.btnNext.disabled, false);
});

test('re-entering the config step does not re-dispatch over an existing choice', async () => {
    // The dispatch is guarded on nothing being checked yet. Back-navigation must
    // leave the user's option alone.
    const { step, selection } = makeStep({ manualMode: true });
    await step.onEnter(step.session);

    const remove = document.querySelector('#step-nickelmenu input[name="nm-option"][value="remove"]');
    remove.checked = true;
    remove.dispatchEvent(new window.Event('change'));
    assert.equal(selection.option, 'remove');

    await step.onEnter(step.session);

    assert.equal(selection.option, 'remove', 'the second entry must not reset the choice to preset');
});
