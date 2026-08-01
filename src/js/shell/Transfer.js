/**
 * Transfer.js — moving bytes in and out of the app.
 *
 * Fetching with progress, rendering that progress, and handing a finished blob
 * to the browser as a download. Split out of `dom.js`, which was a grab-bag: two
 * of these never touch an element at all, and together they are the one cluster
 * in that file that is not about the DOM.
 *
 * `formatBytes` stays with the DOM helpers and is imported back here — a single
 * edge, and not a cycle, because nothing in `dom.js` reaches this way.
 */

import { formatBytes } from './DOM.js';

/** Fetch with automatic error throwing on non-OK responses. */
export async function fetchOrThrow(url, errorPrefix = 'Fetch failed') {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${errorPrefix}: HTTP ${resp.status}`);
    return resp;
}

/**
 * Fetch a URL as bytes while reporting download progress.
 *
 * Whenever the body is streamable, it is read chunk by chunk and
 * `onProgress(received, total)` fires after each chunk. `total` is the parsed
 * Content-Length when present, or `null` when it isn't — which is the common case
 * in production: a proxy/CDN serving these archives with `Content-Encoding: gzip`
 * drops Content-Length (the header would describe the compressed size, while the
 * stream we read is the decompressed body), so the browser reports no length even
 * though `curl -I` (which sends no Accept-Encoding) sees one. We must keep
 * streaming in that case and let callers show byte counts without a percentage;
 * bailing to a single read here is what left the progress label frozen. Only when
 * `resp.body` is entirely unavailable do we fall back to a single-shot read with
 * no progress callbacks. Returns a `Uint8Array` of the full payload.
 */
export async function fetchWithProgress(url, onProgress, errorPrefix = 'Download failed') {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${errorPrefix}: HTTP ${resp.status}`);

    if (!resp.body) {
        // No streaming available — download in one shot.
        return new Uint8Array(await resp.arrayBuffer());
    }

    const contentLength = resp.headers?.get?.('Content-Length');
    const total = contentLength ? parseInt(contentLength, 10) : null;
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (onProgress) onProgress(received, total);
    }

    // Reassemble chunks into a single Uint8Array.
    const result = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

/**
 * Build an `onProgress(received, total)` handler for `fetchWithProgress` that
 * reports download progress through `report(label, detail, fraction)`.
 *
 * `label` stays put (e.g. "Downloading KOReader..."); the moving byte count rides
 * the separate `detail` line, with `fraction` (0–1) driving a progress bar.
 *
 * The percentage is measured against the best total available: the server's
 * Content-Length when present, else `expectedTotal` — the size baked into
 * /assets/index.json. That fallback is what keeps the percentage working in
 * production, where the proxy serves these archives gzip-encoded and strips
 * Content-Length. Only with neither does it show the indeterminate "X.X MB" with
 * no bar (`fraction` null). Both the fraction and the byte count are capped, so a
 * slightly-low estimate reads as finished rather than as "5.0 MB / 4.0 MB (100%)".
 */
export function downloadProgress(report, label, expectedTotal = null) {
    return (received, total) => {
        const knownTotal = total || expectedTotal;
        if (knownTotal) {
            const fraction = Math.min(1, received / knownTotal);
            const pct = (fraction * 100).toFixed(0);
            report(label, `${formatBytes(Math.min(received, knownTotal))} / ${formatBytes(knownTotal)} (${pct}%)`, fraction);
        } else {
            report(label, formatBytes(received), null);
        }
    };
}

/**
 * Render the secondary progress line of a `.busy-progress` container: the byte
 * count text and, when a 0–1 `fraction` is given, a filled progress bar. A null
 * `detail` hides the whole line (non-download steps that only set a status); a
 * null `fraction` keeps the line but drops the bar (indeterminate downloads).
 */
export function setProgressDetail(container, detail, fraction = null) {
    if (!container) return;
    container.hidden = !detail;
    if (!detail) return;

    const text = container.querySelector('.busy-progress-text');
    if (text) text.textContent = detail;

    const track = container.querySelector('.busy-progress-track');
    const fill = container.querySelector('.busy-progress-fill');
    const determinate = fraction !== null && fraction !== undefined;
    if (track) track.hidden = !determinate;
    if (fill && determinate) fill.style.width = `${(fraction * 100).toFixed(1)}%`;
}

/**
 * Trigger a browser download of in-memory data.
 * Creates a temporary object URL, clicks a hidden <a>, then revokes it.
 */
export function triggerDownload(data, filename, mimeType) {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
