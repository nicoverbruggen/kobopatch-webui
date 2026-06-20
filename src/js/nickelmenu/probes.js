import { NICKELMENU_FEATURES } from './features/index.js';
import { getConfSetting, revertableConfSettings } from '../kobo/configuration.js';
import { countKoboUsers } from '../kobo/signin.js';

export const NM_PRESET_CONFLICTS = [
    { id: 'nickeldbus', path: ['.adds', 'nickeldbus'], label: 'nickeldbus (.adds/nickeldbus)' },
    { id: 'nickelseries', path: ['.adds', 'nickelseries'], label: 'nickelseries (.adds/nickelseries)' },
];

export const LEGACY_ITEMS_HEURISTIC_PATTERNS = ['Legibility Status', 'Toggle Typography'];

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
        return;
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
            return;
        } catch {}
    }

    removeRadio.disabled = true;
    removeOption.classList.add('selection-card--disabled');
    removeOption.classList.add('selection-card--danger');
    removeDesc.textContent = 'Removes NickelMenu from your device. Only available when a Kobo with NickelMenu installed is connected.';
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
