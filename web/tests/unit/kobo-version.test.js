import test from 'node:test';
import assert from 'node:assert/strict';

import { parseKoboVersion } from '../../src/js/domain/kobo-version.js';

const HARDWARE_ID = '00000000-0000-0000-0000-000000000390';

function versionLine(serial, firmware) {
    return `${serial},4.9.77,${firmware},4.9.77,4.9.77,${HARDWARE_ID}`;
}

test('parseKoboVersion reads known 4-character device prefixes', () => {
    assert.deepEqual(parseKoboVersion(versionLine('N4284B5215352', '4.45.23646')), {
        serial: 'N4284B5215352',
        serialPrefix: 'N428',
        firmware: '4.45.23646',
        hardwareId: HARDWARE_ID,
        model: 'Kobo Libra Colour',
        isIncompatible: false,
    });
});

test('parseKoboVersion reads known older 4-character prefixes', () => {
    const info = parseKoboVersion(versionLine('N905ABC123456', '4.38.21908'));

    assert.equal(info.serialPrefix, 'N905');
    assert.equal(info.model, 'Kobo Touch');
});

test('parseKoboVersion reports unknown models with the first 4 serial characters', () => {
    const info = parseKoboVersion(versionLine('Z999ABC123456', '4.38.21908'));

    assert.equal(info.serialPrefix, 'Z99');
    assert.equal(info.model, 'Unknown Kobo (Z999)');
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
