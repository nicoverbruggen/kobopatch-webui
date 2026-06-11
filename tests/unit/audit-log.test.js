import test from 'node:test';
import assert from 'node:assert/strict';

import { AuditLog, auditLogFileName } from '../../src/js/kobo/audit-log.js';
import { RecordingDevice, text } from './test-helpers.js';

test('auditLogFileName formats the run start time as log-yy-mm-dd_hh-mm.log', () => {
    // 2026-06-11 14:30 local time.
    assert.equal(auditLogFileName(new Date(2026, 5, 11, 14, 30)), 'log-26-06-11_14-30.log');
    // Single-digit month/day/hour/minute are zero-padded.
    assert.equal(auditLogFileName(new Date(2027, 0, 3, 9, 5)), 'log-27-01-03_09-05.log');
});

test('AuditLog buffers timestamped lines and writes one file under .kobopatch-webui', async () => {
    const log = new AuditLog(new Date(2026, 5, 11, 14, 30));
    log.record('Wrote .kobo/KoboRoot.tgz (10 bytes)');
    log.record('Removed .adds/nm');

    assert.deepEqual(log.path, ['.kobopatch-webui', 'log-26-06-11_14-30.log']);

    const device = new RecordingDevice();
    await log.write(device);

    assert.deepEqual(device.writePaths(), ['.kobopatch-webui/log-26-06-11_14-30.log']);
    const contents = text(device.writeFor('.kobopatch-webui/log-26-06-11_14-30.log').data);
    assert.match(contents, /^kobopatch-webui audit log — started /);
    assert.match(contents, /Wrote \.kobo\/KoboRoot\.tgz \(10 bytes\)/);
    assert.match(contents, /Removed \.adds\/nm/);
    // Each recorded line is timestamped.
    assert.match(contents, /\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] Removed \.adds\/nm/);
});
