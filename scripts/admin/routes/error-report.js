/**
 * error-report.js — the `POST /api/error` handler, kept out of `serve-dist.mjs`
 * so the HTTP logic is unit-testable with mock req/res (no real server boot).
 *
 * Contract: rate-limit abusive IPs, read the body (hard-capped), parse JSON
 * defensively, record one row via `error-store.mjs`, and **always respond 204** —
 * even on a bad body, a disabled endpoint, or a write failure — so a malformed
 * beacon can never surface as a client-side error. The server stamps `ts` (never
 * trust the client clock) and reads `user-agent` from the request header; it only
 * stores an IP after that IP crosses the abuse threshold.
 */

import { isErrorIpBanned, recordError, recordErrorIpBan } from '../error-store.mjs';

// Reject bodies larger than this. A stack trace is well under this; anything
// bigger is noise or abuse.
const MAX_BODY = 16 * 1024;

export const ERROR_REPORT_RATE_LIMIT = {
    maxRequests: 10,
    windowMs: 15 * 60 * 1000,
};

const rateWindows = new Map(); // ip -> { count, resetAt }

function headerValue(headers, name) {
    const value = headers?.[name];
    if (Array.isArray(value)) return value[0] || '';
    return value || '';
}

function normalizeIp(value) {
    const ip = String(value || '')
        .split(',')[0]
        .trim();
    if (!ip) return null;
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

export function clientIpFromRequest(req) {
    return (
        normalizeIp(headerValue(req.headers, 'cf-connecting-ip')) ||
        normalizeIp(headerValue(req.headers, 'x-real-ip')) ||
        normalizeIp(headerValue(req.headers, 'x-forwarded-for')) ||
        normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress)
    );
}

function rateLimitStatus(ip, now, { maxRequests, windowMs }) {
    if (!ip || !Number.isFinite(maxRequests) || maxRequests < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
        return { limited: false, count: 0 };
    }

    let bucket = rateWindows.get(ip);
    if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + windowMs };
        rateWindows.set(ip, bucket);
    }

    bucket.count += 1;
    return {
        limited: bucket.count > maxRequests,
        count: bucket.count,
        windowSeconds: Math.ceil(windowMs / 1000),
    };
}

export function resetErrorRateLimitsForTests() {
    rateWindows.clear();
}

export function handleErrorReport(req, res, { storageDir, enabled = true, rateLimit = ERROR_REPORT_RATE_LIMIT, now = Date.now } = {}) {
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        res.writeHead(204);
        res.end();
    };

    // Operator switch (always-on by default); still respond 204 so the client
    // can't tell logging is off.
    if (!enabled) {
        finish();
        return;
    }

    const ip = clientIpFromRequest(req);
    if (isErrorIpBanned(storageDir, ip)) {
        finish();
        req.destroy?.();
        return;
    }

    const ts = new Date().toISOString();
    const rate = rateLimitStatus(ip, typeof now === 'function' ? now() : now, rateLimit);
    if (rate.limited) {
        recordErrorIpBan(storageDir, {
            ip,
            bannedAt: ts,
            reason: 'error_report_rate_limit',
            requestCount: rate.count,
            windowSeconds: rate.windowSeconds,
        });
        finish();
        req.destroy?.();
        return;
    }

    let size = 0;
    let tooBig = false;
    const chunks = [];

    req.on('data', (chunk) => {
        if (tooBig) return;
        size += chunk.length;
        if (size > MAX_BODY) {
            tooBig = true;
            finish(); // answer now; stop reading the rest
            req.destroy();
            return;
        }
        chunks.push(chunk);
    });

    req.on('end', () => {
        if (tooBig) return;
        try {
            const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (report && typeof report === 'object' && !Array.isArray(report)) {
                recordError(storageDir, report, {
                    ts,
                    userAgent: req.headers?.['user-agent'] || null,
                });
            }
        } catch {
            // malformed body — ignore, still 204
        }
        finish();
    });

    req.on('error', finish);
}
