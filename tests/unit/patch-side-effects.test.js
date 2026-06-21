import test from 'node:test';
import assert from 'node:assert/strict';

import {
    CLOUD_SYNC_PATCH_NAME,
    applyPatchSideEffectConfSettings,
    patchSideEffectConfSettings,
    selectedPatchSideEffects,
} from '../../src/js/patches/side-effects.js';

test('selectedPatchSideEffects returns no effects for unrelated patches', () => {
    assert.deepEqual(selectedPatchSideEffects(['Remove footer (row3) on new home screen']), []);
    assert.deepEqual(patchSideEffectConfSettings(['Remove footer (row3) on new home screen']), []);
});

test('cloud sync patch contributes the required Kobo eReader.conf settings', () => {
    const settings = patchSideEffectConfSettings([CLOUD_SYNC_PATCH_NAME]);

    assert.deepEqual(settings, [
        {
            section: 'ApplicationPreferences',
            key: 'dropbox_link_account_poll',
            value: 'https://authorize.kobo.com/{region}/{language}/LinkDropbox',
        },
        {
            section: 'ApplicationPreferences',
            key: 'googledrive_link_account_start',
            value: 'https://authorize.kobo.com/{region}/{language}/linkcloudstorage/provider/google_drive',
        },
        {
            section: 'ApplicationPreferences',
            key: 'kobo_googledrive_link_account_enabled',
            value: 'True',
        },
        {
            section: 'ApplicationPreferences',
            key: 'kobo_dropbox_link_account_enabled',
            value: 'True',
        },
    ]);
});

test('applyPatchSideEffectConfSettings inserts missing settings into ApplicationPreferences', () => {
    const updated = applyPatchSideEffectConfSettings('[General]\nsome=setting\n', patchSideEffectConfSettings([CLOUD_SYNC_PATCH_NAME]));

    assert.equal(
        updated,
        [
            '[General]',
            'some=setting',
            '',
            '[ApplicationPreferences]',
            'kobo_dropbox_link_account_enabled=True',
            'kobo_googledrive_link_account_enabled=True',
            'googledrive_link_account_start=https://authorize.kobo.com/{region}/{language}/linkcloudstorage/provider/google_drive',
            'dropbox_link_account_poll=https://authorize.kobo.com/{region}/{language}/LinkDropbox',
            '',
        ].join('\n'),
    );
});

test('applyPatchSideEffectConfSettings updates existing keys in their current section', () => {
    const initial = [
        '[ApplicationPreferences]',
        'dropbox_link_account_poll=',
        'googledrive_link_account_start=',
        '[FeatureSettings]',
        'kobo_googledrive_link_account_enabled=False',
        'kobo_dropbox_link_account_enabled=False',
        '',
    ].join('\n');

    const updated = applyPatchSideEffectConfSettings(initial, patchSideEffectConfSettings([CLOUD_SYNC_PATCH_NAME]));

    assert.equal(
        updated,
        [
            '[ApplicationPreferences]',
            'dropbox_link_account_poll=https://authorize.kobo.com/{region}/{language}/LinkDropbox',
            'googledrive_link_account_start=https://authorize.kobo.com/{region}/{language}/linkcloudstorage/provider/google_drive',
            '[FeatureSettings]',
            'kobo_googledrive_link_account_enabled=True',
            'kobo_dropbox_link_account_enabled=True',
            '',
        ].join('\n'),
    );
});
