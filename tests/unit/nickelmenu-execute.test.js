import './dom-harness.js'; // renderNmDoneStatus writes into real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { executeNmInstall, renderNmDoneStatus } from '../../src/js/flows/nickelmenu-execute.js';
import { RecordingDevice, createInstaller, useCustomMenuAssetFetch } from './test-helpers.js';
import { TL } from '../../src/js/shell/strings.js';

// `nickelmenu-execute.js` performs the NickelMenu install and removal device
// writes and had no unit test at all until this file. CONVENTIONS §5 requires the
// order of operations, the failure handling and the audit records on that path to
// be proven with a test rather than by reading, which is the whole reason this
// exists: Phase 3 changes this module's signature, and nothing else would have
// caught a mistake in it.
//
// Everything here asserts observable outcomes — which mode the run ended in, what
// landed on the device in what order, what the audit log says, what the error
// screen is told — rather than how the module reaches them. That is deliberate:
// the signature is about to change and these must survive it unedited except for
// how the arguments are handed in.

const UNINSTALL_MARKER = '.adds/nm/uninstall';
const KOBO_ROOT_TGZ = '.kobo/KoboRoot.tgz';
const NM_DIRECTORY = '.adds/nm';

/** A device that records every write and removal, with the bits the flow reads. */
function createDevice(options = {}) {
    const device = new RecordingDevice({
        existingEntries: [
            { path: NM_DIRECTORY, kind: 'directory' },
            { path: '.adds', kind: 'directory' },
        ],
        ...options,
    });
    device.deviceInfo = { firmware: '4.41.23145', model: 'Kobo Clara' };
    device.directoryHandle = {};
    return device;
}

/** The flow's step machine, reduced to a recorder of where it was asked to go. */
function createFlowRecorder() {
    const visited = [];
    return { visited, go: async (stepId) => visited.push(stepId) };
}

function createErrorRecorder() {
    const calls = [];
    const showError = (message, log, options) => calls.push({ message, log, options });
    showError.calls = calls;
    return showError;
}

/**
 * The arguments `executeNmInstall` takes. Kept in one place so a signature change
 * is a single edit here rather than one per test — which is exactly what Phase 3
 * needed when it split these out of the session.
 */
function runInstall({ state, selection, outcome, flow, dom, showError, optionalCleanupFeatures = [], legacyItemsDetected = false, installedFeatureIds = [] }) {
    return executeNmInstall({
        state,
        selection,
        outcome,
        flow,
        previousConfiguration: null,
        installedFeatureIds,
        optionalCleanupFeatures,
        legacyItemsDetected,
        dom,
        showError,
    });
}

function createState(device) {
    return { device, nmInstaller: createInstaller() };
}

/** A `NickelMenuSelection`-shaped object with the fields this module reads. */
function createSelection(overrides = {}) {
    return {
        option: 'preset',
        selectedFeatureIds: [],
        optionalCleanupIds: [],
        keepLegacyConfig: false,
        menuCustomization: null,
        tabsCustomization: null,
        fontsCustomization: null,
        ...overrides,
    };
}

const createOutcome = () => ({ mode: null, zip: null });

const domFor = (writeToDevice) => ({ progress: { textContent: '' }, progressDetail: null, writeToDevice });

// The install and download paths fetch each feature's bundled assets. Serve them
// from memory for every test in this file rather than per test.
let restoreFetch = () => {};
test.beforeEach(() => {
    restoreFetch = useCustomMenuAssetFetch();
});
test.afterEach(() => {
    restoreFetch();
});

// --- the three exit paths ---------------------------------------------------

test('the remove path ends in remove mode on the done step', async () => {
    const device = createDevice();
    const state = createState(device);
    const selection = createSelection({ option: 'remove' });
    const outcome = createOutcome();
    const flow = createFlowRecorder();

    await runInstall({ state, selection, outcome, flow, dom: domFor(true), showError: createErrorRecorder() });

    assert.equal(outcome.mode, 'remove');
    assert.deepEqual(flow.visited, ['installing', 'done']);
});

test('the write path ends in written mode on the done step', async () => {
    const device = createDevice();
    const state = createState(device);
    const selection = createSelection();
    const outcome = createOutcome();
    const flow = createFlowRecorder();

    await runInstall({ state, selection, outcome, flow, dom: domFor(true), showError: createErrorRecorder() });

    assert.equal(outcome.mode, 'written');
    assert.deepEqual(flow.visited, ['installing', 'done']);
});

