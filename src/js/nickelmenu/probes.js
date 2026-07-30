import { NICKELMENU_FEATURES } from './features/index.js';
import { getConfSetting, revertableConfSettings } from '../kobo/configuration.js';
import { countKoboUsers } from '../kobo/signin.js';
import { TL } from '../shell/strings.js';
import { nickelMenuManifestPath } from './constants.js';
import { parsePreviousNickelMenuConfiguration } from './previous-configuration.js';

export const NM_PRESET_CONFLICTS = [
    { id: 'nickeldbus', path: ['.adds', 'nickeldbus'], label: 'nickeldbus (.adds/nickeldbus)' },
    { id: 'nickelseries', path: ['.adds', 'nickelseries'], label: 'nickelseries (.adds/nickelseries)' },
];

export const LEGACY_ITEMS_HEURISTIC_PATTERNS = ['Legibility Status', 'Toggle Typography'];

/**
 * Extract the feature ids from a persisted NickelMenu install manifest.
 * Invalid, older, or partially written files are treated as having no usable
 * selection history; duplicate ids are collapsed while preserving order.
 */
export function parsePreviousNickelMenuSelections(text) {
    if (!text) return [];

    try {
        const selected = JSON.parse(text)?.selected;
        if (!Array.isArray(selected)) return [];
        return [...new Set(selected.filter((id) => typeof id === 'string' && id.length > 0))];
    } catch {
        return [];
    }
}

/**
 * Read the previous NickelMenu feature selection from a connected Kobo.
 * This history is only a UI hint, so a missing/unreadable manifest must never
 * block the install flow.
 */
export async function readPreviousNickelMenuSelections(state) {
    if (state.manualMode || !state.device?.directoryHandle) return [];

    try {
        return parsePreviousNickelMenuSelections(await state.device.readFile(nickelMenuManifestPath));
    } catch {
        return [];
    }
}

/**
 * Read the full previous preset configuration. A referenced custom icon is
 * copied into memory so reinstalling can preserve it without another upload.
 */
export async function readPreviousNickelMenuConfiguration(state) {
    if (state.manualMode || !state.device?.directoryHandle) return null;

    try {
        const [manifestText, presetText] = await Promise.all([
            state.device.readFile(nickelMenuManifestPath),
            state.device.readFile(['.adds', 'nm', 'webui-preset']),
        ]);
        const configuration = parsePreviousNickelMenuConfiguration(manifestText, presetText);
        if (!configuration) return null;

        if (configuration.menuIconPath) {
            const data = await state.device.readFileBytes(configuration.menuIconPath.split('/'));
            if (data) {
                const isSvg = configuration.menuIconPath.toLowerCase().endsWith('.svg');
                configuration.menuCustomization.icon = {
                    type: 'upload',
                    name: configuration.menuIconPath.split('/').pop(),
                    mimeType: isSvg ? 'image/svg+xml' : 'image/png',
                    data,
                };
            }
        }

        return configuration;
    } catch {
        return null;
    }
}

/**
 * Detect the features that are currently installed. On-device markers are
 * authoritative; features without a reliable marker fall back to the manifest
 * only while the generated preset itself is still present.
 */
export async function detectInstalledNickelMenuFeatureIds(state, previousFeatureIds = [], webuiPresetPresent = false) {
    if (state.manualMode || !state.device?.directoryHandle) return [];

    let conf = '';
    try {
        conf = (await state.device.readFile(['.kobo', 'Kobo', 'Kobo eReader.conf'])) || '';
    } catch {}

    const previous = new Set(previousFeatureIds);
    const installed = [];
    const installedConfigCache = new Map();
    for (const feature of NICKELMENU_FEATURES) {
        if (feature.installedConfig) {
            let present = false;
            for (const path of feature.installedConfig.paths) {
                const cacheKey = path.join('/');
                if (!installedConfigCache.has(cacheKey)) {
                    try {
                        installedConfigCache.set(cacheKey, (await state.device.readFile(path)) || '');
                    } catch {
                        installedConfigCache.set(cacheKey, '');
                    }
                }
                const line = installedConfigCache
                    .get(cacheKey)
                    .split(/\r?\n/)
                    .find((candidate) => candidate.trim().startsWith(`${feature.installedConfig.key}:`));
                // A zero value means the feature is installed but temporarily
                // switched off through its NickelMenu toggle.
                if (line) {
                    present = true;
                    break;
                }
            }
            if (present) installed.push(feature.id);
            continue;
        }

        const directoryPaths = (feature.directories || []).map((path) => (Array.isArray(path) ? path : path.split('/')));
        const detectionPaths = feature.installedDetect || feature.cleanup?.detect || [];
        const hasDetection =
            directoryPaths.length > 0 ||
            detectionPaths.length > 0 ||
            revertableConfSettings(feature, {
                deviceInfo: state.device?.deviceInfo,
                features: [],
            }).length > 0;

        if (!hasDetection) {
            if (webuiPresetPresent && previous.has(feature.id)) installed.push(feature.id);
            continue;
        }

        let present = false;
        for (const path of directoryPaths) {
            if (await state.device.pathExists(path)) {
                present = true;
                break;
            }
        }
        if (!present && feature.installedDetect) {
            for (const path of feature.installedDetect) {
                if (await state.device.pathExists(path)) {
                    present = true;
                    break;
                }
            }
        }
        if (!present && feature.cleanup) {
            present = await isOptionalCleanupPresent(state, feature, conf);
        }
        if (present) installed.push(feature.id);
    }

    return installed;
}

