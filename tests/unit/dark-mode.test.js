import test from 'node:test';
import assert from 'node:assert/strict';

import { darkModeSupport, darkModeUnsupportedHardwareIds } from '../../src/js/kobo/dark-mode.js';
import { koboHardwareIds, parseKoboVersion } from '../../src/js/kobo/version.js';

const AURA_HD_UUID = '00000000-0000-0000-0000-000000000350'; // N204, no Dark mode
const LIBRA_COLOUR_UUID = '00000000-0000-0000-0000-000000000390'; // N428, supports Dark mode

test('darkModeSupport reports unknown when there is no device info', () => {
    assert.equal(darkModeSupport(null), 'unknown');
    assert.equal(darkModeSupport(undefined), 'unknown');
});

test('darkModeSupport reports unsupported for a blacklisted hardware UUID', () => {
    assert.equal(darkModeSupport({ hardwareId: AURA_HD_UUID }), 'unsupported');
});

test('darkModeSupport reports supported for a newer hardware UUID', () => {
    assert.equal(darkModeSupport({ hardwareId: LIBRA_COLOUR_UUID }), 'supported');
});

test('darkModeSupport assumes support for an unrecognised UUID (blacklist, not allowlist)', () => {
    assert.equal(darkModeSupport({ hardwareId: '00000000-0000-0000-0000-000000099999' }), 'supported');
});

test('darkModeSupport keys on the UUID, not the serial prefix', () => {
    // A device whose serial prefix matches an unsupported model (N204) but whose
    // UUID is a supported device must still be reported as supported.
    assert.equal(darkModeSupport({ hardwareId: LIBRA_COLOUR_UUID, serialPrefix: 'N204' }), 'supported');
});

test('every blacklisted UUID is a known Kobo hardware id', () => {
    for (const uuid of darkModeUnsupportedHardwareIds) {
        assert.ok(koboHardwareIds[uuid], `${uuid} should exist in koboHardwareIds`);
    }
});

test('darkModeSupport works on a deviceInfo produced by parseKoboVersion', () => {
    const auraHd = parseKoboVersion(`N204E0000000000,4.9.77,4.45.23646,4.9.77,4.9.77,${AURA_HD_UUID}`);
    assert.equal(darkModeSupport(auraHd), 'unsupported');

    const libraColour = parseKoboVersion(`N428000000000,4.9.77,4.45.23646,4.9.77,4.9.77,${LIBRA_COLOUR_UUID}`);
    assert.equal(darkModeSupport(libraColour), 'supported');
});
