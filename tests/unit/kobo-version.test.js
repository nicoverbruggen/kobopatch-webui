import test from 'node:test';
import assert from 'node:assert/strict';

import { koboHardwareIds, minimumSupportedFirmware, parseKoboVersion, compareFirmware, meetsMinimumVersion } from '../../src/js/kobo/version.js';

const HARDWARE_ID = '00000000-0000-0000-0000-000000000390';
const UNKNOWN_HARDWARE_ID = '00000000-0000-0000-0000-999999999999';

function versionLine(serial, firmware, hardwareId = HARDWARE_ID) {
    return `${serial},4.9.77,${firmware},4.9.77,4.9.77,${hardwareId}`;
}

test('parseKoboVersion reads known 4-character device prefixes', () => {
    assert.deepEqual(parseKoboVersion(versionLine('N428000000000', '4.45.23646')), {
        serial: 'N428000000000',
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
        incompatibleReason: null,
    });
});

test('parseKoboVersion accepts known R-prefixed serials as refurbished variants', () => {
    const info = parseKoboVersion(versionLine('R418ABC123456', '4.38.21908', '00000000-0000-0000-0000-000000000388'));

    assert.equal(info.serialPrefix, 'N418');
    assert.equal(info.rawSerialPrefix, 'R418');
    assert.equal(info.model, 'Kobo Libra 2');
    assert.equal(info.identifiedBy, 'uuid');
    assert.equal(info.serialPrefixStatus, 'refurbished');
    assert.equal(info.serialPrefixMatches, true);
    assert.equal(info.isRefurbished, true);
});

test('parseKoboVersion flags known UUIDs with mismatched serial prefixes', () => {
    const info = parseKoboVersion(versionLine('N418ABC123456', '4.38.21908', '00000000-0000-0000-0000-000000000390'));

    assert.equal(info.serialPrefix, 'N428');
    assert.equal(info.model, 'Kobo Libra Colour');
    assert.equal(info.identifiedBy, 'uuid');
    assert.equal(info.deviceVerification, 'mismatch');
    assert.equal(info.serialPrefixStatus, 'mismatch');
    assert.equal(info.serialPrefixMatches, false);
});

test('parseKoboVersion reports unknown hardware UUIDs even with a known-looking serial prefix', () => {
    const info = parseKoboVersion(versionLine('N418ABC123456', '4.38.21908', UNKNOWN_HARDWARE_ID));

    // A serial prefix that matches a real device is not enough: identification is UUID-driven.
    assert.equal(info.serialPrefix, 'N418');
    assert.equal(info.model, 'Unknown Kobo (N418)');
    assert.equal(info.channel, null);
    assert.equal(info.identifiedBy, null);
    assert.equal(info.deviceVerification, 'unknown');
    assert.equal(info.serialPrefixMatches, false);
});

test('parseKoboVersion flags unknown serial prefixes against known hardware UUIDs', () => {
    const info = parseKoboVersion(versionLine('X999ABC123456', '4.38.21908', '00000000-0000-0000-0000-000000000388'));

    assert.equal(info.serialPrefix, 'N418');
    assert.equal(info.model, 'Kobo Libra 2');
    assert.equal(info.identifiedBy, 'uuid');
    assert.equal(info.deviceVerification, 'mismatch');
});

test('parseKoboVersion prefers revision-specific hardware UUID model names', () => {
    const info = parseKoboVersion(versionLine('N709ABC123456', '4.38.21908', '00000000-0000-0000-0000-000000000381'));

    assert.equal(info.serialPrefix, 'N709');
    assert.equal(info.model, 'Kobo Aura ONE Limited Edition');
    assert.equal(info.identifiedBy, 'uuid');
    assert.equal(info.deviceVerification, 'verified');
});

test('parseKoboVersion requires refurbished serial numbers to match the expected digits', () => {
    const info = parseKoboVersion(versionLine('R999ABC123456', '4.38.21908', '00000000-0000-0000-0000-000000000388'));

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
    assert.equal(
        Object.values(koboHardwareIds).every((info) => info.channel),
        true,
    );
});

test('parseKoboVersion rejects files with fewer than 6 fields', () => {
    assert.throws(() => parseKoboVersion('N428000000000,4.9.77,4.45.23646'), /Expected 6 comma-separated fields/);
    assert.throws(() => parseKoboVersion(''), /Expected 6 comma-separated fields/);
});

test('parseKoboVersion throws on non-string content rather than returning garbage', () => {
    // content is always a file string in production; a non-string is a programming
    // error and must surface loudly, not silently parse to nonsense.
    assert.throws(() => parseKoboVersion(null));
    assert.throws(() => parseKoboVersion(undefined));
});

