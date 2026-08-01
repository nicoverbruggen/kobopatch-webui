import test from 'node:test';
import assert from 'node:assert/strict';

import { AuditLog, auditLogFileName } from '../../src/js/kobo/AuditLog.js';
import { RecordingDevice, text } from './test-helpers.js';

test('auditLogFileName formats the run start time and type as yy-mm-dd_hh-mm-type.log', () => {
    assert.equal(auditLogFileName(new Date(2026, 5, 11, 14, 30), 'install-nickelmenu'), '26-06-11_14-30-install-nickelmenu.log');
    assert.equal(auditLogFileName(new Date(2027, 0, 3, 9, 5), 'remove-nickelmenu'), '27-01-03_09-05-remove-nickelmenu.log');
});

test('AuditLog buffers timestamped lines and writes one file under .kobopatch-webui/logs', async () => {
    const device = new RecordingDevice();
    const log = new AuditLog('install-nickelmenu', new Date(2026, 5, 11, 14, 30), device);
    log.record('Wrote .kobo/KoboRoot.tgz (10 bytes)');
    log.record('Removed .adds/nm');

    assert.deepEqual(log.path, ['.kobopatch-webui', 'logs', '26-06-11_14-30-install-nickelmenu.log']);
    assert.deepEqual(device.writePaths(), []);

    await log.write();

    assert.deepEqual(device.writePaths(), ['.kobopatch-webui/logs/26-06-11_14-30-install-nickelmenu.log']);
    const contents = text(device.writeFor('.kobopatch-webui/logs/26-06-11_14-30-install-nickelmenu.log').data);
    assert.match(contents, /^kobopatch-webui audit log — started /);
    assert.match(contents, /Wrote \.kobo\/KoboRoot\.tgz \(10 bytes\)/);
    assert.match(contents, /Removed \.adds\/nm/);
    // Each recorded line is timestamped.
    assert.match(contents, /\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] Removed \.adds\/nm/);
});
