import test from 'node:test';
import assert from 'node:assert/strict';

import { downloadProgress, fetchWithProgress } from '../../src/js/shell/Transfer.js';

const MB = 1024 * 1024;

// Build a streamable Response-like object whose body yields the given chunks.
// `contentLength` of null omits the header (the production proxy/gzip case).
function streamingResponse(chunks, { contentLength = undefined, ok = true, status = 200 } = {}) {
    const headers = new Headers();
    if (contentLength !== undefined && contentLength !== null) {
        headers.set('Content-Length', String(contentLength));
    }
    const body = new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
        },
    });
    return { ok, status, headers, body };
}

function withFetch(impl, run) {
    const original = globalThis.fetch;
    globalThis.fetch = impl;
    return Promise.resolve(run()).finally(() => {
        globalThis.fetch = original;
    });
}

// The label, byte/percent detail, and 0–1 fraction are reported as separate
// arguments so the UI can render the label, detail line, and bar independently.
test('downloadProgress reports label, detail, and fraction against the server total', () => {
    const calls = [];
    const onProgress = downloadProgress((...args) => calls.push(args), 'Downloading...');

    onProgress(5 * MB, 10 * MB);

    assert.deepEqual(calls, [['Downloading...', '5.0 MB / 10.0 MB (50%)', 0.5]]);
});

test('downloadProgress falls back to the expected size when there is no server total', () => {
    // The index.json size stands in for Content-Length so the percentage still
    // works where the proxy gzips the archive and drops the header.
    const calls = [];
    const onProgress = downloadProgress((...args) => calls.push(args), 'Downloading...', 10 * MB);

    onProgress(5 * MB, null);

    assert.deepEqual(calls, [['Downloading...', '5.0 MB / 10.0 MB (50%)', 0.5]]);
});

test('downloadProgress caps both the fraction and the byte count when the estimate is slightly low', () => {
    const calls = [];
    const onProgress = downloadProgress((...args) => calls.push(args), 'Downloading...', 10 * MB);

    onProgress(11 * MB, null);

    // Reads as finished rather than as more bytes than the download was
    // supposed to have.
    assert.deepEqual(calls, [['Downloading...', '10.0 MB / 10.0 MB (100%)', 1]]);
});

test('downloadProgress shows an indeterminate byte count with no fraction when no total is known', () => {
    const calls = [];
    const onProgress = downloadProgress((...args) => calls.push(args), 'Downloading...');

    onProgress(5 * MB, null);

    assert.deepEqual(calls, [['Downloading...', '5.0 MB', null]]);
});

test('fetchWithProgress streams chunks and reports received/total per chunk', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const calls = [];

    const bytes = await withFetch(
        async () => streamingResponse(chunks, { contentLength: 5 }),
        () => fetchWithProgress('/assets/thing.zip', (received, total) => calls.push([received, total])),
    );

    assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
    assert.deepEqual(calls, [
        [3, 5],
        [5, 5],
    ]);
});

test('fetchWithProgress keeps streaming with a null total when Content-Length is absent', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    const calls = [];

    const bytes = await withFetch(
        async () => streamingResponse(chunks, { contentLength: null }),
        () => fetchWithProgress('/assets/thing.zip', (received, total) => calls.push([received, total])),
    );

    assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
    assert.deepEqual(calls, [
        [3, null],
        [5, null],
    ]);
});

test('fetchWithProgress falls back to a single read when the body is not streamable', async () => {
    const calls = [];
    const payload = new Uint8Array([9, 8, 7]);

    const bytes = await withFetch(
        async () => ({
            ok: true,
            status: 200,
            headers: new Headers(),
            body: null,
            async arrayBuffer() {
                return payload.buffer;
            },
        }),
        () => fetchWithProgress('/assets/thing.zip', (received, total) => calls.push([received, total])),
    );

    assert.deepEqual([...bytes], [9, 8, 7]);
    assert.deepEqual(calls, []);
});

test('fetchWithProgress throws with the prefix on a non-OK response', async () => {
    await withFetch(
        async () => ({ ok: false, status: 503, headers: new Headers() }),
        async () => {
            await assert.rejects(() => fetchWithProgress('/assets/thing.zip', () => {}, 'Failed to download thing'), /Failed to download thing: HTTP 503/);
        },
    );
});
