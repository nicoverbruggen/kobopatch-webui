import test from 'node:test';
import assert from 'node:assert/strict';

import { koboHardwareIds, parseKoboVersion, compareFirmware, meetsMinimumVersion } from '../../src/js/kobo/version.js';

const HARDWARE_ID = '00000000-0000-0000-0000-000000000390';
const UNKNOWN_HARDWARE_ID = '00000000-0000-0000-0000-999999999999';

function versionLine(serial, firmware, hardwareId = HARDWARE_ID) {
    return `${serial},4.9.77,${firmware},4.9.77,4.9.77,${hardwareId}`;
}

test('parseKoboVersion reads known 4-character device prefixes', () => {
    assert.deepEqual(parseKoboVersion(versionLine('N4284B5215352', '4.45.23646')), {
        serial: 'N4284B5215352',
        serialPrefix: 'N428',
        rawSerialPrefix: 'N428',
        firmware: '4.45.23646',
        hardwareId: HARDWARE_ID,
        model: 'Kobo Libra Colour',
        channel: 'kobo13',
        identifiedBy: 'uuid',
        deviceVerification: 'verified',
        serialPrefixStatus: 'verified',
        serialPrefixMatches: true,
        isRefurbished: false,
        isIncompatible: false,
    });
});

test('parseKoboVersion does not identify devices by serial prefix alone', () => {
    const info = parseKoboVersion(versionLine('N905ABC123456', '4.38.21908', UNKNOWN_HARDWARE_ID));

    assert.equal(info.serialPrefix, 'N905');
    assert.equal(info.model, 'Unknown Kobo (N905)');
    assert.equal(info.channel, null);
    assert.equal(info.identifiedBy, null);
    assert.equal(info.deviceVerification, 'unknown');
});

test('parseKoboVersion accepts known R-prefixed serials as refurbished variants', () => {
    const info = parseKoboVersion(versionLine(
        'R418ABC123456',
        '4.38.21908',
        '00000000-0000-0000-0000-000000000388'
    ));

    assert.equal(info.serialPrefix, 'N418');
    assert.equal(info.rawSerialPrefix, 'R418');
    assert.equal(info.model, 'Kobo Libra 2');
    assert.equal(info.identifiedBy, 'uuid');
    assert.equal(info.serialPrefixStatus, 'refurbished');
    assert.equal(info.serialPrefixMatches, true);
    assert.equal(info.isRefurbished, true);
});

test('parseKoboVersion flags known UUIDs with mismatched serial prefixes', () => {
    const info = parseKoboVersion(versionLine(
        'N418ABC123456',
        '4.38.21908',
        '00000000-0000-0000-0000-000000000390'
    ));

    assert.equal(info.serialPrefix, 'N428');
    assert.equal(info.model, 'Kobo Libra Colour');
    assert.equal(info.identifiedBy, 'uuid');
    assert.equal(info.deviceVerification, 'mismatch');
    assert.equal(info.serialPrefixStatus, 'mismatch');
    assert.equal(info.serialPrefixMatches, false);
});

test('parseKoboVersion reports unknown hardware UUIDs even with a known-looking serial prefix', () => {
    const info = parseKoboVersion(versionLine(
        'N418ABC123456',
        '4.38.21908',
        UNKNOWN_HARDWARE_ID
    ));

    assert.equal(info.serialPrefix, 'N418');
    assert.equal(info.model, 'Unknown Kobo (N418)');
    assert.equal(info.identifiedBy, null);
    assert.equal(info.deviceVerification, 'unknown');
});

test('parseKoboVersion flags unknown serial prefixes against known hardware UUIDs', () => {
    const info = parseKoboVersion(versionLine(
        'X999ABC123456',
        '4.38.21908',
        '00000000-0000-0000-0000-000000000388'
    ));

    assert.equal(info.serialPrefix, 'N418');
    assert.equal(info.model, 'Kobo Libra 2');
    assert.equal(info.identifiedBy, 'uuid');
    assert.equal(info.deviceVerification, 'mismatch');
});

test('parseKoboVersion prefers revision-specific hardware UUID model names', () => {
    const info = parseKoboVersion(versionLine(
        'N709ABC123456',
        '4.38.21908',
        '00000000-0000-0000-0000-000000000381'
    ));

    assert.equal(info.serialPrefix, 'N709');
    assert.equal(info.model, 'Kobo Aura ONE Limited Edition');
    assert.equal(info.identifiedBy, 'uuid');
    assert.equal(info.deviceVerification, 'verified');
});

test('parseKoboVersion requires refurbished serial numbers to match the expected digits', () => {
    const info = parseKoboVersion(versionLine(
        'R999ABC123456',
        '4.38.21908',
        '00000000-0000-0000-0000-000000000388'
    ));

    assert.equal(info.serialPrefix, 'N418');
    assert.equal(info.model, 'Kobo Libra 2');
    assert.equal(info.identifiedBy, 'uuid');
    assert.equal(info.deviceVerification, 'mismatch');
    assert.equal(info.serialPrefixStatus, 'mismatch');
    assert.equal(info.isRefurbished, false);
});

