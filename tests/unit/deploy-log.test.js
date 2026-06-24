import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { logDeploy, resolveDeployInfo } from '../../scripts/deploy-log.mjs';

function tmp() {
    return mkdtempSync(join(tmpdir(), 'deploy-log-'));
}

test('logDeploy appends a boot record to <logDir>/deploy-<version>.log and returns its path', () => {
    const dir = tmp();
    try {
        const file = logDeploy({ logDir: dir, version: '1.37', commit: 'abcdef1234567', port: 8888, now: new Date('2026-06-24T13:00:00.000Z') });
        assert.equal(file, join(dir, 'deploy-1.37.log'));

        const line = readFileSync(file, 'utf-8');
        assert.match(line, /^2026-06-24T13:00:00\.000Z {2}deploy {2}version=1\.37 {2}commit=abcdef1 {2}node=/);
        assert.match(line, /port=8888\n$/);
        // Commit is shortened to 7 chars.
        assert.ok(!line.includes('abcdef1234567'));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('logDeploy appends (does not overwrite) across restarts of the same version', () => {
    const dir = tmp();
    try {
        logDeploy({ logDir: dir, version: '1.37', now: new Date('2026-06-24T13:00:00.000Z') });
        logDeploy({ logDir: dir, version: '1.37', now: new Date('2026-06-24T14:00:00.000Z') });
        const lines = readFileSync(join(dir, 'deploy-1.37.log'), 'utf-8').trim().split('\n');
        assert.equal(lines.length, 2);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('logDeploy omits the commit field when no commit is known', () => {
    const dir = tmp();
    try {
        const file = logDeploy({ logDir: dir, version: '1.37', commit: null });
        assert.ok(!readFileSync(file, 'utf-8').includes('commit='));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('logDeploy is a no-op (returns null, writes nothing) when logging is disabled', () => {
    assert.equal(logDeploy({ logDir: '', version: '1.37' }), null);
    assert.equal(logDeploy({}), null);
});

test('logDeploy never lets an unsafe version escape the log directory', () => {
    const dir = tmp();
    try {
        const file = logDeploy({ logDir: dir, version: '../../etc/passwd' });
        // Path traversal is neutralised: the separators are stripped, so the file
        // is a literal name that stays inside logDir (dots are harmless once no
        // `/` remains).
        assert.equal(file, join(dir, 'deploy-.._.._etc_passwd.log'));
        assert.deepEqual(readdirSync(dir), ['deploy-.._.._etc_passwd.log']);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('logDeploy never throws on a write failure (returns null)', () => {
    // Point logDir at a path whose parent is a file, so mkdir/append fail.
    const dir = tmp();
    try {
        const notADir = join(dir, 'afile');
        writeFileSync(notADir, 'x');
        assert.equal(logDeploy({ logDir: notADir, version: '1.37' }), null);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('resolveDeployInfo reads version from package.json and commit from .version.json (optional)', () => {
    const appDir = tmp();
    try {
        writeFileSync(join(appDir, 'package.json'), JSON.stringify({ version: '2.0' }));
        // No .version.json yet → commit is null but version still resolves.
        assert.deepEqual(resolveDeployInfo(appDir), { version: '2.0', commit: null });

        writeFileSync(join(appDir, '.version.json'), JSON.stringify({ commit: 'deadbeefcafe' }));
        assert.deepEqual(resolveDeployInfo(appDir), { version: '2.0', commit: 'deadbeefcafe' });
    } finally {
        rmSync(appDir, { recursive: true, force: true });
    }
});

test('resolveDeployInfo falls back to unknown when package.json is missing', () => {
    const appDir = tmp();
    try {
        assert.deepEqual(resolveDeployInfo(appDir), { version: 'unknown', commit: null });
    } finally {
        rmSync(appDir, { recursive: true, force: true });
    }
});