// --- compareFirmware: ordering correctness ---

test('compareFirmware orders segments numerically, not lexically', () => {
    assert.equal(compareFirmware('4.45.23646', '4.31'), 1);
    assert.equal(compareFirmware('4.28.17820', '4.31'), -1);
    assert.equal(compareFirmware('4.9.0', '4.10.0'), -1); // 9 < 10 numerically; would be > lexically
    assert.equal(compareFirmware('4.100', '4.99'), 1); // 100 > 99 numerically; would be < lexically
});

test('compareFirmware treats missing trailing segments as zero', () => {
    assert.equal(compareFirmware('4.31', '4.31.0'), 0);
    assert.equal(compareFirmware('4.31.0.0', '4.31'), 0);
    assert.equal(compareFirmware('4', '4.0.0'), 0); // short form equals padded form
    assert.equal(compareFirmware('4.31.1', '4.31'), 1);
});

test('compareFirmware ranks a longer version above its own prefix', () => {
    // Boundary: equal builds differing only by an extra final component.
    assert.equal(compareFirmware('4.38.23697.1', '4.38.23697'), 1);
    assert.equal(compareFirmware('4.38.23697', '4.38.23697.1'), -1);
    assert.equal(compareFirmware('4.38.23697', '4.38.23698'), -1); // differ only in last component
});

test('compareFirmware is reflexive and antisymmetric across the value space', () => {
    const samples = ['4', '4.23', '4.31.0', '4.31.1', '4.9.77', '4.45.23646', '4.100.0', '5.0.0'];
    for (const v of samples) {
        assert.equal(compareFirmware(v, v), 0, `${v} must equal itself`);
    }
    for (const a of samples) {
        for (const b of samples) {
            // `|| 0` normalizes -0 (from negating a 0 result) so strict equality holds.
            assert.equal(compareFirmware(a, b), -compareFirmware(b, a) || 0, `antisymmetry failed for ${a} vs ${b}`);
        }
    }
});

test('compareFirmware is transitive across a triple', () => {
    const a = '4.23';
    const b = '4.31.5';
    const c = '4.45.23646';
    assert.equal(compareFirmware(a, b), -1);
    assert.equal(compareFirmware(b, c), -1);
    assert.equal(compareFirmware(a, c), -1); // a<b and b<c must force a<c
});

test('compareFirmware produces a self-consistent, numerically correct sort order', () => {
    const input = ['4.45.23646', '4.9.77', '4.31', '4.23', '4.100.0', '4.31.1', '4'];
    const sorted = [...input].sort(compareFirmware);
    assert.deepEqual(sorted, ['4', '4.9.77', '4.23', '4.31', '4.31.1', '4.45.23646', '4.100.0']);
    for (let i = 1; i < sorted.length; i++) {
        assert.ok(compareFirmware(sorted[i - 1], sorted[i]) <= 0, `${sorted[i - 1]} sorted after ${sorted[i]}`);
    }
});

// --- compareFirmware: malformed and hostile input (coerced, never NaN) ---

test('compareFirmware coerces non-numeric segments to zero instead of producing NaN order', () => {
    assert.equal(compareFirmware('4.x.y', '4.0.0'), 0); // non-numeric => 0
    assert.equal(compareFirmware('4.38.', '4.38'), 0); // trailing dot => trailing empty => 0
    assert.equal(compareFirmware('4.38.23646abc', '4.38.23646'), 0); // parseInt stops at first non-digit
    assert.equal(compareFirmware('.4.38', '4.38'), -1); // leading dot shifts every segment one place right
});

test('compareFirmware parses leading zeros as base-10, not octal', () => {
    assert.equal(compareFirmware('04.038', '4.38'), 0);
    assert.equal(compareFirmware('4.010', '4.10'), 0); // '010' is ten, not eight
});

test('compareFirmware coerces empty, whitespace, and non-string inputs without throwing', () => {
    assert.equal(compareFirmware('', ''), 0);
    assert.equal(compareFirmware('', '0'), 0);
    assert.equal(compareFirmware('   ', '0.0'), 0); // whitespace-only segment => NaN => 0
    assert.equal(compareFirmware(null, undefined), 0); // String(null)/String(undefined) are non-numeric => 0
    assert.equal(compareFirmware(null, '4.0'), -1);
    assert.equal(compareFirmware(4.31, '4.31'), 0); // number coerced via String()
});

test('compareFirmware does not recognize non-ASCII digits', () => {
    // Fullwidth digit U+FF14 is not parsed by parseInt(_, 10); it collapses to 0.
    assert.equal(compareFirmware('4.４', '4.0'), 0);
    assert.equal(compareFirmware('4.４', '4.4'), -1);
});

