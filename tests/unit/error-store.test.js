import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import { ERROR_STORE_MIGRATIONS } from '../../scripts/admin/migrations/index.js';
import {
    ERROR_RETENTION_DAYS,
    IP_BAN_DURATION_MS,
    closeErrorStores,
    isErrorIpBanned,
    pruneErrorStore,
    recordError,
    recordErrorIpBan,
    retentionDaysFromEnv,
} from '../../scripts/admin/error-store.mjs';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

function tmp() {
    return mkdtempSync(join(tmpdir(), 'error-store-'));
}

// Read rows back through a fresh read-only connection so we never touch the
// store's own cached connection.
function rows(dir) {
    const db = new DatabaseSync(join(dir, 'errors.sqlite'));
    try {
        return db.prepare('SELECT * FROM errors ORDER BY id').all();
    } finally {
        db.close();
    }
}

function migrations(dir) {
    const db = new DatabaseSync(join(dir, 'errors.sqlite'));
    try {
        return db.prepare('SELECT migration, batch FROM migrations ORDER BY id').all();
    } finally {
        db.close();
    }
}

function bans(dir) {
    const db = new DatabaseSync(join(dir, 'errors.sqlite'));
    try {
        return db.prepare('SELECT * FROM ip_blacklist ORDER BY id').all();
    } finally {
        db.close();
    }
}

