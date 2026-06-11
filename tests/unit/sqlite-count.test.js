import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { countTableRows } from '../../src/js/kobo/sqlite-count.js';
import { countKoboUsers } from '../../src/js/kobo/signin.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'support', 'fixtures');
const fixture = name => new Uint8Array(readFileSync(join(fixturesDir, name)));

test('countTableRows reads the user-table row count from real SQLite fixtures', () => {
    assert.equal(countTableRows(fixture('kobo-reader-factory-reset.sqlite'), 'user'), 0);
    assert.equal(countTableRows(fixture('kobo-reader-signed-in.sqlite'), 'user'), 1);
});

test('countTableRows returns null for an absent table', () => {
    assert.equal(countTableRows(fixture('kobo-reader-signed-in.sqlite'), 'does_not_exist'), null);
});

test('countTableRows returns null for non-SQLite or truncated input', () => {
    assert.equal(countTableRows(new Uint8Array([1, 2, 3, 4]), 'user'), null);
    assert.equal(countTableRows(new Uint8Array(0), 'user'), null);
    assert.equal(countTableRows(null, 'user'), null);
});

test('countKoboUsers reads the user count from the device, null when missing', async () => {
    const signedIn = fixture('kobo-reader-signed-in.sqlite');
    const factory = fixture('kobo-reader-factory-reset.sqlite');

    const deviceWith = bytes => ({ async readFileBytes() { return bytes; } });

    assert.equal(await countKoboUsers(deviceWith(signedIn)), 1);
    assert.equal(await countKoboUsers(deviceWith(factory)), 0);
    assert.equal(await countKoboUsers(deviceWith(null)), null);
    assert.equal(await countKoboUsers(deviceWith(new Uint8Array(0))), null);
});
