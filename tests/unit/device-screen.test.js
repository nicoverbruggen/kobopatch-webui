import './dom-harness.js'; // the device screen binds its rows from the real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { DeviceScreen } from '../../src/js/shell/DeviceScreen.js';
import { $q } from '../../src/js/shell/dom.js';
import { TL } from '../../src/js/shell/strings.js';

// Driven through `connectAndShow()` rather than by poking the private renderers,
// so these assert what a user ends up looking at. The serial masking in
// particular is a privacy behaviour: the screen shows a device's full serial only
// after a deliberate click.

const BASE_INFO = {
    model: 'Kobo Clara HD',
    serial: 'N249012345678',
    serialPrefix: 'N24901',
    rawSerialPrefix: 'N24901',
    firmware: '4.45.23646',
    hardwareId: 'abcdef',
    uiLocale: 'en',
    channel: 'kobo9',
    deviceVerification: 'verified',
    serialPrefixStatus: 'verified',
    isRefurbished: false,
    isIncompatible: false,
};

function makeScreen({ info = {}, manifestBytes = null, patches = {} } = {}) {
    const calls = [];
    const nav = {
        calls,
        session: {
            patchesLoaded: false,
            firmwareURL: 'https://dl/fw.zip',
            availablePatches: [],
            softwareUrlsReady: Promise.resolve(),
            availablePatchesReady: Promise.resolve(),
            patchUI: { loadFromURL: async () => {} },
            device: {
                directoryHandle: {},
                connect: async () => ({ ...BASE_INFO, ...info }),
                readFile: async () => manifestBytes,
                reset: () => {},
            },
        },
        patches: {
            configureFirmwareStep: () => calls.push('configureFirmwareStep'),
            updatePatchCount: () => calls.push('updatePatchCount'),
            renderPatchList: () => calls.push('renderPatchList'),
            ...patches,
        },
        showError: (...args) => calls.push({ showError: args }),
        goToModeSelection: () => calls.push('mode'),
        goToConnectStep: () => calls.push('connect'),
        goToBuild: () => calls.push('build'),
        resetDeviceContext: () => calls.push('resetDeviceContext'),
    };
    return { screen: new DeviceScreen(nav), nav };
}

test('the serial is masked until revealed, and the prefix stays readable', async () => {
    const { screen } = makeScreen();

    await screen.connectAndShow();

    const prefix = $q('u', screen.serial);
    const rest = $q('.serial-rest', screen.serial);
    const toggle = $q('.serial-reveal', screen.serial);

    assert.equal(prefix.textContent, 'N24901', 'the prefix identifies the model and is not secret');
    assert.equal(rest.textContent, '•••••••', 'the rest is masked to its own length');
    assert.equal(rest.textContent.length, 'N249012345678'.length - 'N24901'.length);
    assert.equal(toggle.textContent, 'Reveal');
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');

    toggle.dispatchEvent(new window.Event('click'));

    assert.equal(rest.textContent, '2345678');
    assert.equal(toggle.textContent, 'Hide');
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    screen.destroy();
});

test('a refurbished device is marked, and the verification badge reflects the status', async () => {
    const { screen } = makeScreen({ info: { isRefurbished: true, serialPrefixStatus: 'refurbished' } });

    await screen.connectAndShow();

    assert.equal($q('.device-refurbished-marker', screen.model).textContent, '(refurb.)');
    const badge = $q('.device-identification-badge', screen.model);
    assert.ok(badge.classList.contains('device-identification-badge--refurbished'));
    assert.match(badge.getAttribute('aria-label'), /refurbished-device form/);
    screen.destroy();
});

test('a mismatched device explains why patches are off and still allows continuing', async () => {
    const { screen } = makeScreen({ info: { deviceVerification: 'mismatch', serialPrefixStatus: 'mismatch' } });

    await screen.connectAndShow();

    assert.match(screen.status.textContent, /hardware UUID and serial prefix do not match/);
    assert.ok(screen.status.classList.contains('banner--warning'));
    assert.equal(screen.btnNext.disabled, false);
    assert.equal(screen.unknownWarning.hidden, true);
    screen.destroy();
});

