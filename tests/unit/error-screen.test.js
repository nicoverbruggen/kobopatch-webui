import './dom-harness.js'; // the error screen binds its elements from the real markup

import test from 'node:test';
import assert from 'node:assert/strict';

import { ErrorScreen } from '../../src/js/shell/ErrorScreen.js';
import { resetHistory, showStep } from '../../src/js/shell/Navigation.js';
import { createFlow } from '../../src/js/shell/StepMachine.js';
import { $ } from '../../src/js/shell/DOM.js';
import { TL } from '../../src/js/shell/Strings.js';

// `showError`'s five-branch decision table is what a user sees when a device
// write fails, and it had no unit coverage at all. Each branch picks a different
// title, a different set of visible affordances, and a different analytics
// category, and the chain is ordered — `deviceWrite` outranks `options.title`,
// which outranks a recovery target. These tests assert the *rendered outcome*
// rather than which branch ran, so they survive the code being restructured.

// The wizard the screen under test reads. `activeFlow` lives on it now rather
// than in a module global, so each test drives it through this stub.
let nav;

function freshScreen() {
    // `showError` pushes `step-error` onto the back-stack, and the `hasBackStep`
    // branch keys on the same stack, so each test starts from the initial
    // one-element state rather than inheriting the previous test's.
    resetHistory();
    nav = { session: {}, activeFlow: null };
    const screen = new ErrorScreen(nav);
    return (...args) => screen.showError(...args);
}

function rendered() {
    return {
        title: $('error-title').textContent,
        message: $('error-message').textContent,
        deviceWriteHelpHidden: $('error-device-write-help').hidden,
        hintHidden: $('error-hint').hidden,
        backHidden: $('btn-error-back').hidden,
        retryIsDanger: $('btn-retry').classList.contains('danger'),
        downloadLogHidden: $('btn-error-download-log').hidden,
    };
}

/** Capture the analytics events `track()` would emit. */
function captureTracking() {
    const events = [];
    window.__ANALYTICS_ENABLED = true;
    window.umami = { track: (name, data) => events.push({ name, data }) };
    return events;
}

function clearTracking() {
    delete window.__ANALYTICS_ENABLED;
    delete window.umami;
}

/** An active flow whose current step declares a recovery target. */
function activateFlowWithRecovery() {
    const flow = createFlow({
        id: 'error-screen-test',
        steps: [
            { id: 'a', domId: 'step-nickelmenu', recoveryStep: 'b' },
            { id: 'b', domId: 'step-nm-review' },
        ],
        onActivate: (active) => {
            nav.activeFlow = active;
        },
    });
    return flow.go('a', {});
}

test('a device-write failure shows the write title, the connection tips and no back button', () => {
    const showError = freshScreen();

    showError('ignored, the branch replaces it', null, { deviceWrite: true });

    const ui = rendered();
    assert.equal(ui.title, TL.ERROR.DEVICE_WRITE_FAILED_TITLE);
    assert.equal(ui.message, TL.ERROR.DEVICE_WRITE_FAILED_MESSAGE, 'the branch overrides the caller message');
    assert.equal(ui.deviceWriteHelpHidden, false);
    assert.equal(ui.hintHidden, true);
    assert.equal(ui.backHidden, true);
    assert.equal(ui.retryIsDanger, false);
});

test('a write-probe failure is a distinct title and message from a plain write failure', () => {
    const showError = freshScreen();

    showError('ignored', null, { deviceWrite: true, writeProbe: true });

    const ui = rendered();
    assert.equal(ui.title, TL.ERROR.DEVICE_PROBE_FAILED_TITLE);
    assert.equal(ui.message, TL.ERROR.DEVICE_PROBE_FAILED_MESSAGE);
    assert.equal(ui.deviceWriteHelpHidden, false);
});

test('deviceWrite outranks an explicit title — the chain is ordered', () => {
    const showError = freshScreen();

    showError('ignored', null, { deviceWrite: true, title: 'A title that must not win' });

    assert.equal(rendered().title, TL.ERROR.DEVICE_WRITE_FAILED_TITLE);
});

