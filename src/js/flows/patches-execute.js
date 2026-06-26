/**
 * patches-execute.js — Firmware download / extract / patch helpers.
 *
 * The execution primitives the patches flow calls: download the firmware with
 * progress, extract its original KoboRoot.tgz, run the WASM patcher, and build
 * the custom-patches manifest. Reports progress through the passed elements.
 */

import { formatBytes, fetchWithProgress } from '../shell/dom.js';
import { TL } from '../shell/strings.js';
import { AUDIT_LOG_DIRECTORY } from '../kobo/audit-log.js';
import { additionalFilesArchiveName } from '../patches/additional-files.js';
import JSZip from 'jszip';

export function appendLog(logEl, msg) {
    logEl.textContent += msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
}

export async function downloadFirmware(url, progressEl) {
    progressEl.textContent = TL.STATUS.DOWNLOADING;
    return fetchWithProgress(
        url,
        (received, total) => {
            if (!total) {
                // No Content-Length from the server: no TL constant covers this
                // size-only variant, so it is formatted inline.
                progressEl.textContent = `Downloading ${formatBytes(received)}`;
                return;
            }
            const pct = ((received / total) * 100).toFixed(0);
            progressEl.textContent = TL.STATUS.DOWNLOADING_PROGRESS(formatBytes(received), formatBytes(total), pct);
        },
        'Download failed',
    );
}

export async function extractOriginalTgz(firmwareBytes, progressEl, logFn) {
    progressEl.textContent = TL.STATUS.EXTRACTING;
    logFn('Extracting original KoboRoot.tgz from firmware...');
    const zip = await JSZip.loadAsync(firmwareBytes);
    const koboRoot = zip.file('KoboRoot.tgz');
    if (!koboRoot) throw new Error(TL.STATUS.EXTRACT_FAILED);
    const tgz = new Uint8Array(await koboRoot.async('arraybuffer'));
    logFn('Extracted KoboRoot.tgz: ' + formatBytes(tgz.length));
    return tgz;
}

export async function runPatcher(runner, configYAML, firmwareBytes, patchFiles, progressEl, logFn) {
    progressEl.textContent = TL.STATUS.APPLYING_PATCHES;
    const result = await runner.patchFirmware(configYAML, firmwareBytes, patchFiles, (msg) => {
        logFn(msg);
        const trimmed = msg.trimStart();
        if (trimmed.startsWith('Patching ') || trimmed.startsWith('Checking ') || trimmed.startsWith('Loading WASM') || trimmed.startsWith('WASM module')) {
            progressEl.textContent = trimmed;
        }
    });
    return result.tgz;
}

export function buildPatchesManifest(patchUI, firmwareVersion, selectedChannel, additionalFiles = [], archiveInfo = null) {
    const version = typeof globalThis.__APP_VERSION__ !== 'undefined' ? globalThis.__APP_VERSION__ : 'unknown';
    const manifest = {
        overrides: patchUI.getOverrides(),
        customized: patchUI.getCustomizations(),
        files: [
            { path: '.kobo/KoboRoot.tgz', type: 'file' },
            ...additionalFiles.map((file) => ({
                path: file.path,
                type: 'additional-file',
                sourceName: file.sourceName,
                size: file.size,
            })),
        ],
        meta: {
            writer: { name: 'kobopatch-webui', version },
            installed: {
                timestamp: new Date().toISOString(),
                firmware: firmwareVersion,
                channel: selectedChannel,
            },
        },
    };

    // Point a reload at the companion archive holding the Additional Files' bytes,
    // with a checksum it can verify before trusting (and re-merging) those files.
    if (additionalFiles.length > 0 && archiveInfo) {
        manifest.additionalFilesArchive = {
            path: `${AUDIT_LOG_DIRECTORY}/${additionalFilesArchiveName}`,
            sha256: archiveInfo.sha256,
            size: archiveInfo.size,
        };
    }

    return manifest;
}

export async function checkExistingTgz(device, manualMode) {
    if (manualMode || !device?.directoryHandle) return false;
    try {
        const koboDir = await device.directoryHandle.getDirectoryHandle('.kobo');
        await koboDir.getFileHandle('KoboRoot.tgz');
        return true;
    } catch {
        return false;
    }
}