test('parseKoboVersion reports unknown models with the first 4 serial characters', () => {
    const info = parseKoboVersion(versionLine('Z999ABC123456', '4.38.21908', UNKNOWN_HARDWARE_ID));

    assert.equal(info.serialPrefix, 'Z999');
    assert.equal(info.model, 'Unknown Kobo (Z999)');
    assert.equal(info.identifiedBy, null);
});

test('parseKoboVersion reports unknown R-prefixed models without guessing a base model', () => {
    const info = parseKoboVersion(versionLine('R999ABC123456', '4.38.21908', UNKNOWN_HARDWARE_ID));

    assert.equal(info.serialPrefix, 'R999');
    assert.equal(info.model, 'Unknown Kobo (R999)');
    assert.equal(info.identifiedBy, null);
});

test('parseKoboVersion does not fall back to a 3-character prefix', () => {
    const info = parseKoboVersion(versionLine('N90XABC123456', '4.38.21908', UNKNOWN_HARDWARE_ID));

    assert.equal(info.serialPrefix, 'N90X');
    assert.equal(info.model, 'Unknown Kobo (N90X)');
    assert.equal(info.identifiedBy, null);
});

test('koboHardwareIds maps firmware UUIDs to canonical serial prefixes', () => {
    assert.deepEqual(koboHardwareIds['00000000-0000-0000-0000-000000000320'], {
        serialPrefix: 'N905',
        channel: 'kobo4',
        model: 'Kobo Touch C',
    });
    assert.deepEqual(koboHardwareIds['00000000-0000-0000-0000-000000000378'], {
        serialPrefix: 'N867',
        channel: 'kobo7',
        model: 'Kobo Aura H2O Edition 2 v2',
    });
    assert.deepEqual(koboHardwareIds['00000000-0000-0000-0000-000000000379'], {
        serialPrefix: 'N236',
        channel: 'kobo7',
        model: 'Kobo Aura Edition 2 v2',
    });
    assert.deepEqual(koboHardwareIds['00000000-0000-0000-0000-000000000381'], {
        serialPrefix: 'N709',
        channel: 'kobo6',
        model: 'Kobo Aura ONE Limited Edition',
    });
    assert.deepEqual(koboHardwareIds['00000000-0000-0000-0000-000000000390'], {
        serialPrefix: 'N428',
        channel: 'kobo13',
        model: 'Kobo Libra Colour',
    });
    assert.deepEqual(koboHardwareIds['00000000-0000-0000-0000-000000000393'], {
        serialPrefix: 'N367',
        channel: 'kobo12',
        model: 'Kobo Clara Colour',
    });
    assert.deepEqual(koboHardwareIds['00000000-0000-0000-0000-000000000395'], {
        serialPrefix: 'P365',
        channel: 'kobo14',
        model: 'Kobo Clara BW',
    });
    assert.deepEqual(koboHardwareIds['00000000-0000-0000-0000-000000000380'], {
        serialPrefix: 'N782',
        channel: 'kobo7',
        model: 'Kobo Forma',
    });
    assert.equal(Object.values(koboHardwareIds).every(info => info.channel), true);
});

test('parseKoboVersion rejects malformed version files', () => {
    assert.throws(
        () => parseKoboVersion('N4284B5215352,4.9.77,4.45.23646'),
        /Expected 6 comma-separated fields/
    );
});

test('parseKoboVersion marks firmware before 4.6 as incompatible', () => {
    assert.equal(parseKoboVersion(versionLine('N4284B5215352', '4.5.99999')).isIncompatible, true);
});

test('parseKoboVersion marks firmware 4.6 and later 4.x versions as compatible', () => {
    assert.equal(parseKoboVersion(versionLine('N4284B5215352', '4.6.99999')).isIncompatible, false);
    assert.equal(parseKoboVersion(versionLine('N4284B5215352', '4.45.23646')).isIncompatible, false);
});

test('parseKoboVersion marks firmware 5.x as incompatible', () => {
    assert.equal(parseKoboVersion(versionLine('N4284B5215352', '5.0.0')).isIncompatible, true);
});

test('compareFirmware orders versions segment-by-segment, ignoring trailing zeros', () => {
    assert.equal(compareFirmware('4.45.23646', '4.31'), 1);
    assert.equal(compareFirmware('4.28.17820', '4.31'), -1);
    assert.equal(compareFirmware('4.31', '4.31.0'), 0);
    assert.equal(compareFirmware('4.31.1', '4.31'), 1);
    assert.equal(compareFirmware('4.9.0', '4.10.0'), -1); // numeric, not lexical
});

test('meetsMinimumVersion gates only when a known firmware is below the floor', () => {
    assert.equal(meetsMinimumVersion('4.45.23646', '4.31'), true);
    assert.equal(meetsMinimumVersion('4.31.0', '4.31'), true);
    assert.equal(meetsMinimumVersion('4.28.17820', '4.31'), false);
    // No minimum, or an unknown firmware (manual mode), is never gated.
    assert.equal(meetsMinimumVersion('4.28.17820', undefined), true);
    assert.equal(meetsMinimumVersion(undefined, '4.31'), true);
    assert.equal(meetsMinimumVersion('', '4.31'), true);
});