test('an explicit title is used as-is, and configReadFailed replaces the message', () => {
    const showError = freshScreen();

    showError('the original message', null, { title: 'Custom title', configReadFailed: true });

    const ui = rendered();
    assert.equal(ui.title, 'Custom title');
    assert.equal(ui.message, TL.ERROR.DEVICE_CONFIG_READ_FAILED_MESSAGE);
    assert.equal(ui.hintHidden, true);
    assert.equal(ui.backHidden, true);
    assert.equal(ui.retryIsDanger, false);
});

test('an explicit title without configReadFailed keeps the caller message', () => {
    const showError = freshScreen();

    showError('the original message', null, { title: 'Custom title' });

    assert.equal(rendered().message, 'the original message');
});

test('connectionTips reveals the device-write help even without deviceWrite', () => {
    const showError = freshScreen();

    showError('m', null, { title: 'Custom title', connectionTips: true });

    assert.equal(rendered().deviceWriteHelpHidden, false);
});

test('a recoverable flow step offers Back and marks Retry as destructive', () => {
    const showError = freshScreen();

    return activateFlowWithRecovery().then(() => {
        showError('build failed');

        const ui = rendered();
        assert.equal(ui.title, TL.ERROR.PATCH_FAILED);
        assert.equal(ui.deviceWriteHelpHidden, true);
        assert.equal(ui.hintHidden, false);
        assert.equal(ui.backHidden, false);
        assert.equal(ui.retryIsDanger, true, 'Retry reloads the page, so it is flagged when a safe Back exists');
        nav.activeFlow = null;
    });
});

test('a patches step in the history offers Back even with no active flow', () => {
    const showError = freshScreen();
    showStep($('step-patches')); // puts it on the back-stack the way the app does

    showError('build failed');

    const ui = rendered();
    assert.equal(ui.title, TL.ERROR.PATCH_FAILED);
    assert.equal(ui.hintHidden, false);
    assert.equal(ui.backHidden, false);
    assert.equal(ui.retryIsDanger, true);
});

test('with no recovery and no history the fallback hides every affordance', () => {
    const showError = freshScreen();

    showError('something broke');

    const ui = rendered();
    assert.equal(ui.title, TL.ERROR.SOMETHING_WENT_WRONG);
    assert.equal(ui.message, 'something broke', 'the fallback keeps the caller message');
    assert.equal(ui.deviceWriteHelpHidden, true);
    assert.equal(ui.hintHidden, true);
    assert.equal(ui.backHidden, true);
    assert.equal(ui.retryIsDanger, false);
});

test('the download-log button appears exactly when an audit log came with the error', () => {
    const showError = freshScreen();

    showError('no log here');
    assert.equal(rendered().downloadLogHidden, true);

    showError('with a log', null, { auditLog: { path: ['x.log'], render: () => 'contents' } });
    assert.equal(rendered().downloadLogHidden, false);

    // A later error without one must clear it rather than leave the stale button.
    showError('no log again');
    assert.equal(rendered().downloadLogHidden, true);
});

test('the log pane is shown only when log text is passed', () => {
    const showError = freshScreen();

    showError('m', 'a build log');
    assert.equal($('error-log').hidden, false);
    assert.equal($('error-log').textContent, 'a build log');

    showError('m', null);
    assert.equal($('error-log').hidden, true);
});

test('the error screen reports nothing at all, whatever the failure', () => {
    // This is a privacy guarantee, not a nicety. The screen used to report a
    // coarse category for unexpected failures; it now reports nothing, and
    // error reporting is meant to move to a dedicated tool instead.
    const showError = freshScreen();
    const events = captureTracking();

    try {
        showError('m', null, { deviceWrite: true, writeProbe: true });
        showError('m', null, { deviceWrite: true });
        showError('m', null, { configReadFailed: true, title: 't' });
        showError('user declined the prompt', null, { title: TL.ERROR.PERMISSION_DENIED_TITLE });
        showError('a real failure', null, {});

        assert.deepEqual(events, []);
    } finally {
        clearTracking();
    }
});

test('the error screen is the visible step and the breadcrumb is hidden', () => {
    const showError = freshScreen();

    showError('m');

    assert.equal($('step-error').hidden, false);
    assert.equal($('step-nav').hidden, true);
});
