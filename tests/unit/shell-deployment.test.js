import test from 'node:test';
import assert from 'node:assert/strict';

import { deployedBuildChanged } from '../../src/js/shell/deployment.js';

// The page compares itself against /version.json: its version from the build-time
// define, and its bundle hash from the `?h=` on its own script tag. The hash is
// what catches a rolling deploy that ships the same version number, which is the
// usual case, so it is worth exercising rather than trusting.

async function withPage({ version, bundleSrc, served }, fn) {
    const originals = {
        fetch: globalThis.fetch,
        document: globalThis.document,
        version: globalThis.__APP_VERSION__,
    };

    globalThis.__APP_VERSION__ = version;
    globalThis.document = bundleSrc === null ? { querySelector: () => null } : { querySelector: () => ({ getAttribute: () => bundleSrc }) };
    globalThis.fetch = async () => {
        if (served === 'unreachable') throw new Error('offline');
        if (served === 'not-found') return { ok: false, status: 404 };
        return { ok: true, status: 200, json: async () => served };
    };

    try {
        await fn();
    } finally {
        globalThis.fetch = originals.fetch;
        globalThis.document = originals.document;
        globalThis.__APP_VERSION__ = originals.version;
    }
}

const PAGE = { version: '2.0', bundleSrc: '/bundle.js?h=abc12345' };

test('an unchanged deployment reports no change', async () => {
    await withPage({ ...PAGE, served: { version: '2.0', bundle: 'abc12345' } }, async () => {
        assert.equal(await deployedBuildChanged(), false);
    });
});

test('a different version reports a change', async () => {
    await withPage({ ...PAGE, served: { version: '2.1', bundle: 'abc12345' } }, async () => {
        assert.equal(await deployedBuildChanged(), true);
    });
});

test('a different bundle hash reports a change even at the same version', async () => {
    // A rolling deploy usually ships the same version number, so this is the
    // branch that catches one.
    await withPage({ ...PAGE, served: { version: '2.0', bundle: 'ffffffff' } }, async () => {
        assert.equal(await deployedBuildChanged(), true);
    });
});

test('an unreachable version.json claims nothing', async () => {
    // A failed download is usually just a failed download; telling the user the
    // app was updated would send them to reload for no reason.
    await withPage({ ...PAGE, served: 'unreachable' }, async () => {
        assert.equal(await deployedBuildChanged(), false);
    });
    await withPage({ ...PAGE, served: 'not-found' }, async () => {
        assert.equal(await deployedBuildChanged(), false);
    });
});

test('a malformed or empty version.json claims nothing', async () => {
    await withPage({ ...PAGE, served: null }, async () => {
        assert.equal(await deployedBuildChanged(), false);
    });
    await withPage({ ...PAGE, served: {} }, async () => {
        assert.equal(await deployedBuildChanged(), false);
    });
});

test('a page that cannot find its own script tag falls back to the version alone', async () => {
    await withPage({ version: '2.0', bundleSrc: null, served: { version: '2.0', bundle: 'ffffffff' } }, async () => {
        assert.equal(await deployedBuildChanged(), false, 'no hash to compare, and the version matches');
    });
    await withPage({ version: '2.0', bundleSrc: null, served: { version: '2.1', bundle: 'ffffffff' } }, async () => {
        assert.equal(await deployedBuildChanged(), true);
    });
});
