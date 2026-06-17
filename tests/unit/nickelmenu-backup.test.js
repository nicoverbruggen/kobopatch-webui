import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldOfferNmBackup, buildBackupFilename } from '../../src/js/flows/nickelmenu-backup.js';

test('shouldOfferNmBackup only offers for a connected device in non-manual mode', () => {
    assert.equal(shouldOfferNmBackup({ manualMode: false, device: { directoryHandle: {} } }), true);
    assert.equal(shouldOfferNmBackup({ manualMode: true, device: { directoryHandle: {} } }), false);
    assert.equal(shouldOfferNmBackup({ manualMode: false, device: { directoryHandle: null } }), false);
});

test('buildBackupFilename embeds the serial and a timestamped .zip name', () => {
    const name = buildBackupFilename({ serial: 'N123456' });
    assert.match(name, /^KoboPatch Backup \(N123456\) - \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.zip$/);
});

test('buildBackupFilename falls back when the serial is missing', () => {
    assert.match(buildBackupFilename(undefined), /^KoboPatch Backup \(UNKNOWN SERIAL\) - /);
});
