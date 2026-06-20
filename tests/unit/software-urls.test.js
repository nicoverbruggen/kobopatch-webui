import test from 'node:test';
import assert from 'node:assert/strict';

import { getSoftwareUrl, getDevicesForVersion } from '../../src/js/kobo/software-urls.js';
import { koboModels } from '../../src/js/kobo/version.js';

// The getters read the manifest from window.FIRMWARE_DOWNLOADS (set by
// loadSoftwareUrls in the app). Seed that global directly here so the lookups
// can be tested without a network fetch.
globalThis.window = globalThis.window || {};

const knownPrefix = Object.keys(koboModels)[0];

test('getSoftwareUrl returns the URL for a known prefix + version, else null', () => {
    window.FIRMWARE_DOWNLOADS = {
        '4.45.23646': { [knownPrefix]: 'https://dl/known.zip', N306: 'https://dl/n306.zip' },
    };
    assert.equal(getSoftwareUrl(knownPrefix, '4.45.23646'), 'https://dl/known.zip');
    assert.equal(getSoftwareUrl('NOPE', '4.45.23646'), null); // unknown prefix
    assert.equal(getSoftwareUrl(knownPrefix, '9.9.9'), null); // unknown version
});

test('getSoftwareUrl treats known R-prefixed serials as refurbished variants', () => {
    window.FIRMWARE_DOWNLOADS = {
        '4.38.23648': { N418: 'https://dl/libra2.zip' },
    };

    assert.equal(getSoftwareUrl('R418', '4.38.23648'), 'https://dl/libra2.zip');
});

test('getSoftwareUrl returns null when no manifest is loaded', () => {
    window.FIRMWARE_DOWNLOADS = undefined;
    assert.equal(getSoftwareUrl('N306', '4.45.23646'), null);
});

test('getDevicesForVersion maps prefixes to model labels, falling back to Unknown', () => {
    window.FIRMWARE_DOWNLOADS = {
        '4.45.23646': { [knownPrefix]: 'u1', ZZZZ: 'u2' },
    };
    const devices = getDevicesForVersion('4.45.23646');
    assert.equal(devices.length, 2);

    const known = devices.find(d => d.prefix === knownPrefix);
    assert.equal(known.model, `${koboModels[knownPrefix]} (${knownPrefix})`);

    const unknown = devices.find(d => d.prefix === 'ZZZZ');
    assert.equal(unknown.model, 'Unknown (ZZZZ)');
});

test('getDevicesForVersion returns [] for an unknown version or missing manifest', () => {
    window.FIRMWARE_DOWNLOADS = { '4.45.23646': { N306: 'u' } };
    assert.deepEqual(getDevicesForVersion('1.2.3'), []);

    window.FIRMWARE_DOWNLOADS = undefined;
    assert.deepEqual(getDevicesForVersion('4.45.23646'), []);
});
