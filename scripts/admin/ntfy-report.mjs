/**
 * ntfy-report.mjs — a weekly error digest pushed to an ntfy topic.
 *
 * Enabled by setting `NTFY_URL` to the full topic URL (e.g.
 * `https://ntfy.sh/my-topic`); `NTFY_TOKEN` optionally adds a Bearer token for
 * protected topics. The server checks hourly whether seven days have passed
 * since the last digest (tracked in `<STORAGE_DIR>/ntfy-report.json`, so the
 * cadence survives restarts and redeploys) and, when due, sends one summary of
 * the last week's rows in `errors.sqlite` — counts by kind and app version,
 * sessions affected, and the top messages. A zero-error week still sends, as a
 * heartbeat that the pipeline is alive.
 *
 * Best-effort like the deploy logger and the error store: a read, format, or
 * send failure is swallowed (the digest is retried on the next hourly check)
 * and must never affect serving. The digest contains only aggregate counts and
 * error messages — no IPs, no Kobo serials/UUIDs.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const REPORT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const TOP_MESSAGES = 3;
const MESSAGE_EXCERPT = 120;

const stateFileName = 'ntfy-report.json';

let DatabaseSync;

export function ntfyConfigFromEnv(env = process.env) {
    const url = (env.NTFY_URL || '').trim();
    if (!url) return null;
    return { url, token: (env.NTFY_TOKEN || '').trim() || null };
}

function stateFilePath(storageDir) {
    return join(storageDir, stateFileName);
}

function readReportState(storageDir) {
    try {
        const raw = readFileSync(stateFilePath(storageDir), 'utf-8');
        const state = JSON.parse(raw);
        return state && typeof state === 'object' ? state : {};
    } catch {
        return {};
    }
}

function writeReportState(storageDir, state) {
    try {
        mkdirSync(storageDir, { recursive: true });
        writeFileSync(stateFilePath(storageDir), `${JSON.stringify(state, null, 4)}\n`);
        return true;
    } catch {
        return false;
    }
}

const emptyStats = () => ({ total: 0, allTime: 0, sessions: 0, byKind: [], byVersion: [], topMessages: [] });

/**
 * Aggregate the errors recorded in [since, until) — counts by kind and app
 * version, distinct sessions, and the most frequent messages. Returns zeroed
 * stats when the database does not exist yet. Opens its own connection so the
 * error store's cached writer connection is not disturbed.
 */
export function weeklyErrorStats(storageDir, { since, until }) {
    const file = join(storageDir, 'errors.sqlite');
    if (!existsSync(file)) return emptyStats();

    if (!DatabaseSync) ({ DatabaseSync } = require('node:sqlite'));
    const db = new DatabaseSync(file, { readOnly: true });
    try {
        // ts is an ISO-8601 UTC string, so lexicographic comparison is chronological.
        const window = [since.toISOString(), until.toISOString()];
        const count = (sql, args = []) => db.prepare(sql).get(...args).count;
        // node:sqlite rows have a null prototype; normalize to plain objects.
        const plain = (rows) => rows.map((row) => ({ ...row }));
        return {
            total: count('SELECT COUNT(*) AS count FROM errors WHERE ts >= ? AND ts < ?', window),
            allTime: count('SELECT COUNT(*) AS count FROM errors'),
            sessions: count('SELECT COUNT(DISTINCT session_id) AS count FROM errors WHERE ts >= ? AND ts < ? AND session_id IS NOT NULL', window),
            byKind: plain(
                db.prepare('SELECT kind, COUNT(*) AS count FROM errors WHERE ts >= ? AND ts < ? GROUP BY kind ORDER BY count DESC, kind').all(...window),
            ),
            byVersion: plain(
                db
                    .prepare('SELECT app_version, COUNT(*) AS count FROM errors WHERE ts >= ? AND ts < ? GROUP BY app_version ORDER BY count DESC, app_version')
                    .all(...window),
            ),
            topMessages: plain(
                db
                    .prepare(
                        `SELECT message, COUNT(*) AS count FROM errors WHERE ts >= ? AND ts < ?
                         GROUP BY message ORDER BY count DESC, message LIMIT ${TOP_MESSAGES}`,
                    )
                    .all(...window),
            ),
        };
    } finally {
        db.close();
    }
}