test('an unknown device gates Next behind the acknowledgement checkbox', async () => {
    const { screen } = makeScreen({ info: { deviceVerification: 'unknown', serialPrefixStatus: 'unknown' } });

    await screen.connectAndShow();

    assert.equal(screen.unknownWarning.hidden, false);
    assert.equal(screen.unknownAck.hidden, false);
    assert.equal(screen.unknownCheckbox.checked, false);
    assert.equal(screen.btnNext.disabled, true);

    screen.unknownCheckbox.checked = true;
    screen.unknownCheckbox.dispatchEvent(new window.Event('change'));
    assert.equal(screen.btnNext.disabled, false);
    screen.destroy();
});

test('a recognised device says so and enables Next', async () => {
    const { screen } = makeScreen();

    await screen.connectAndShow();

    assert.equal(screen.status.textContent, TL.STATUS.DEVICE_RECOGNIZED);
    assert.equal(screen.btnNext.disabled, false);
    assert.equal(screen.btnNext.hidden, false);
    screen.destroy();
});

test('an incompatible device hides both Next and Restore', async () => {
    const { screen } = makeScreen({ info: { isIncompatible: true } });

    await screen.connectAndShow();

    assert.equal(screen.btnNext.hidden, true);
    assert.equal(screen.btnRestore.hidden, true);
    assert.ok(screen.status.classList.contains('banner--error'));
    screen.destroy();
});

test('the restore shortcut appears only when the device carries a patches manifest', async () => {
    // It needs patches loaded, a firmware URL, *and* a manifest on the device.
    const without = makeScreen();
    await without.screen.connectAndShow();
    assert.equal(without.screen.hasCustomPatchesManifest, false);
    assert.equal(without.screen.btnRestore.hidden, true);
    without.screen.destroy();

    const withManifest = makeScreen({ manifestBytes: '{"files":[]}' });
    withManifest.nav.session.patchesLoaded = true;
    await withManifest.screen.connectAndShow();
    assert.equal(withManifest.screen.hasCustomPatchesManifest, true);
    assert.equal(withManifest.screen.btnRestore.hidden, false);

    withManifest.screen.btnRestore.dispatchEvent(new window.Event('click'));
    assert.ok(withManifest.nav.calls.includes('build'));
    assert.equal(withManifest.nav.session.isRestore, true);
    assert.equal(withManifest.nav.session.selectedMode, 'patches');
    withManifest.screen.destroy();
});

test('resetDeviceContext drops the manifest flag so the shortcut cannot fire for the next device', async () => {
    const { screen, nav } = makeScreen({ manifestBytes: '{"files":[]}' });
    nav.session.patchesLoaded = true;
    await screen.connectAndShow();
    assert.equal(screen.hasCustomPatchesManifest, true);

    screen.resetDeviceContext();

    assert.equal(screen.hasCustomPatchesManifest, false, 'this gated the restore button and used to be cleared by Session.resetDeviceContext');
    screen.destroy();
});

test('a declined permission prompt is reported as expected, and an abort is silent', async () => {
    const aborted = makeScreen();
    aborted.nav.session.device.connect = async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
    };
    await aborted.screen.connectAndShow();
    assert.deepEqual(aborted.nav.calls, [], 'closing the picker shows nothing at all');
    aborted.screen.destroy();

    const denied = makeScreen();
    denied.nav.session.device.connect = async () => {
        const err = new Error('denied');
        err.name = 'NotAllowedError';
        throw err;
    };
    await denied.screen.connectAndShow();
    const [reported] = denied.nav.calls;
    assert.equal(reported.showError[0], TL.ERROR.PERMISSION_DENIED_MESSAGE);
    assert.equal(reported.showError[2].expected, true, 'a declined prompt is a normal outcome, not a defect to report');
    denied.screen.destroy();
});

test('an unreadable manifest is treated as absent rather than failing the connection', async () => {
    const { screen, nav } = makeScreen();
    nav.session.patchesLoaded = true;
    nav.session.device.readFile = async () => {
        throw new Error('permission lost');
    };

    await screen.connectAndShow();

    assert.equal(screen.hasCustomPatchesManifest, false);
    assert.equal(screen.btnRestore.hidden, true);
    assert.equal(screen.status.textContent, TL.STATUS.DEVICE_RECOGNIZED, 'the connection still succeeded');
    screen.destroy();
});
