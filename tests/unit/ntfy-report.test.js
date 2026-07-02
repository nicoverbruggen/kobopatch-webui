import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { formatWeeklyReport, maybeSendWeeklyReport, ntfyConfigFromEnv, weeklyErrorStats, REPORT_INTERVAL_MS } from '../../scripts/admin/ntfy-report.mjs';
import { closeErrorStores, recordError } from '../../scripts/admin/error-store.mjs';

function tmp() {
    return mkdtempSync(join(tmpdir(), 'ntfy-report-'));
}

const NOW = Date.parse('2026-07-02T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function seedErrors(dir) {
    const at = (msAgo) => ({ ts: new Date(NOW - msAgo).toISOString() });
    recordError(dir, { sessionId: 's-1', appVersion: '1.37', kind: 'deviceWrite', message: 'write failed' }, at(HOUR));
    recordError(dir, { sessionId: 's-1', appVersion: '1.37', kind: 'deviceWrite', message: 'write failed' }, at(2 * HOUR));
    recordError(dir, { sessionId: 's-2', appVersion: '1.36', kind: 'unexpected', message: 'boom' }, at(3 * DAY));
    // Outside the 7-day window — must not be counted.
    recordError(dir, { sessionId: 's-3', appVersion: '1.30', kind: 'unexpected', message: 'old' }, at(10 * DAY));
    closeErrorStores();
}

function mockFetch({ ok = true, fail = false } = {}) {
    const calls = [];
    const impl = async (url, options) => {
        calls.push({ url, options });
        if (fail) throw new Error('network down');
        return { ok };
    };
    return { calls, impl };
}

const ENV = { NTFY_URL: 'https://ntfy.example/kobopatch' };

test('ntfyConfigFromEnv requires NTFY_URL and passes the optional token through', () => {
    assert.equal(ntfyConfigFromEnv({}), null);
    assert.equal(ntfyConfigFromEnv({ NTFY_URL: '  ' }), null);
    assert.deepEqual(ntfyConfigFromEnv(ENV), { url: 'https://ntfy.example/kobopatch', token: null });
    assert.deepEqual(ntfyConfigFromEnv({ ...ENV, NTFY_TOKEN: 'tk_secret' }), { url: 'https://ntfy.example/kobopatch', token: 'tk_secret' });
});

