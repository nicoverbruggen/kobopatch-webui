import { formatMB, fetchWithProgress } from '../shell/dom.js';
import JSZip from 'jszip';

export function appendLog(logEl, msg) {
    logEl.textContent += msg + '\n';
    logEl.scrollTop = logEl.scrollHeight;
}

export async function downloadFirmware(url, progressEl) {
    progressEl.textContent = 'Downloading...';
    return fetchWithProgress(
        url,
        (received, total) => {
            if (!total) {
                progressEl.textContent = `Downloading ${formatMB(received)}`;
                return;
            }
            const pct = ((received / total) * 100).toFixed(0);
            progressEl.textContent = `Downloading ${formatMB(received)} / ${formatMB(total)} (${pct}%)`;
        },
        'Download failed',
    );
}

export async function extractOriginalTgz(firmwareBytes, progressEl, logFn) {
    progressEl.textContent = 'Extracting...';
    logFn('Extracting original KoboRoot.tgz from firmware...');
    const zip = await JSZip.loadAsync(firmwareBytes);
    const koboRoot = zip.file('KoboRoot.tgz');
    if (!koboRoot) throw new Error('Could not find KoboRoot.tgz in the downloaded firmware.');
    const tgz = new Uint8Array(await koboRoot.async('arraybuffer'));
    logFn('Extracted KoboRoot.tgz: ' + formatMB(tgz.length));
    return tgz;
}

export async function runPatcher(runner, configYAML, firmwareBytes, patchFiles, progressEl, logFn) {
    progressEl.textContent = 'Applying patches...';
    const result = await runner.patchFirmware(configYAML, firmwareBytes, patchFiles, (msg) => {
        logFn(msg);
        const trimmed = msg.trimStart();
        if (trimmed.startsWith('Patching ') || trimmed.startsWith('Checking ') || trimmed.startsWith('Loading WASM') || trimmed.startsWith('WASM module')) {
            progressEl.textContent = trimmed;
        }
    });
    return result.tgz;
}

export function buildPatchesManifest(patchUI, firmwareVersion, selectedChannel, additionalFiles = []) {
    const version = typeof globalThis.__APP_VERSION__ !== 'undefined' ? globalThis.__APP_VERSION__ : 'unknown';
    return {
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