test('the download path ends in download mode and produces a ZIP', async () => {
    // `writeToDevice: false` is the download branch even with a device attached.
    const device = createDevice();
    const state = createState(device);
    const selection = createSelection();
    const outcome = createOutcome();
    const flow = createFlowRecorder();

    await runInstall({ state, selection, outcome, flow, dom: domFor(false), showError: createErrorRecorder() });

    assert.equal(outcome.mode, 'download');
    assert.ok(outcome.zip instanceof Uint8Array);
    assert.ok(outcome.zip.length > 0);
    assert.deepEqual(flow.visited, ['installing', 'done']);
});

test('a device with no directory handle takes the download path even when asked to write', async () => {
    const device = createDevice();
    device.directoryHandle = null;
    const state = createState(device);
    const selection = createSelection();
    const outcome = createOutcome();
    const flow = createFlowRecorder();

    await runInstall({ state, selection, outcome, flow, dom: domFor(true), showError: createErrorRecorder() });

    assert.equal(outcome.mode, 'download');
});

// --- the removal write order and its audit record ---------------------------

test('the removal writes the uninstall marker before KoboRoot.tgz, and nothing after it', async () => {
    // Order is the load-bearing part: the marker has to be on the device before
    // the tgz that triggers the reboot which acts on it.
    const device = createDevice();
    const state = createState(device);
    const selection = createSelection({ option: 'remove' });
    const outcome = createOutcome();

    await runInstall({ state, selection, outcome, flow: createFlowRecorder(), dom: domFor(true), showError: createErrorRecorder() });

    const paths = device.writePaths();
    const marker = paths.indexOf(UNINSTALL_MARKER);
    const tgz = paths.indexOf(KOBO_ROOT_TGZ);
    assert.ok(marker !== -1, 'the uninstall marker must be written');
    assert.ok(tgz !== -1, 'KoboRoot.tgz must be written');
    assert.ok(marker < tgz, `marker (${marker}) must precede KoboRoot.tgz (${tgz}) — got ${paths.join(', ')}`);

    // The NickelMenu directory is removed recursively before either write.
    const removal = device.removalFor(NM_DIRECTORY);
    assert.ok(removal, '.adds/nm must be removed');
    assert.equal(removal.options.recursive, true);
});

test('the removal writes an audit log recording the marker and the tgz', async () => {
    const device = createDevice();
    const state = createState(device);
    const selection = createSelection({ option: 'remove' });
    const outcome = createOutcome();

    await runInstall({ state, selection, outcome, flow: createFlowRecorder(), dom: domFor(true), showError: createErrorRecorder() });

    const logWrite = device.writes.find((write) => write.path.includes('/logs/'));
    assert.ok(logWrite, 'an audit log must be written under .kobopatch-webui/logs');
    const log = new TextDecoder().decode(logWrite.data);
    assert.match(log, /Removed \.adds\/nm/);
    assert.match(log, /Wrote uninstall marker \.adds\/nm\/uninstall/);
    assert.match(log, /Removing NickelMenu: wrote \.kobo\/KoboRoot\.tgz/);
});

test('the install path writes an audit log naming the operation', async () => {
    const device = createDevice();
    const state = createState(device);
    const selection = createSelection();
    const outcome = createOutcome();

    await runInstall({ state, selection, outcome, flow: createFlowRecorder(), dom: domFor(true), showError: createErrorRecorder() });

    const logWrite = device.writes.find((write) => write.path.includes('/logs/'));
    assert.ok(logWrite, 'an audit log must be written for an install too');
    assert.match(logWrite.path, /install-nickelmenu/);
});

// --- failure handling -------------------------------------------------------

test('a failed device write reports deviceWrite, attaches the audit log, and does not reach done', async () => {
    const device = createDevice({ failWritePath: KOBO_ROOT_TGZ });
    const state = createState(device);
    const selection = createSelection({ option: 'remove' });
    const outcome = createOutcome();
    const flow = createFlowRecorder();
    const showError = createErrorRecorder();

    await runInstall({ state, selection, outcome, flow, dom: domFor(true), showError });

    assert.deepEqual(flow.visited, ['installing'], 'a failed run must not advance to done');
    assert.equal(showError.calls.length, 1);
    const { options } = showError.calls[0];
    assert.equal(options.deviceWrite, true);
    assert.equal(options.configReadFailed, false);
    assert.ok(options.auditLog, 'the audit log is attached so the user can download it');
    // And it records what went wrong. The audit log is the user's only record of
    // how far a partial write got, so the failure line has to be in it — asserting
    // only that a log object exists would not notice the record being dropped.
    assert.match(options.auditLog.render(), /Failed: Refusing write to \.kobo\/KoboRoot\.tgz/);
    assert.equal(options.title, TL.ERROR.NM_REMOVE_FAILED_TITLE);
});

