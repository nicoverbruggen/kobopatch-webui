/**
 * Catalog.js — discovery of the available patch catalog.
 *
 * Reads the served `patches/index.json` and flattens it into the flat
 * `{ filename, version, patches }` list the flows match a device's firmware
 * against. This is catalog lookup, not patch state — the loaded-patch model
 * lives in ui.js (PatchUI).
 */

/**
 * Scan the patches/ directory for available patch zips.
 * Returns an array of { filename, version, patches } objects.
 * Each entry in index.json may list multiple versions; these are flattened
 * so that each version gets its own entry pointing to the same filename.
 * `patches` is the file→target map kobopatch needs (formerly in kobopatch.yaml).
 */
async function scanAvailablePatches() {
    try {
        const resp = await fetch('patches/index.json');
        if (!resp.ok) return [];
        const list = await resp.json();
        const result = [];
        for (const entry of list) {
            for (const version of entry.versions) {
                result.push({ filename: entry.filename, version, patches: entry.patches || {} });
            }
        }
        return result;
    } catch (err) {
        console.error('Failed to load patch index:', err);
        return [];
    }
}

/**
 * Fetch the blacklist of incompatible patches (`patches/blacklist.json`).
 * Returns the parsed map, or null when none is served — in which case all
 * patches are allowed.
 */
async function fetchPatchBlacklist() {
    try {
        const resp = await fetch('patches/blacklist.json');
        if (resp.ok) return await resp.json();
    } catch {
        // No blacklist available — all patches are allowed.
    }
    return null;
}

function shortFirmwareVersion(version) {
    const parts = String(version || '').split('.');
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : String(version || '');
}

function compareFirmware(a, b) {
    const partsA = String(a || '')
        .split('.')
        .map((n) => parseInt(n, 10) || 0);
    const partsB = String(b || '')
        .split('.')
        .map((n) => parseInt(n, 10) || 0);
    const length = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < length; i++) {
        const segmentA = partsA[i] || 0;
        const segmentB = partsB[i] || 0;
        if (segmentA !== segmentB) return segmentA < segmentB ? -1 : 1;
    }

    return 0;
}

function latestPatchVersionForFamily(availablePatches, version) {
    const shortVersion = shortFirmwareVersion(version);
    return (
        (availablePatches || [])
            .filter((patches) => shortFirmwareVersion(patches.version) === shortVersion)
            .map((patches) => patches.version)
            .sort(compareFirmware)
            .at(-1) || version
    );
}

export { scanAvailablePatches, fetchPatchBlacklist, latestPatchVersionForFamily };