test('weeklyErrorStats aggregates only the requested window', () => {
    const dir = tmp();
    try {
        seedErrors(dir);
        const stats = weeklyErrorStats(dir, { since: new Date(NOW - REPORT_INTERVAL_MS), until: new Date(NOW) });

        assert.equal(stats.total, 3);
        assert.equal(stats.allTime, 4);
        assert.equal(stats.sessions, 2);
        assert.deepEqual(stats.byKind, [
            { kind: 'deviceWrite', count: 2 },
            { kind: 'unexpected', count: 1 },
        ]);
        assert.deepEqual(stats.byVersion, [
            { app_version: '1.37', count: 2 },
            { app_version: '1.36', count: 1 },
        ]);
        assert.deepEqual(stats.topMessages, [
            { message: 'write failed', count: 2 },
            { message: 'boom', count: 1 },
        ]);
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('weeklyErrorStats returns zeroed stats when the database is missing', () => {
    const dir = tmp();
    try {
        const stats = weeklyErrorStats(dir, { since: new Date(NOW - REPORT_INTERVAL_MS), until: new Date(NOW) });
        assert.equal(stats.total, 0);
        assert.equal(stats.allTime, 0);
        assert.deepEqual(stats.byKind, []);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('formatWeeklyReport summarizes a week with errors', () => {
    const stats = {
        total: 3,
        allTime: 4,
        sessions: 2,
        byKind: [
            { kind: 'deviceWrite', count: 2 },
            { kind: 'unexpected', count: 1 },
        ],
        byVersion: [{ app_version: '1.37', count: 3 }],
        topMessages: [{ message: 'write   failed\nbadly', count: 2 }],
    };
    const { title, body } = formatWeeklyReport(stats, { since: new Date(NOW - REPORT_INTERVAL_MS), until: new Date(NOW) });

    assert.equal(title, 'KoboPatch: 3 errors this week');
    assert.match(body, /Week 2026-06-25 to 2026-07-02\./);
    assert.match(body, /3 errors from 2 sessions\./);
    assert.match(body, /By kind: deviceWrite 2, unexpected 1/);
    assert.match(body, /By version: 1\.37 3/);
    assert.match(body, /- 2x write failed badly/);
    assert.match(body, /All-time total: 4\./);
});

test('formatWeeklyReport sends a heartbeat for a zero-error week', () => {
    const { title, body } = formatWeeklyReport(
        { total: 0, allTime: 9, sessions: 0, byKind: [], byVersion: [], topMessages: [] },
        { since: new Date(NOW - REPORT_INTERVAL_MS), until: new Date(NOW) },
    );
    assert.equal(title, 'KoboPatch: no errors this week');
    assert.match(body, /No client errors were reported\./);
    assert.match(body, /All-time total: 9\./);
});

test('maybeSendWeeklyReport is disabled without NTFY_URL', async () => {
    const dir = tmp();
    try {
        const { calls, impl } = mockFetch();
        const result = await maybeSendWeeklyReport({ storageDir: dir, env: {}, now: NOW, fetchImpl: impl });
        assert.deepEqual(result, { sent: false, reason: 'disabled' });
        assert.equal(calls.length, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('maybeSendWeeklyReport sends a first report and records the send time', async () => {
    const dir = tmp();
    try {
        seedErrors(dir);
        const { calls, impl } = mockFetch();
        const result = await maybeSendWeeklyReport({ storageDir: dir, env: { ...ENV, NTFY_TOKEN: 'tk_secret' }, now: NOW, fetchImpl: impl });

        assert.deepEqual(result, { sent: true, reason: 'sent' });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'https://ntfy.example/kobopatch');
        assert.equal(calls[0].options.method, 'POST');
        assert.equal(calls[0].options.headers.Title, 'KoboPatch: 3 errors this week');
        assert.equal(calls[0].options.headers.Authorization, 'Bearer tk_secret');
        assert.match(calls[0].options.body, /By kind: deviceWrite 2, unexpected 1/);

        const state = JSON.parse(readFileSync(join(dir, 'ntfy-report.json'), 'utf-8'));
        assert.equal(state.lastSentAt, new Date(NOW).toISOString());
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('maybeSendWeeklyReport skips when the last report is under a week old', async () => {
    const dir = tmp();
    try {
        writeFileSync(join(dir, 'ntfy-report.json'), JSON.stringify({ lastSentAt: new Date(NOW - 6 * DAY).toISOString() }));
        const { calls, impl } = mockFetch();
        const result = await maybeSendWeeklyReport({ storageDir: dir, env: ENV, now: NOW, fetchImpl: impl });
        assert.deepEqual(result, { sent: false, reason: 'not-due' });
        assert.equal(calls.length, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('maybeSendWeeklyReport sends again once a week has passed', async () => {
    const dir = tmp();
    try {
        writeFileSync(join(dir, 'ntfy-report.json'), JSON.stringify({ lastSentAt: new Date(NOW - 8 * DAY).toISOString() }));
        const { calls, impl } = mockFetch();
        const result = await maybeSendWeeklyReport({ storageDir: dir, env: ENV, now: NOW, fetchImpl: impl });
        assert.deepEqual(result, { sent: true, reason: 'sent' });
        assert.equal(calls.length, 1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a failed send leaves the state untouched so it retries next check', async () => {
    const dir = tmp();
    try {
        const rejected = mockFetch({ ok: false });
        assert.deepEqual(await maybeSendWeeklyReport({ storageDir: dir, env: ENV, now: NOW, fetchImpl: rejected.impl }), {
            sent: false,
            reason: 'send-failed',
        });

        const threw = mockFetch({ fail: true });
        assert.deepEqual(await maybeSendWeeklyReport({ storageDir: dir, env: ENV, now: NOW, fetchImpl: threw.impl }), {
            sent: false,
            reason: 'error',
        });

        // No state written — the next check is still "due" and sends.
        const retry = mockFetch();
        assert.deepEqual(await maybeSendWeeklyReport({ storageDir: dir, env: ENV, now: NOW, fetchImpl: retry.impl }), {
            sent: true,
            reason: 'sent',
        });
        assert.equal(retry.calls.length, 1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