test('a Kobo eReader.conf read failure is reported as a connection problem, not a write', async () => {
    // The `configReadFailed` derivation: not a device write, but the message names
    // the conf file. It drives the connection tips without claiming anything was
    // changed on the device.
    const device = createDevice({ failReadPaths: ['.kobo/Kobo/Kobo eReader.conf'] });
    const state = createState(device);
    const selection = createSelection({ option: 'remove', optionalCleanupIds: ['screensaver'] });
    const outcome = createOutcome();
    const showError = createErrorRecorder();

    // Force the conf read by giving the removal a feature whose cleanup reverts
    // conf settings, then failing that read.
    const { default: screensaver } = await import('../../src/js/nickelmenu/features/screensaver/index.js');
    await runInstall({
        state,
        selection,
        outcome,
        flow: createFlowRecorder(),
        dom: domFor(true),
        showError,
        optionalCleanupFeatures: [screensaver],
    });

    assert.equal(showError.calls.length, 1);
    const { options } = showError.calls[0];
    assert.equal(options.deviceWrite, false);
    assert.equal(options.configReadFailed, true);
    assert.equal(options.connectionTips, true);
    assert.equal(options.title, TL.ERROR.NM_REMOVE_FAILED_TITLE);
});

test('a failed write to Kobo eReader.conf is a device write, not a read problem', async () => {
    // The `!err.deviceWrite &&` conjunct in the `configReadFailed` derivation.
    // This is the case it exists for: the message names the conf file *and*
    // something was written, so the user must not be told the device is
    // unchanged. Dropping the conjunct makes this case claim a read failure while
    // a partial write sits on the device — and no other test in this file moves
    // when it is dropped.
    const confPath = '.kobo/Kobo/Kobo eReader.conf';
    const device = createDevice({
        textFiles: { [confPath]: '[ApplicationPreferences]\nSideloadedMode=true\n' },
        failWritePath: confPath,
    });
    const state = createState(device);
    const selection = createSelection({ option: 'remove', optionalCleanupIds: ['sideloaded-mode'] });
    const outcome = createOutcome();
    const showError = createErrorRecorder();

    const { default: sideloadedMode } = await import('../../src/js/nickelmenu/features/sideloaded-mode/index.js');
    await runInstall({
        state,
        selection,
        outcome,
        flow: createFlowRecorder(),
        dom: domFor(true),
        showError,
        optionalCleanupFeatures: [sideloadedMode],
    });

    assert.equal(showError.calls.length, 1);
    const { options } = showError.calls[0];
    assert.equal(options.deviceWrite, true, 'the conf write failed, so this is a device write failure');
    assert.equal(options.configReadFailed, false, 'and must NOT be reported as a read-only connection problem');
    assert.equal(options.connectionTips, false);
});

test('a failure on a path that never created an audit log still reaches the error screen', async () => {
    // `audit` stays null on the download branch — it is only constructed on the
    // remove and device-write branches — and `buildDownloadZip` fetches each
    // feature's assets over the network. So a network failure while building a
    // download ZIP reaches the catch with `audit === null`, and the `?.` on
    // `audit?.record(...)` is what stops the error handler from throwing on the
    // way to reporting the error.
    //
    // Without it the catch throws before `showError` is ever called: no specific
    // error screen, the generic unexpected-error handler instead, and the flow
    // stranded on the installing step.
    const device = createDevice();
    const state = createState(device);
    const selection = createSelection();
    const outcome = createOutcome();
    const flow = createFlowRecorder();
    const showError = createErrorRecorder();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error('network down');
    };
    try {
        await runInstall({ state, selection, outcome, flow, dom: domFor(false), showError });
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(showError.calls.length, 1, 'the error must still be reported');
    assert.ok(!showError.calls[0].options.auditLog, 'there was no audit log to attach on this path');
    assert.equal(showError.calls[0].options.title, TL.ERROR.NM_INSTALL_FAILED_TITLE);
    assert.deepEqual(flow.visited, ['installing'], 'and the run must not advance to done');
    assert.equal(outcome.mode, null);
});

test('an install failure uses the install title, not the removal one', async () => {
    const device = createDevice({ failWritePath: KOBO_ROOT_TGZ });
    const state = createState(device);
    const selection = createSelection();
    const outcome = createOutcome();
    const showError = createErrorRecorder();

    await runInstall({ state, selection, outcome, flow: createFlowRecorder(), dom: domFor(true), showError });

    assert.equal(showError.calls.length, 1);
    assert.equal(showError.calls[0].options.title, TL.ERROR.NM_INSTALL_FAILED_TITLE);
    assert.match(showError.calls[0].message, /NickelMenu installation failed/);
});

