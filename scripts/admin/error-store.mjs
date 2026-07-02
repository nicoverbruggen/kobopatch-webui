/**
 * error-store.mjs — persist client error reports to a SQLite database at
 * `<STORAGE_DIR>/errors.sqlite`, one row per report.
 *
 * Uses Node's built-in `node:sqlite` (Node ≥ 22; the production Node is pinned to
 * 24 via package.json `engines`), so there is no native dependency to compile.
 * The driver is required lazily inside `recordError`'s try/catch, so even a Node
 * without `node:sqlite` degrades to a no-op rather than crashing the server.
 *
 * Best-effort, mirroring the deploy logger and the audit log: a DB-open or insert
 * failure is swallowed (returns false), never thrown — logging must never degrade
 * the app. The privacy contract: no IPs, no Kobo serials/UUIDs, no onboard file
 * contents (the caller is responsible for not sending those).
 */

import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

import { runErrorStoreMigrations } from './migrations/index.js';

const require = createRequire(import.meta.url);

/** How long a rate-limit ban lasts. Shared IPs (NAT, campus networks) recover
 * after this window instead of losing error reporting forever. */
export const IP_BAN_DURATION_MS = 24 * 60 * 60 * 1000;

/** Error rows older than this many days are pruned on server startup. The
 * default is deliberately effectively-forever (~27 years) while report volume
 * is still unknown; tighten via ERROR_RETENTION_DAYS once real data exists. */
export const ERROR_RETENTION_DAYS = 9999;

// Per-column length caps, applied before insert so a runaway stack or hostile
// payload can't bloat the row.
const MAX = {
    ts: 32,
    sessionId: 128,
    appVersion: 64,
    kind: 64,
    message: 1024,
    stack: 8192,
    userAgent: 512,
    flowStep: 128,
    ip: 128,
    reason: 128,
};

let DatabaseSync;
const conns = new Map(); // dbFile -> prepared connection bundle

function getConn(dir) {
    if (!DatabaseSync) ({ DatabaseSync } = require('node:sqlite'));
    mkdirSync(dir, { recursive: true });
    const dbFile = join(dir, 'errors.sqlite');
    let conn = conns.get(dbFile);
    if (conn) return conn;

    const db = new DatabaseSync(dbFile);
    runErrorStoreMigrations(db);
    const insert = db.prepare(
        `INSERT INTO errors (ts, session_id, app_version, kind, message, stack, user_agent, flow_step)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const selectBan = db.prepare('SELECT banned_at FROM ip_blacklist WHERE ip = ? LIMIT 1');
    const upsertBan = db.prepare(
        `INSERT INTO ip_blacklist (ip, banned_at, reason, request_count, window_seconds)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ip) DO UPDATE SET
            banned_at = excluded.banned_at,
            reason = excluded.reason,
            request_count = excluded.request_count,
            window_seconds = excluded.window_seconds`,
    );
    conn = { db, insert, selectBan, upsertBan };
    conns.set(dbFile, conn);
    return conn;
}

/** Coerce to a string and clamp to `max` chars; pass null/undefined through. */
function clip(value, max) {
    if (value == null) return null;
    const s = String(value);
    return s.length > max ? s.slice(0, max) : s;
}

/**
 * Insert one error report. `dir` is the persistent storage directory, `report`
 * the parsed client payload, `meta` the server-derived fields (`ts`,
 * `userAgent`). Returns true on success, false on any failure (never throws).
 * The INSERT is parameterised — values are bound, never concatenated into SQL.
 */
export function recordError(dir, report = {}, meta = {}) {
    if (!dir) return false;
    try {
        const { insert } = getConn(dir);
        insert.run(
            clip(meta.ts || new Date().toISOString(), MAX.ts),
            clip(report.sessionId, MAX.sessionId),
            clip(report.appVersion, MAX.appVersion),
            clip(report.kind, MAX.kind),
            clip(report.message, MAX.message),
            clip(report.stack, MAX.stack),
            clip(meta.userAgent, MAX.userAgent),
            clip(report.flowStep, MAX.flowStep),
        );
        return true;
    } catch (err) {
        console.warn(`error-store: failed to record error: ${err.message}`);
        return false;
    }
}

export function isErrorIpBanned(dir, ip, { now = Date.now() } = {}) {
    if (!dir || !ip) return false;
    try {
        const { selectBan } = getConn(dir);
        const ban = selectBan.get(clip(ip, MAX.ip));
        if (!ban) return false;
        // Bans expire after IP_BAN_DURATION_MS rather than lasting forever; an
        // unparseable banned_at counts as expired, not as a permanent ban.
        const bannedAt = Date.parse(ban.banned_at);
        return Number.isFinite(bannedAt) && now - bannedAt < IP_BAN_DURATION_MS;
    } catch (err) {
        console.warn(`error-store: failed to check IP ban: ${err.message}`);
        return false;
    }
}

export function recordErrorIpBan(dir, ban = {}) {
    if (!dir || !ban.ip) return false;
    try {
        const { upsertBan } = getConn(dir);
        upsertBan.run(
            clip(ban.ip, MAX.ip),
            clip(ban.bannedAt || new Date().toISOString(), MAX.ts),
            clip(ban.reason, MAX.reason),
            Number.isFinite(ban.requestCount) ? ban.requestCount : null,
            Number.isFinite(ban.windowSeconds) ? ban.windowSeconds : null,
        );
        return true;
    } catch (err) {
        console.warn(`error-store: failed to record IP ban: ${err.message}`);
        return false;
    }
}

/**
 * Retention from `ERROR_RETENTION_DAYS`: unset → the 90-day default, a positive
 * integer → that many days, `0`/`off`/`false`/`no` → null (keep forever).
 */
export function retentionDaysFromEnv(env = process.env) {
    const raw = String(env.ERROR_RETENTION_DAYS ?? '').trim();
    if (!raw) return ERROR_RETENTION_DAYS;
    if (/^(0|off|false|no)$/i.test(raw)) return null;
    const days = Number.parseInt(raw, 10);
    return Number.isFinite(days) && days > 0 ? days : ERROR_RETENTION_DAYS;
}

/**
 * Startup housekeeping: delete error rows past retention (skipped when
 * `retentionDays` is null) and IP-ban rows whose ban has expired — expired bans
 * carry no state worth keeping, and dropping them keeps stored IPs short-lived.
 * Never creates the database, never throws; returns `{ errors, bans }` counts.
 */
export function pruneErrorStore(dir, { retentionDays = ERROR_RETENTION_DAYS, now = Date.now() } = {}) {
    const pruned = { errors: 0, bans: 0 };
    if (!dir || !existsSync(join(dir, 'errors.sqlite'))) return pruned;
    try {
        const { db } = getConn(dir);
        if (retentionDays > 0) {
            const cutoff = new Date(now - retentionDays * 24 * 60 * 60 * 1000).toISOString();
            pruned.errors = db.prepare('DELETE FROM errors WHERE ts < ?').run(cutoff).changes;
        }
        const banCutoff = new Date(now - IP_BAN_DURATION_MS).toISOString();
        pruned.bans = db.prepare('DELETE FROM ip_blacklist WHERE banned_at < ?').run(banCutoff).changes;
        return pruned;
    } catch (err) {
        console.warn(`error-store: failed to prune: ${err.message}`);
        return pruned;
    }
}

/** Close cached DB connections. Mainly for tests; the server keeps them open. */
export function closeErrorStores() {
    for (const { db } of conns.values()) {
        try {
            db.close();
        } catch {
            // already closed / nothing to do
        }
    }
    conns.clear();
}
