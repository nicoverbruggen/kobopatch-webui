import test from 'node:test';
import assert from 'node:assert/strict';

import { getSoftwareUrl, hasSoftwareChannel, getChannelsForVersion, compareFirmwareChannelsDescending } from '../../src/js/kobo/software-urls.js';

// The getters read the manifest from window.FIRMWARE_DOWNLOADS (set by
// loadSoftwareUrls in the app). Seed that global directly here so the lookups
// can be tested without a network fetch.
globalThis.window = globalThis.window || {};

test('getSoftwareUrl returns the URL for a known channel + version, else null', () => {
    window.FIRMWARE_DOWNLOADS = {
        '4.45.23646': { kobo13: 'https://dl/libra-colour.zip', kobo7: 'https://dl/nia.zip' },
    };
    assert.equal(getSoftwareUrl('kobo13', '4.45.23646'), 'https://dl/libra-colour.zip');
    assert.equal(getSoftwareUrl('NOPE', '4.45.23646'), null); // unknown channel
    assert.equal(getSoftwareUrl('kobo13', '9.9.9'), null); // unknown version
});

test('getSoftwareUrl returns null when no manifest is loaded', () => {
    window.FIRMWARE_DOWNLOADS = undefined;
    assert.equal(getSoftwareUrl('kobo7', '4.45.23646'), null);
});

test('hasSoftwareChannel distinguishes unsupported models from unsupported versions', () => {
    window.FIRMWARE_DOWNLOADS = {
        _sources: ['https://example.com'],
        '4.38.23684': { kobo8: 'u1', kobo9: 'u2' },
        '4.45.23684': { kobo12: 'u3', kobo13: 'u4' },
    };

    assert.equal(hasSoftwareChannel('kobo8'), true);
    assert.equal(hasSoftwareChannel('kobo13'), true);
    assert.equal(hasSoftwareChannel('kobo3'), false);
    assert.equal(hasSoftwareChannel(null), false);
});

test('getChannelsForVersion maps channel manifests to channel labels', () => {
    window.FIRMWARE_DOWNLOADS = {
        '4.45.23646': { kobo14: 'u1', kobo12: 'u2' },
    };
    const channels = getChannelsForVersion('4.45.23646');
    assert.equal(channels.length, 2);

    assert.deepEqual(
        channels.map((c) => c.channel),
        ['kobo14', 'kobo12'],
    );

    const kobo12 = channels.find((d) => d.channel === 'kobo12');
    assert.equal(kobo12.label, 'kobo12: Kobo Clara BW (N365), Kobo Clara Colour (N367)');

    const kobo14 = channels.find((d) => d.channel === 'kobo14');
    assert.equal(kobo14.label, 'kobo14: Kobo Clara BW (P365)');
});

test('compareFirmwareChannelsDescending sorts kobo channels from newest to oldest', () => {
    const channels = ['kobo12', 'kobo3', 'kobo14', 'kobo13'];
    assert.deepEqual(channels.sort(compareFirmwareChannelsDescending), ['kobo14', 'kobo13', 'kobo12', 'kobo3']);
});

test('getChannelsForVersion returns [] for an unknown version or missing manifest', () => {
    window.FIRMWARE_DOWNLOADS = { '4.45.23646': { kobo8: 'u' } };
    assert.deepEqual(getChannelsForVersion('1.2.3'), []);

    window.FIRMWARE_DOWNLOADS = undefined;
    assert.deepEqual(getChannelsForVersion('4.45.23646'), []);
});
