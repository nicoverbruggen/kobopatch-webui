import { KoboModels } from './kobo-device.js';
import { fetchOrThrow } from '../dom.js';

let _data = null;

/**
 * Load software download URLs from the JSON manifest.
 * Can be called multiple times — subsequent calls return cached data.
 */
async function loadSoftwareUrls() {
    if (_data) return _data;
    const resp = await fetchOrThrow('/patches/downloads.json', 'Failed to load download URLs');
    _data = await resp.json();
    window.FIRMWARE_DOWNLOADS = _data;
    return _data;
}

/**
 * Get the firmware download URL for a given serial prefix and firmware version.
 * Returns null if no URL is available.
 */
function getSoftwareUrl(serialPrefix, version) {
    const data = _data || window.FIRMWARE_DOWNLOADS;
    if (!data) return null;
    const versionMap = data[version];
    if (!versionMap) return null;
    return versionMap[serialPrefix] || null;
}

/**
 * Get all device models that have firmware downloads for a given version.
 * Returns array of { prefix, model } objects.
 */
function getDevicesForVersion(version) {
    const data = _data || window.FIRMWARE_DOWNLOADS;
    if (!data) return [];
    const versionMap = data[version];
    if (!versionMap) return [];
    const devices = [];
    for (const prefix of Object.keys(versionMap)) {
        const model = KoboModels[prefix] || 'Unknown';
        devices.push({ prefix, model: model + ' (' + prefix + ')' });
    }
    return devices;
}

export { loadSoftwareUrls, getSoftwareUrl, getDevicesForVersion };