test('compareFirmware treats an explicit negative segment as below zero', () => {
    // Not a supported input, but the ordering must stay deterministic and total.
    assert.equal(compareFirmware('4.-1', '4.0'), -1);
    assert.equal(compareFirmware('4.-1', '4.-1'), 0);
});

test('compareFirmware loses precision beyond Number.MAX_SAFE_INTEGER (needs review)', () => {
    // AMBIGUOUS: build numbers past 2^53 collide because parseInt returns an IEEE-754
    // double, so two distinct versions compare equal and strict ordering is lost. Real
    // Kobo builds are ~5 digits, so this never bites; pinning current behavior.
    const above = '4.0.9007199254740993'; // 2^53 + 1
    const at = '4.0.9007199254740992'; // 2^53
    assert.equal(compareFirmware(above, at), 0);
});

// --- meetsMinimumVersion ---

test('meetsMinimumVersion gates only a known firmware below the floor', () => {
    assert.equal(meetsMinimumVersion('4.45.23646', '4.31'), true);
    assert.equal(meetsMinimumVersion('4.31.0', '4.31'), true); // boundary equal meets the floor
    assert.equal(meetsMinimumVersion('4.31', '4.31.0'), true); // boundary equal, reversed
    assert.equal(meetsMinimumVersion('4.28.17820', '4.31'), false);
});

test('meetsMinimumVersion never gates when the floor or firmware is absent', () => {
    assert.equal(meetsMinimumVersion('4.28.17820', undefined), true);
    assert.equal(meetsMinimumVersion('4.28.17820', ''), true);
    assert.equal(meetsMinimumVersion('4.28.17820', null), true);
    assert.equal(meetsMinimumVersion(undefined, '4.31'), true);
    assert.equal(meetsMinimumVersion(null, '4.31'), true);
    assert.equal(meetsMinimumVersion('', '4.31'), true);
});

test('meetsMinimumVersion treats whitespace-only firmware as present and below the floor (needs review)', () => {
    // AMBIGUOUS: '' is treated as "unknown firmware" and passes, but a truthy
    // whitespace string is compared and coerces to 0, so it fails. Inconsistent
    // handling of "effectively empty" firmware; pinning current behavior.
    assert.equal(meetsMinimumVersion(' ', '4.31'), false);
});

// --- parseKoboVersion.isIncompatible ---

test('parseKoboVersion.isIncompatible tracks the minimum firmware boundary', () => {
    assert.equal(minimumSupportedFirmware, '4.23');
    assert.equal(parseKoboVersion(versionLine('N428000000000', '4.22.99999')).isIncompatible, true);
    assert.equal(parseKoboVersion(versionLine('N428000000000', '4.23')).isIncompatible, false); // exact floor is compatible
    assert.equal(parseKoboVersion(versionLine('N428000000000', '4.23.0')).isIncompatible, false);
    assert.equal(parseKoboVersion(versionLine('N428000000000', '4.45.23646')).isIncompatible, false);
});

test('parseKoboVersion treats a bare major-4 build below the floor as incompatible', () => {
    // "4" alone parses to 4.0.0, which is below 4.23 even though the major is 4.
    assert.equal(parseKoboVersion(versionLine('N428000000000', '4')).isIncompatible, true);
});

test('parseKoboVersion treats any non-4 major as incompatible regardless of the floor', () => {
    assert.equal(parseKoboVersion(versionLine('N428000000000', '5.0.0')).isIncompatible, true);
    assert.equal(parseKoboVersion(versionLine('N428000000000', '3.99.99999')).isIncompatible, true);
    assert.equal(parseKoboVersion(versionLine('N428000000000', 'x.50.0')).isIncompatible, true); // non-numeric major => 0
});

test('parseKoboVersion reports why an incompatible version was rejected', () => {
    assert.equal(parseKoboVersion(versionLine('N428000000000', '4.45.23646')).incompatibleReason, null);
    assert.equal(parseKoboVersion(versionLine('N428000000000', '4.22.99999')).incompatibleReason, 'too-old');
    assert.equal(parseKoboVersion(versionLine('N428000000000', '3.99.99999')).incompatibleReason, 'too-old');
    assert.equal(parseKoboVersion(versionLine('N428000000000', 'x.50.0')).incompatibleReason, 'too-old'); // non-numeric major => 0
    assert.equal(parseKoboVersion(versionLine('N428000000000', '5.0.0')).incompatibleReason, 'too-new');
    assert.equal(parseKoboVersion(versionLine('N428000000000', '5.15.245253')).incompatibleReason, 'too-new');
});
