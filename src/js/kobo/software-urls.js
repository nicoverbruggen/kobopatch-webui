import { fetchOrThrow } from '../shell/dom.js';
import { koboHardwareIds } from './version.js';

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

function hardwareEntriesForSerialPrefix(serialPrefix) {
    return Object.values(koboHardwareIds).filter(info => info.serialPrefix === serialPrefix);
}

function hardwareEntriesForChannel(channel) {
    return Object.values(koboHardwareIds).filter(info => info.channel === channel);
}

function compareFirmwareChannelsDescending(a, b) {
    const channelA = String(a).match(/^kobo(\d+)$/);
    const channelB = String(b).match(/^kobo(\d+)$/);
    if (channelA && channelB) return Number(channelB[1]) - Number(channelA[1]);
    if (channelA) return -1;
    if (channelB) return 1;
    return String(a).localeCompare(String(b));
}

/**
 * Get the firmware download URL for a given firmware channel and firmware
 * version. Older local/test manifests may still be serial-prefix keyed, so this
 * also maps channels back to their known prefixes for compatibility.
 */
function getSoftwareUrl(channel, version) {
    const data = _data || window.FIRMWARE_DOWNLOADS;
    if (!data) return null;
    const versionMap = data[version];
    if (!versionMap) return null;

    if (versionMap[channel]) return versionMap[channel];

    const matchingPrefixes = new Set(
        hardwareEntriesForChannel(channel).map(info => info.serialPrefix)
    );
    for (const [key, url] of Object.entries(versionMap)) {
        if (matchingPrefixes.has(key)) return url;
    }

    return null;
}

/**
 * Get all firmware channels that have downloads for a given version.
 * Returns array of { channel, label } objects.
 */
function getChannelsForVersion(version) {
    const data = _data || window.FIRMWARE_DOWNLOADS;
    if (!data) return [];
    const versionMap = data[version];
    if (!versionMap) return [];

    const channels = new Map();
    const addChannelEntry = (info) => {
        const item = channels.get(info.channel) || { channel: info.channel, devices: [] };
        const duplicate = item.devices.some(
            device => device.model === info.model && device.serialPrefix === info.serialPrefix
        );
        if (!duplicate) {
            item.devices.push({
                model: info.model,
                serialPrefix: info.serialPrefix,
            });
        }
        channels.set(info.channel, item);
    };

    for (const key of Object.keys(versionMap)) {
        if (key.startsWith('kobo')) {
            const entries = hardwareEntriesForChannel(key);
            if (entries.length === 0) {
                channels.set(key, channels.get(key) || { channel: key, devices: [] });
            } else {
                for (const info of entries) addChannelEntry(info);
            }
            continue;
        }

        for (const info of hardwareEntriesForSerialPrefix(key)) {
            addChannelEntry(info);
        }
    }

    return [...channels.values()]
        .sort((a, b) => compareFirmwareChannelsDescending(a.channel, b.channel))
        .map(({ channel, devices }) => {
            const modelList = devices
                .map(device => `${device.model} (${device.serialPrefix})`)
                .join(', ');
            return {
                channel,
                label: modelList ? `${channel}: ${modelList}` : channel,
            };
        });
}

export { loadSoftwareUrls, getSoftwareUrl, getChannelsForVersion, compareFirmwareChannelsDescending };