function excerpt(message) {
    const text =
        String(message || 'No message')
            .replace(/\s+/g, ' ')
            .trim() || 'No message';
    return text.length > MESSAGE_EXCERPT ? `${text.slice(0, MESSAGE_EXCERPT)}...` : text;
}

const day = (date) => date.toISOString().slice(0, 10);

/** Compact plain-text digest — { title, body } for one ntfy notification. */
export function formatWeeklyReport(stats, { since, until }) {
    const title = stats.total === 0 ? 'KoboPatch: no errors this week' : `KoboPatch: ${stats.total} error${stats.total === 1 ? '' : 's'} this week`;

    const lines = [`Week ${day(since)} to ${day(until)}.`];
    if (stats.total === 0) {
        lines.push('No client errors were reported.');
    } else {
        lines.push(`${stats.total} error${stats.total === 1 ? '' : 's'} from ${stats.sessions} session${stats.sessions === 1 ? '' : 's'}.`);
        if (stats.byKind.length) lines.push(`By kind: ${stats.byKind.map((row) => `${row.kind || 'unknown'} ${row.count}`).join(', ')}`);
        if (stats.byVersion.length) lines.push(`By version: ${stats.byVersion.map((row) => `${row.app_version || 'unknown'} ${row.count}`).join(', ')}`);
        if (stats.topMessages.length) {
            lines.push('Top messages:');
            for (const row of stats.topMessages) lines.push(`- ${row.count}x ${excerpt(row.message)}`);
        }
    }
    lines.push(`All-time total: ${stats.allTime}.`);

    return { title, body: lines.join('\n') };
}

async function sendNtfy(config, { title, body }, fetchImpl) {
    const headers = {
        Title: title,
        Tags: 'kobopatch,chart_with_upwards_trend',
        'Content-Type': 'text/plain; charset=utf-8',
    };
    if (config.token) headers.Authorization = `Bearer ${config.token}`;
    const response = await fetchImpl(config.url, { method: 'POST', headers, body });
    return !!response?.ok;
}

/**
 * Send the weekly digest if one is due. Returns `{ sent, reason }` and never
 * throws. The state file is only advanced after a successful send, so a failed
 * push is retried on the next check.
 */
export async function maybeSendWeeklyReport({ storageDir, env = process.env, now = Date.now(), fetchImpl = fetch } = {}) {
    try {
        const config = ntfyConfigFromEnv(env);
        if (!config || !storageDir) return { sent: false, reason: 'disabled' };

        const state = readReportState(storageDir);
        const lastSentAt = Date.parse(state.lastSentAt || '');
        if (Number.isFinite(lastSentAt) && now - lastSentAt < REPORT_INTERVAL_MS) {
            return { sent: false, reason: 'not-due' };
        }

        const since = new Date(now - REPORT_INTERVAL_MS);
        const until = new Date(now);
        const report = formatWeeklyReport(weeklyErrorStats(storageDir, { since, until }), { since, until });
        if (!(await sendNtfy(config, report, fetchImpl))) return { sent: false, reason: 'send-failed' };

        writeReportState(storageDir, { ...state, lastSentAt: until.toISOString() });
        return { sent: true, reason: 'sent' };
    } catch (err) {
        console.warn(`ntfy-report: failed to send weekly report: ${err.message}`);
        return { sent: false, reason: 'error' };
    }
}

/**
 * Check on startup and then hourly whether a digest is due. No-op without
 * `NTFY_URL`. The timer is unref'd so it never keeps the process alive.
 */
export function startWeeklyReportScheduler({ storageDir, env = process.env, fetchImpl = fetch } = {}) {
    if (!ntfyConfigFromEnv(env)) return null;

    const check = () => void maybeSendWeeklyReport({ storageDir, env, fetchImpl });
    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    timer.unref?.();
    return { stop: () => clearInterval(timer) };
}
