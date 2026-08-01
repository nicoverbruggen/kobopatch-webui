/**
 * SoftwareURLs.js — Resolves Kobo firmware (software update) download URLs.
 *
 * Maps a device hardware id + version to the official Kobo update package URL the
 * patches flow downloads and patches.
 */

import { fetchOrThrow } from '../shell/Transfer.js';
import { koboHardwareIds } from './Version.js';

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

function hardwareEntriesForChannel(channel) {
    return Object.values(koboHardwareIds).filter((info) => info.channel === channel);
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
 * Get the firmware download URL for a given firmware channel and version, or
 * null when the (channel-keyed) manifest has no matching entry.
 */
function getSoftwareUrl(channel, version) {
    const data = _data || window.FIRMWARE_DOWNLOADS;
    if (!data) return null;
    const versionMap = data[version];
    if (!versionMap) return null;
    return versionMap[channel] || null;
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
        const duplicate = item.devices.some((device) => device.model === info.model && device.serialPrefix === info.serialPrefix);
        if (!duplicate) {
            item.devices.push({
                model: info.model,
                serialPrefix: info.serialPrefix,
            });
        }
        channels.set(info.channel, item);
    };

    for (const channel of Object.keys(versionMap)) {
        const entries = hardwareEntriesForChannel(channel);
        if (entries.length === 0) {
            // A channel with no known devices (e.g. a brand-new one) still lists.
            channels.set(channel, channels.get(channel) || { channel, devices: [] });
        } else {
            for (const info of entries) addChannelEntry(info);
        }
    }

    return [...channels.values()]
        .sort((a, b) => compareFirmwareChannelsDescending(a.channel, b.channel))
        .map(({ channel, devices }) => {
            const modelList = devices.map((device) => `${device.model} (${device.serialPrefix})`).join(', ');
            return {
                channel,
                label: modelList ? `${channel}: ${modelList}` : channel,
            };
        });
}

export { loadSoftwareUrls, getSoftwareUrl, getChannelsForVersion, compareFirmwareChannelsDescending };
