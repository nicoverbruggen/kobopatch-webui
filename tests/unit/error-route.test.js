import test from 'node:test';
import assert from 'node:assert/strict';

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import { ERROR_REPORT_RATE_LIMIT, clientIpFromRequest, handleErrorReport, resetErrorRateLimitsForTests } from '../../scripts/admin/routes/error-report.js';
import { closeErrorStores } from '../../scripts/admin/error-store.mjs';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');

function tmp() {
    return mkdtempSync(join(tmpdir(), 'error-route-'));
}

function rows(dir) {
    const file = join(dir, 'errors.sqlite');
    // Nothing stored → the DB was never created; treat as zero rows.
    if (!existsSync(file)) return [];
    const db = new DatabaseSync(file);
    try {
        return db.prepare('SELECT * FROM errors ORDER BY id').all();
    } finally {
        db.close();
    }
}

function bans(dir) {
    const file = join(dir, 'errors.sqlite');
    if (!existsSync(file)) return [];
    const db = new DatabaseSync(file);
    try {
        return db.prepare('SELECT * FROM ip_blacklist ORDER BY id').all();
    } finally {
        db.close();
    }
}

// Minimal mock request: an EventEmitter with headers and a destroy() spy.
function mockReq(headers = {}, remoteAddress = '203.0.113.10') {
    const req = new EventEmitter();
    req.headers = headers;
    req.socket = { remoteAddress };
    req.destroyed = false;
    req.destroy = () => {
        req.destroyed = true;
    };
    return req;
}

function sendReport(dir, body, options = {}) {
    const req = mockReq(options.headers || {}, options.remoteAddress);
    const res = mockRes();
    handleErrorReport(req, res, { storageDir: dir, enabled: true, ...options.handlerOptions });
    send(req, body);
    return { req, res };
}

// Minimal mock response capturing the status and that end() was called once.
function mockRes() {
    return {
        statusCode: null,
        ended: 0,
        writeHead(code) {
            this.statusCode = code;
        },
        end() {
            this.ended += 1;
        },
    };
}

// Drive a body through the handler synchronously (emit then end).
function send(req, body) {
    if (body != null) req.emit('data', Buffer.from(body));
    req.emit('end');
}