// --- renderNmDoneStatus -----------------------------------------------------

function doneDom() {
    const el = () => ({ textContent: '', hidden: false, innerHTML: '' });
    return {
        doneStatus: el(),
        writeInstructions: el(),
        downloadInstructions: el(),
        rebootInstructions: el(),
        downloadConfStep: el(),
        downloadRebootStep: el(),
        downloadConfLine: el(),
        downloadConfDesc: el(),
        downloadConfSettings: document.createElement('div'),
        downloadConfSettingsStep: el(),
    };
}

function createTerminalRecorder() {
    const ended = [];
    return { ended, end: (name) => ended.push(name), wireFeedback: () => {} };
}

test('the done screen shows the reboot instructions for a removal', () => {
    const dom = doneDom();
    const terminal = createTerminalRecorder();

    renderNmDoneStatus({}, createSelection(), { mode: 'remove', zip: null }, terminal, dom);

    assert.equal(dom.doneStatus.textContent, TL.STATUS.NM_REMOVED_ON_REBOOT);
    assert.equal(dom.rebootInstructions.hidden, false);
    assert.equal(dom.writeInstructions.hidden, true);
    assert.equal(dom.downloadInstructions.hidden, true);
    assert.deepEqual(terminal.ended, ['nm-remove']);
});

test('the done screen shows the write instructions for a device write', () => {
    const dom = doneDom();
    const terminal = createTerminalRecorder();

    renderNmDoneStatus({}, createSelection(), { mode: 'written', zip: null }, terminal, dom);

    assert.equal(dom.doneStatus.textContent, TL.STATUS.NM_INSTALLED);
    assert.equal(dom.writeInstructions.hidden, false);
    assert.equal(dom.rebootInstructions.hidden, true);
    assert.deepEqual(terminal.ended, ['nm-write']);
});

test('the done screen triggers the download and shows its instructions', () => {
    const dom = doneDom();
    const terminal = createTerminalRecorder();
    const downloads = [];
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (blob) => {
        downloads.push(blob);
        return 'blob:stub';
    };
    URL.revokeObjectURL = () => {};

    try {
        renderNmDoneStatus(
            { device: { deviceInfo: { firmware: '4.41.23145' } } },
            createSelection({ option: 'preset' }),
            { mode: 'download', zip: new Uint8Array([1, 2, 3]) },
            terminal,
            dom,
        );
    } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
    }

    assert.equal(dom.doneStatus.textContent, TL.STATUS.NM_DOWNLOAD_READY);
    assert.equal(dom.downloadInstructions.hidden, false);
    assert.equal(downloads.length, 1, 'the ZIP is handed to the browser');
    assert.deepEqual(terminal.ended, ['nm-download']);
});

test('a null mode renders identically to download — there is no fourth branch', () => {
    // The premise `NickelMenuOutcome.clear()` rests on: it leaves `mode` alone
    // because `renderNmDoneStatus` branches remove / written / *else download*,
    // so a cleared null is indistinguishable from a stale 'download' and clearing
    // it would protect nothing.
    //
    // That decision lives in one directory and this function in another, with a
    // comment as the only link. This test is the link: add a fourth arm — or make
    // null mean anything of its own — and it fails here, next to the code that
    // would have to change.
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:stub';
    URL.revokeObjectURL = () => {};

    const render = (mode) => {
        const dom = doneDom();
        const terminal = createTerminalRecorder();
        renderNmDoneStatus(
            { device: { deviceInfo: { firmware: '4.41.23145' } } },
            createSelection({ option: 'preset' }),
            { mode, zip: new Uint8Array([1, 2, 3]) },
            terminal,
            dom,
        );
        // `downloadConfSettings` is a real element, so compare its markup rather
        // than the node itself.
        return { dom: { ...dom, downloadConfSettings: dom.downloadConfSettings.innerHTML }, ended: terminal.ended };
    };

    try {
        assert.deepEqual(render(null), render('download'));
    } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
    }
});

test('the download conf steps are hidden when the option is not the preset', () => {
    const dom = doneDom();
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:stub';
    const originalRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = () => {};

    try {
        renderNmDoneStatus(
            { device: { deviceInfo: { firmware: '4.41.23145' } } },
            createSelection({ option: 'remove' }),
            { mode: 'download', zip: new Uint8Array([1]) },
            createTerminalRecorder(),
            dom,
        );
    } finally {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
    }

    assert.equal(dom.downloadConfStep.hidden, true);
    assert.equal(dom.downloadRebootStep.hidden, true);
});
