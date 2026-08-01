/**
 * SideEffects.js — Patch side effects applied to `Kobo eReader.conf`.
 *
 * Some patches only work with companion conf settings; this module declares those
 * settings, selects the ones for the enabled patches, and applies/reports them.
 */

import { parseKoboConfiguration, setConfSetting } from '../kobo/Configuration.js';

const applicationPreferencesSection = 'ApplicationPreferences';

export const CLOUD_SYNC_PATCH_NAME = 'Unlock Dropbox and Google Drive support';

const patchSideEffects = [
    {
        id: 'cloud-sync-account-links',
        patchNames: [CLOUD_SYNC_PATCH_NAME],
        confSettings: [
            {
                section: applicationPreferencesSection,
                key: 'dropbox_link_account_poll',
                value: 'https://authorize.kobo.com/{region}/{language}/LinkDropbox',
            },
            {
                section: applicationPreferencesSection,
                key: 'googledrive_link_account_start',
                value: 'https://authorize.kobo.com/{region}/{language}/linkcloudstorage/provider/google_drive',
            },
            {
                section: applicationPreferencesSection,
                key: 'kobo_googledrive_link_account_enabled',
                value: 'True',
            },
            {
                section: applicationPreferencesSection,
                key: 'kobo_dropbox_link_account_enabled',
                value: 'True',
            },
        ],
    },
];

export function selectedPatchSideEffects(patchNames = []) {
    const selected = new Set(patchNames);
    return patchSideEffects.filter((effect) => effect.patchNames.some((name) => selected.has(name)));
}

export function patchSideEffectConfSettings(patchNames = []) {
    return selectedPatchSideEffects(patchNames).flatMap((effect) => effect.confSettings);
}

function existingSectionForKey(content, key) {
    for (const section of parseKoboConfiguration(content).sections) {
        if (section.settings[key]) return section.name;
    }
    return null;
}

export function applyPatchSideEffectConfSettings(content = '', settings = []) {
    let updated = content;
    for (const setting of settings) {
        const section = existingSectionForKey(updated, setting.key) || setting.section;
        updated = setConfSetting(updated, section, setting.key, setting.value);
    }
    return updated;
}