test('valid report → 204 and one row stored with server-stamped ts + UA from header', () => {
    const dir = tmp();
    try {
        const req = mockReq({ 'user-agent': 'TestAgent/1.0' });
        const res = mockRes();
        handleErrorReport(req, res, { storageDir: dir, enabled: true });
        send(req, JSON.stringify({ sessionId: 's1', kind: 'unexpected', message: 'boom', appVersion: '1.37' }));

        assert.equal(res.statusCode, 204);
        assert.equal(res.ended, 1);

        const all = rows(dir);
        assert.equal(all.length, 1);
        assert.equal(all[0].message, 'boom');
        assert.equal(all[0].user_agent, 'TestAgent/1.0');
        assert.match(all[0].ts, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
        resetErrorRateLimitsForTests();
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the client cannot set ts or user_agent via the body (server controls them)', () => {
    const dir = tmp();
    try {
        const req = mockReq({ 'user-agent': 'RealUA' });
        const res = mockRes();
        handleErrorReport(req, res, { storageDir: dir, enabled: true });
        send(req, JSON.stringify({ kind: 'unexpected', message: 'x', ts: 'FORGED', userAgent: 'SpoofUA' }));

        const [row] = rows(dir);
        assert.notEqual(row.ts, 'FORGED');
        assert.equal(row.user_agent, 'RealUA');
    } finally {
        resetErrorRateLimitsForTests();
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('disabled endpoint → 204 and nothing stored', () => {
    const dir = tmp();
    try {
        const req = mockReq();
        const res = mockRes();
        handleErrorReport(req, res, { storageDir: dir, enabled: false });
        send(req, JSON.stringify({ kind: 'unexpected', message: 'x' }));

        assert.equal(res.statusCode, 204);
        assert.equal(rows(dir).length, 0);
    } finally {
        resetErrorRateLimitsForTests();
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('malformed JSON body → 204, nothing stored, no throw', () => {
    const dir = tmp();
    try {
        const req = mockReq();
        const res = mockRes();
        handleErrorReport(req, res, { storageDir: dir, enabled: true });
        send(req, '{ not json');

        assert.equal(res.statusCode, 204);
        assert.equal(rows(dir).length, 0);
    } finally {
        resetErrorRateLimitsForTests();
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('oversized body → 204, request destroyed, nothing stored', () => {
    const dir = tmp();
    try {
        const req = mockReq();
        const res = mockRes();
        handleErrorReport(req, res, { storageDir: dir, enabled: true });
        // One chunk over the 16 KB cap.
        req.emit('data', Buffer.alloc(16 * 1024 + 1, 0x61));
        // A late 'end' must not double-respond.
        req.emit('end');

        assert.equal(res.statusCode, 204);
        assert.equal(res.ended, 1);
        assert.equal(req.destroyed, true);
        assert.equal(rows(dir).length, 0);
    } finally {
        resetErrorRateLimitsForTests();
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a JSON body that is not an object (e.g. a bare array) stores nothing', () => {
    const dir = tmp();
    try {
        const req = mockReq();
        const res = mockRes();
        handleErrorReport(req, res, { storageDir: dir, enabled: true });
        send(req, JSON.stringify([1, 2, 3]));

        assert.equal(res.statusCode, 204);
        assert.equal(rows(dir).length, 0);
    } finally {
        resetErrorRateLimitsForTests();
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('clientIpFromRequest prefers trusted proxy-style headers and normalizes IPv4-mapped addresses', () => {
    assert.equal(clientIpFromRequest(mockReq({ 'cf-connecting-ip': '198.51.100.1' })), '198.51.100.1');
    assert.equal(clientIpFromRequest(mockReq({ 'x-real-ip': '198.51.100.2' })), '198.51.100.2');
    assert.equal(clientIpFromRequest(mockReq({ 'x-forwarded-for': '198.51.100.3, 10.0.0.1' })), '198.51.100.3');
    assert.equal(clientIpFromRequest(mockReq({}, '::ffff:198.51.100.4')), '198.51.100.4');
});

test('default error report rate limit is 10 requests per 15 minutes', () => {
    assert.deepEqual(ERROR_REPORT_RATE_LIMIT, {
        maxRequests: 10,
        windowMs: 15 * 60 * 1000,
    });
});

test('too many error reports from one IP stores a ban and drops later reports', () => {
    const dir = tmp();
    try {
        const handlerOptions = { rateLimit: { maxRequests: 2, windowMs: 60_000 }, now: () => 1_000 };
        sendReport(dir, JSON.stringify({ kind: 'unexpected', message: 'one' }), {
            headers: { 'x-forwarded-for': '198.51.100.20' },
            handlerOptions,
        });
        sendReport(dir, JSON.stringify({ kind: 'unexpected', message: 'two' }), {
            headers: { 'x-forwarded-for': '198.51.100.20' },
            handlerOptions,
        });
        const limited = sendReport(dir, JSON.stringify({ kind: 'unexpected', message: 'three' }), {
            headers: { 'x-forwarded-for': '198.51.100.20' },
            handlerOptions,
        });
        const banned = sendReport(dir, JSON.stringify({ kind: 'unexpected', message: 'four' }), {
            headers: { 'x-forwarded-for': '198.51.100.20' },
            handlerOptions,
        });

        assert.equal(limited.res.statusCode, 204);
        assert.equal(limited.req.destroyed, true);
        assert.equal(banned.res.statusCode, 204);
        assert.equal(banned.req.destroyed, true);
        assert.deepEqual(
            rows(dir).map((row) => row.message),
            ['one', 'two'],
        );

        const [ban] = bans(dir);
        assert.equal(ban.ip, '198.51.100.20');
        assert.equal(ban.reason, 'error_report_rate_limit');
        assert.equal(ban.request_count, 3);
        assert.equal(ban.window_seconds, 60);
    } finally {
        resetErrorRateLimitsForTests();
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});