test('recordError inserts one row with the expected columns', () => {
    const dir = tmp();
    try {
        const ok = recordError(
            dir,
            { sessionId: 's-1', appVersion: '1.37', kind: 'deviceWrite', message: 'boom', stack: 'at x', flowStep: 'nm-review' },
            { ts: '2026-06-24T13:00:00.000Z', userAgent: 'Mozilla/5.0' },
        );
        assert.equal(ok, true);

        const [row] = rows(dir);
        assert.equal(row.ts, '2026-06-24T13:00:00.000Z');
        assert.equal(row.session_id, 's-1');
        assert.equal(row.app_version, '1.37');
        assert.equal(row.kind, 'deviceWrite');
        assert.equal(row.message, 'boom');
        assert.equal(row.stack, 'at x');
        assert.equal(row.user_agent, 'Mozilla/5.0');
        assert.equal(row.flow_step, 'nm-review');
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('recordError creates the storage dir and errors.sqlite on first write', () => {
    const dir = join(tmp(), 'nested', 'storage');
    try {
        assert.equal(existsSync(join(dir, 'errors.sqlite')), false);
        recordError(dir, { kind: 'unexpected', message: 'x' });
        assert.equal(existsSync(join(dir, 'errors.sqlite')), true);
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('recordError runs and records error store migrations on first write', () => {
    const dir = tmp();
    try {
        recordError(dir, { kind: 'unexpected', message: 'x' });
        assert.deepEqual(
            migrations(dir).map((row) => row.migration),
            ERROR_STORE_MIGRATIONS.map((migration) => migration.name),
        );
        assert.deepEqual(
            migrations(dir).map((row) => row.batch),
            ERROR_STORE_MIGRATIONS.map(() => 1),
        );
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('recordError adopts a legacy errors table and does not re-run recorded migrations', () => {
    const dir = tmp();
    try {
        const db = new DatabaseSync(join(dir, 'errors.sqlite'));
        try {
            db.exec(
                `CREATE TABLE errors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts TEXT NOT NULL,
                    session_id TEXT,
                    app_version TEXT,
                    kind TEXT,
                    message TEXT,
                    stack TEXT,
                    user_agent TEXT,
                    flow_step TEXT
                )`,
            );
            db.prepare('INSERT INTO errors (ts, message) VALUES (?, ?)').run('2026-06-24T13:00:00.000Z', 'legacy');
        } finally {
            db.close();
        }

        recordError(dir, { kind: 'unexpected', message: 'new' });
        closeErrorStores();
        recordError(dir, { kind: 'unexpected', message: 'newer' });

        assert.deepEqual(
            migrations(dir).map((row) => row.migration),
            ERROR_STORE_MIGRATIONS.map((migration) => migration.name),
        );
        assert.deepEqual(
            rows(dir).map((row) => row.message),
            ['legacy', 'new', 'newer'],
        );
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('recordErrorIpBan stores abusive IPs separately from normal error rows', () => {
    const dir = tmp();
    try {
        const now = Date.parse('2026-06-24T14:00:00.000Z');
        assert.equal(isErrorIpBanned(dir, '203.0.113.10', { now }), false);
        assert.equal(
            recordErrorIpBan(dir, {
                ip: '203.0.113.10',
                bannedAt: '2026-06-24T13:00:00.000Z',
                reason: 'error_report_rate_limit',
                requestCount: 61,
                windowSeconds: 600,
            }),
            true,
        );

        const [ban] = bans(dir);
        assert.equal(ban.ip, '203.0.113.10');
        assert.equal(ban.reason, 'error_report_rate_limit');
        assert.equal(ban.request_count, 61);
        assert.equal(ban.window_seconds, 600);
        assert.equal(isErrorIpBanned(dir, '203.0.113.10', { now }), true);
        assert.deepEqual(rows(dir), []);
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('an IP ban expires after IP_BAN_DURATION_MS instead of lasting forever', () => {
    const dir = tmp();
    try {
        const bannedAt = '2026-06-24T13:00:00.000Z';
        recordErrorIpBan(dir, { ip: '203.0.113.10', bannedAt, reason: 'error_report_rate_limit' });

        const banned = Date.parse(bannedAt);
        assert.equal(isErrorIpBanned(dir, '203.0.113.10', { now: banned + IP_BAN_DURATION_MS - 1 }), true);
        assert.equal(isErrorIpBanned(dir, '203.0.113.10', { now: banned + IP_BAN_DURATION_MS }), false);

        // A fresh offence re-arms the ban via the upsert.
        const later = new Date(banned + 2 * IP_BAN_DURATION_MS).toISOString();
        recordErrorIpBan(dir, { ip: '203.0.113.10', bannedAt: later, reason: 'error_report_rate_limit' });
        assert.equal(isErrorIpBanned(dir, '203.0.113.10', { now: Date.parse(later) + 1 }), true);
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('pruneErrorStore drops rows past retention and expired bans, keeps the rest', () => {
    const dir = tmp();
    try {
        const now = Date.parse('2026-07-02T12:00:00.000Z');
        const daysAgo = (days) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
        recordError(dir, { kind: 'unexpected', message: 'ancient' }, { ts: daysAgo(120) });
        recordError(dir, { kind: 'unexpected', message: 'recent' }, { ts: daysAgo(5) });
        recordErrorIpBan(dir, { ip: '203.0.113.10', bannedAt: daysAgo(3), reason: 'error_report_rate_limit' });
        recordErrorIpBan(dir, { ip: '203.0.113.11', bannedAt: new Date(now - 60_000).toISOString(), reason: 'error_report_rate_limit' });

        const pruned = pruneErrorStore(dir, { retentionDays: 90, now });
        assert.deepEqual(pruned, { errors: 1, bans: 1 });
        assert.deepEqual(
            rows(dir).map((row) => row.message),
            ['recent'],
        );
        assert.deepEqual(
            bans(dir).map((row) => row.ip),
            ['203.0.113.11'],
        );

        // retentionDays null keeps error rows but still drops expired bans.
        recordError(dir, { kind: 'unexpected', message: 'ancient 2' }, { ts: daysAgo(120) });
        assert.deepEqual(pruneErrorStore(dir, { retentionDays: null, now }), { errors: 0, bans: 0 });
        assert.equal(rows(dir).length, 2);
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('pruneErrorStore never creates a database and retentionDaysFromEnv parses the env', () => {
    const dir = tmp();
    try {
        assert.deepEqual(pruneErrorStore(dir, { retentionDays: 90 }), { errors: 0, bans: 0 });
        assert.equal(existsSync(join(dir, 'errors.sqlite')), false);

        assert.equal(retentionDaysFromEnv({}), ERROR_RETENTION_DAYS);
        assert.equal(retentionDaysFromEnv({ ERROR_RETENTION_DAYS: '30' }), 30);
        assert.equal(retentionDaysFromEnv({ ERROR_RETENTION_DAYS: '0' }), null);
        assert.equal(retentionDaysFromEnv({ ERROR_RETENTION_DAYS: 'off' }), null);
        assert.equal(retentionDaysFromEnv({ ERROR_RETENTION_DAYS: 'garbage' }), ERROR_RETENTION_DAYS);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('recordError truncates oversized message and stack', () => {
    const dir = tmp();
    try {
        recordError(dir, { kind: 'unexpected', message: 'm'.repeat(5000), stack: 's'.repeat(20000) });
        const [row] = rows(dir);
        assert.equal(row.message.length, 1024);
        assert.equal(row.stack.length, 8192);
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('recordError stores missing fields as NULL and stamps ts when absent', () => {
    const dir = tmp();
    try {
        recordError(dir, { kind: 'unexpected', message: 'only message' });
        const [row] = rows(dir);
        assert.equal(row.session_id, null);
        assert.equal(row.app_version, null);
        assert.equal(row.stack, null);
        assert.equal(row.user_agent, null);
        assert.equal(row.flow_step, null);
        assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T/); // server-stamped ISO
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('recordError binds values (SQL injection in a field is stored literally)', () => {
    const dir = tmp();
    try {
        const evil = "'); DROP TABLE errors;--";
        recordError(dir, { kind: 'unexpected', message: evil });
        const all = rows(dir);
        // The table survives and the payload is stored verbatim, proving the
        // value was bound, not concatenated into SQL.
        assert.equal(all.length, 1);
        assert.equal(all[0].message, evil);
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('recordError is a no-op (false) when storage dir is falsy, never throws', () => {
    assert.equal(recordError('', { message: 'x' }), false);
    assert.equal(recordError(null, { message: 'x' }), false);
});

test('recordError appends across calls', () => {
    const dir = tmp();
    try {
        recordError(dir, { kind: 'unexpected', message: 'a' });
        recordError(dir, { kind: 'deviceWrite', message: 'b' });
        assert.equal(rows(dir).length, 2);
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});
