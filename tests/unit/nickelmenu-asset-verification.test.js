import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchInstallableAsset, installableSha256 } from '../../src/js/nickelmenu/installables.js';
import { sha256Hex } from '../../src/js/shell/digest.js';

// A deploy replaces every file in place, so the same `/assets/x.zip?v=1.0` URL
// can hand a page that has been open a while the archive from a newer build.
// These cover the three ways that ends: the archive is what this build pinned,
// it is not and the app has moved on, or it is not and the app has not.

const ASSET = 'thing.zip';
const BYTES = new Uint8Array([1, 2, 3, 4, 5]);

async function withEnvironment({ manifest, responses }, fn) {
    const originalManifest = globalThis.__INSTALLABLES__;
    const originalFetch = globalThis.fetch;
    const originalVersion = globalThis.__APP_VERSION__;

    globalThis.__INSTALLABLES__ = manifest;
    globalThis.__APP_VERSION__ = '2.0';
    globalThis.fetch = async (url) => {
        const body = responses[String(url)];
        if (!body) return { ok: false, status: 404 };
        if (body.json) return { ok: true, status: 200, json: async () => body.json };
        return {
            ok: true,
            status: 200,
            body: null,
            headers: { get: () => String(body.bytes.length) },
            arrayBuffer: async () => body.bytes.buffer,
        };
    };

    try {
        await fn();
    } finally {
        globalThis.__INSTALLABLES__ = originalManifest;
        globalThis.fetch = originalFetch;
        globalThis.__APP_VERSION__ = originalVersion;
    }
}

test('a download matching the pinned digest is returned as-is', async () => {
    const digest = await sha256Hex(BYTES);
    await withEnvironment(
        {
            manifest: { thing: { version: '1.0', sha256: digest, available: true } },
            responses: { '/assets/thing.zip?v=1.0': { bytes: BYTES } },
        },
        async () => {
            assert.equal(installableSha256('thing'), digest);
            const result = await fetchInstallableAsset('thing', ASSET);
            assert.deepEqual(Array.from(result), Array.from(BYTES));
        },
    );
});

test('a download that does not match reports the update when the app has been redeployed', async () => {
    await withEnvironment(
        {
            manifest: { thing: { version: '1.0', sha256: 'a'.repeat(64), available: true } },
            responses: {
                '/assets/thing.zip?v=1.0': { bytes: BYTES },
                '/version.json': { json: { version: '2.1', bundle: 'deadbeef' } },
            },
        },
        async () => {
            await assert.rejects(fetchInstallableAsset('thing', ASSET), /has been updated/);
        },
    );
});

test('a download that does not match blames the download when the app is unchanged', async () => {
    await withEnvironment(
        {
            manifest: { thing: { version: '1.0', sha256: 'a'.repeat(64), available: true } },
            responses: {
                '/assets/thing.zip?v=1.0': { bytes: BYTES },
                '/version.json': { json: { version: '2.0', bundle: 'deadbeef' } },
            },
        },
        async () => {
            // An unreachable or matching version.json must never be reported as
            // "the app was updated": a failed download is usually just a failed
            // download, and telling the user to reload would not help.
            await assert.rejects(fetchInstallableAsset('thing', ASSET), /did not match its expected checksum/);
        },
    );
});

test('an installable with no recorded digest is downloaded without a check', async () => {
    await withEnvironment(
        {
            manifest: { thing: { version: '1.0', available: true } },
            responses: { '/assets/thing.zip?v=1.0': { bytes: BYTES } },
        },
        async () => {
            const result = await fetchInstallableAsset('thing', ASSET);
            assert.deepEqual(Array.from(result), Array.from(BYTES));
        },
    );
});