/**
 * Inspect the connected device for an existing NickelMenu install and update the
 * "remove" option + preset title accordingly. Detection results are reported via
 * the supplied callbacks so the flow keeps ownership of its DOM/state.
 *
 * @param {object} state
 * @param {object} opts
 * @param {HTMLElement} opts.presetTitleEl      The preset option title element.
 * @param {HTMLElement} opts.removeOption       The "remove" selection card.
 * @param {HTMLInputElement} opts.removeRadio   The "remove" radio.
 * @param {HTMLElement} opts.removeDesc         The "remove" description element.
 * @param {string} opts.presetTitleInstall      Title shown for a fresh install.
 * @param {string} opts.presetTitleReinstall    Title shown when a webui preset exists.
 * @param {(features: object[]) => void} [opts.onOptionalCleanupDetected]
 *        Called (once, when provided) with the optional-cleanup features present.
 * @param {(result: {detected: boolean, wasOurs: boolean}) => void} [opts.onLegacyItemsDetected]
 */
export async function checkNickelMenuInstalled(
    state,
    { presetTitleEl, removeOption, removeRadio, removeDesc, presetTitleInstall, presetTitleReinstall, onOptionalCleanupDetected, onLegacyItemsDetected },
) {
    presetTitleEl.textContent = presetTitleInstall;

    if (state.manualMode) {
        removeRadio.disabled = false;
        removeOption.classList.remove('selection-card--disabled');
        removeOption.classList.remove('selection-card--danger');
        removeDesc.textContent =
            'Shows instructions for manually removing NickelMenu from a Kobo. After following the removal steps, safely eject your Kobo and let it restart — NickelMenu will remove itself during startup.';
        return { installed: false, webuiPresetPresent: false };
    }

    removeOption.classList.add('selection-card--danger');
    const device = state.device;
    if (device.directoryHandle) {
        try {
            const addsDir = await device.directoryHandle.getDirectoryHandle('.adds');
            const nmDir = await addsDir.getDirectoryHandle('nm');
            let webuiPresetPresent = false;
            try {
                await nmDir.getFileHandle('webui-preset');
                webuiPresetPresent = true;
            } catch {
                await nmDir.getFileHandle('items');
            }
            if (webuiPresetPresent) {
                presetTitleEl.textContent = presetTitleReinstall;
            }
            removeRadio.disabled = false;
            removeOption.classList.remove('selection-card--disabled');
            removeDesc.textContent =
                'Removes NickelMenu from your device. After writing, safely eject your Kobo — it will restart and remove NickelMenu automatically.';

            if (onOptionalCleanupDetected) {
                const conf = (await device.readFile(['.kobo', 'Kobo', 'Kobo eReader.conf'])) || '';
                const detected = [];
                for (const feature of NICKELMENU_FEATURES) {
                    if (feature.cleanup?.mode !== 'optional') continue;
                    if (await isOptionalCleanupPresent(state, feature, conf)) {
                        detected.push(feature);
                    }
                }
                onOptionalCleanupDetected(detected);
            }

            if (onLegacyItemsDetected) {
                await detectLegacyItemsFile(nmDir, onLegacyItemsDetected);
            }
            return { installed: true, webuiPresetPresent };
        } catch {}
    }

    removeRadio.disabled = true;
    removeOption.classList.add('selection-card--disabled');
    removeOption.classList.add('selection-card--danger');
    removeDesc.textContent = TL.STATUS.NM_REMOVAL_DISABLED;
    return { installed: false, webuiPresetPresent: false };
}

export async function detectLegacyItemsFile(nmDir, onResult) {
    try {
        const legacyFile = await nmDir.getFileHandle('items');
        const file = await legacyFile.getFile();
        const text = await file.text();
        const wasOurs = LEGACY_ITEMS_HEURISTIC_PATTERNS.some((p) => text.includes(p));
        onResult({ detected: true, wasOurs });
    } catch {
        onResult({ detected: false, wasOurs: false });
    }
}

export async function detectPresetConflicts(state) {
    if (state.manualMode || !state.device.directoryHandle) {
        return [];
    }

    const conflicts = [];
    for (const conflict of NM_PRESET_CONFLICTS) {
        if (await state.device.pathExists(conflict.path)) {
            conflicts.push(conflict);
        }
    }
    return conflicts;
}

export async function isOptionalCleanupPresent(state, feature, conf) {
    const ctx = { deviceInfo: state.device?.deviceInfo, features: [] };
    for (const { section, key, value } of revertableConfSettings(feature, ctx)) {
        if (getConfSetting(conf, section, key) === value) return true;
    }
    for (const detectPath of feature.cleanup?.detect || []) {
        if (await state.device.pathExists(detectPath)) return true;
    }
    return false;
}

export async function getKoboUserCount(state) {
    if (state.koboUserCount !== undefined) return state.koboUserCount;
    if (state.manualMode || !state.device?.directoryHandle) {
        state.koboUserCount = null;
    } else {
        state.koboUserCount = await countKoboUsers(state.device);
    }
    return state.koboUserCount;
}
