import test from 'node:test';
import assert from 'node:assert/strict';

import { createTerminal } from '../../src/js/shell/terminal.js';
import { AUDIT_LOG_DIRECTORY } from '../../src/js/kobo/audit-log.js';
import { RecordingDevice, bytes, text } from './test-helpers.js';

test('writeToDevice writes every entry and persists an audit log on success', async () => {
    const device = new RecordingDevice();
    const errors = [];
    const terminal = createTerminal({ doneStep: {}, showError: (...args) => errors.push(args) });

    const result = await terminal.writeToDevice({
        device,
        auditName: 'custom-patches',
        writes: [
            { path: ['.kobo', 'KoboRoot.tgz'], data: bytes('tgz-bytes'), label: 'Wrote KoboRoot.tgz' },
        ],
    });

    assert.equal(result.ok, true);
    assert.equal(text(device.writeFor('.kobo/KoboRoot.tgz').data), 'tgz-bytes');

    // The run's audit log is persisted under .kobopatch-webui/logs/ and records the step.
    const auditWrite = device.writes.find(w => w.path.startsWith(`${AUDIT_LOG_DIRECTORY}/logs/`));
    assert.ok(auditWrite, 'expected an audit log file to be written');
    assert.match(text(auditWrite.data), /Wrote KoboRoot\.tgz/);
    assert.equal(errors.length, 0);
});

test('writeToDevice routes a failed required write to the error screen with the audit log', async () => {
    const device = new RecordingDevice({ failWritePath: '.kobo/KoboRoot.tgz' });
    const errors = [];
    const terminal = createTerminal({ doneStep: {}, showError: (...args) => errors.push(args) });

    const result = await terminal.writeToDevice({
        device,
        auditName: 'custom-patches',
        writes: [{ path: ['.kobo', 'KoboRoot.tgz'], data: bytes('x'), label: 'w' }],
        failMessage: (err) => `Write failed: ${err.message}`,
    });

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.equal(errors.length, 1);
    const [message, log, options] = errors[0];
    assert.match(message, /Write failed: Refusing write to \.kobo\/KoboRoot\.tgz/);
    assert.equal(log, null);
    assert.ok(options.auditLog, 'error carries the audit log for download');
});

test('writeToDevice skips a failing optional write without failing the operation', async () => {
    const device = new RecordingDevice({ failWritePath: '.kobopatch-webui/custom-patches.json' });
    const errors = [];
    const terminal = createTerminal({ doneStep: {}, showError: (...args) => errors.push(args) });

    const originalWarn = console.warn;
    console.warn = () => {};
    let result;
    try {
        result = await terminal.writeToDevice({
            device,
            auditName: 'custom-patches',
            writes: [
                { path: ['.kobo', 'KoboRoot.tgz'], data: bytes('tgz'), label: 'wrote tgz' },
                { path: ['.kobopatch-webui', 'custom-patches.json'], data: bytes('{}'), label: 'wrote manifest', optional: true },
            ],
        });
    } finally {
        console.warn = originalWarn;
    }

    assert.equal(result.ok, true);
    assert.ok(device.writeFor('.kobo/KoboRoot.tgz'));
    assert.equal(device.writeFor('.kobopatch-webui/custom-patches.json'), undefined);
    assert.equal(errors.length, 0);
});
