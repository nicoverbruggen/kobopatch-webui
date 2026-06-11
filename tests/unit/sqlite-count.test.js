import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { countTableRows, bytesRange } from '../../src/js/kobo/sqlite-count.js';
import { countKoboUsers } from '../../src/js/kobo/signin.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'support', 'fixtures');
const fixture = name => new Uint8Array(readFileSync(join(fixturesDir, name)));

test('countTableRows reads the user-table row count from real SQLite fixtures', async () => {
    assert.equal(await countTableRows(bytesRange(fixture('kobo-reader-factory-reset.sqlite')), 'user'), 0);
    assert.equal(await countTableRows(bytesRange(fixture('kobo-reader-signed-in.sqlite')), 'user'), 1);
});

test('countTableRows returns null for an absent table', async () => {
    assert.equal(await countTableRows(bytesRange(fixture('kobo-reader-signed-in.sqlite')), 'does_not_exist'), null);
});

test('countTableRows returns null for non-SQLite or truncated input', async () => {
    assert.equal(await countTableRows(bytesRange(new Uint8Array([1, 2, 3, 4])), 'user'), null);
    assert.equal(await countTableRows(bytesRange(new Uint8Array(0)), 'user'), null);
    assert.equal(await countTableRows(bytesRange(null), 'user'), null);
});

test('countTableRows reads only the pages it needs, not the whole database', async () => {
    // A real KoboReader.sqlite is hundreds of MB; counting one tiny table should
    // touch a few KB. Assert we never request a range past the early pages.
    const db = fixture('kobo-reader-signed-in.sqlite');
    let maxEnd = 0;
    const trackingRange = async (offset, length) => {
        maxEnd = Math.max(maxEnd, offset + length);
        return db.subarray(offset, offset + length);
    };
    assert.equal(await countTableRows(trackingRange, 'user'), 1);
    // Generous ceiling: header + schema root + the user b-tree, well under 64 KB.
    assert.ok(maxEnd <= 64 * 1024, `read up to ${maxEnd} bytes`);
});

test('countKoboUsers reads the user count from the device, null when missing', async () => {
    const signedIn = fixture('kobo-reader-signed-in.sqlite');
    const factory = fixture('kobo-reader-factory-reset.sqlite');

    // Mirrors KoboDevice.readFileRange: slices the file, null when it's missing.
    const deviceWith = bytes => ({
        async readFileRange(_path, offset, length) {
            return bytes ? bytes.subarray(offset, offset + length) : null;
        },
    });

    assert.equal(await countKoboUsers(deviceWith(signedIn)), 1);
    assert.equal(await countKoboUsers(deviceWith(factory)), 0);
    assert.equal(await countKoboUsers(deviceWith(null)), null);
    assert.equal(await countKoboUsers(deviceWith(new Uint8Array(0))), null);
});
