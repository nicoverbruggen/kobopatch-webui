/**
 * admin.js — authenticated admin views/downloads for persisted server
 * data. Disabled unless ADMIN_USERNAME and ADMIN_PASSWORD are configured.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { IP_BAN_DURATION_MS } from '../error-store.mjs';

const require = createRequire(import.meta.url);
const REALM = 'KoboPatch Web UI admin';
const PAGE_SIZE = 50;
const BAN_LIST_LIMIT = 50;

let DatabaseSync;

function text(res, statusCode, body, headers = {}) {
    const data = body ? Buffer.from(body, 'utf-8') : null;
    res.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        ...(data ? { 'Content-Length': data.length } : {}),
        ...headers,
    });
    res.end(data);
}

function html(res, statusCode, body, { head = false } = {}) {
    const data = Buffer.from(body, 'utf-8');
    res.writeHead(statusCode, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': data.length,
        'X-Content-Type-Options': 'nosniff',
        // The page renders attacker-supplied error text (escaped); a strict CSP
        // is the second layer if an escaping bug ever slips in. The page itself
        // needs nothing but its inline <style>.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
    });
    res.end(head ? null : data);
}

function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    const len = Math.max(left.length, right.length);
    const leftPadded = Buffer.alloc(len);
    const rightPadded = Buffer.alloc(len);
    left.copy(leftPadded);
    right.copy(rightPadded);
    return timingSafeEqual(leftPadded, rightPadded) && left.length === right.length;
}

export function adminCredentialsFromEnv(env = process.env) {
    const username = env.ADMIN_USERNAME;
    const password = env.ADMIN_PASSWORD;
    if (!username || !password) return null;
    return { username, password };
}

export function parseBasicAuth(header) {
    if (typeof header !== 'string') return null;
    const match = header.match(/^Basic\s+(.+)$/i);
    if (!match) return null;
    let decoded;
    try {
        decoded = Buffer.from(match[1], 'base64').toString('utf-8');
    } catch {
        return null;
    }
    const split = decoded.indexOf(':');
    if (split < 0) return null;
    return {
        username: decoded.slice(0, split),
        password: decoded.slice(split + 1),
    };
}

export function isAdminAuthorized(headers = {}, credentials = null) {
    if (!credentials) return false;
    const auth = parseBasicAuth(headers.authorization);
    if (!auth) return false;
    return safeEqual(auth.username, credentials.username) && safeEqual(auth.password, credentials.password);
}

function unauthorized(res) {
    text(res, 401, 'Authentication required\n', {
        'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
    });
}

function checkAdmin(req, res, credentials) {
    if (!credentials) {
        text(res, 404, 'Not found\n');
        return false;
    }

    if (!isAdminAuthorized(req.headers, credentials)) {
        unauthorized(res);
        return false;
    }

    return true;
}

function methodAllowed(req, res) {
    if (req.method === 'GET' || req.method === 'HEAD') return true;
    text(res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
    return false;
}

function errorsDbPath(storageDir) {
    return join(storageDir, 'errors.sqlite');
}

function pageFromUrl(url) {
    const raw = url.searchParams.get('page');
    const page = Number.parseInt(raw || '1', 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => {
        if (ch === '&') return '&amp;';
        if (ch === '<') return '&lt;';
        if (ch === '>') return '&gt;';
        if (ch === '"') return '&quot;';
        return '&#39;';
    });
}

function errorExcerpt(row) {
    // The <summary> line already shows the message, so the expanded block shows
    // the stack (whose first line usually restates it); message-only reports
    // fall back to the message so the block is never empty.
    const text = String(row.stack || row.message || '').trim();
    return text.length > 600 ? `${text.slice(0, 600)}...` : text;
}

const EMPTY_STATS = { last7d: 0, sessions: 0, deviceWrites: 0 };

function readErrorPage(storageDir, page, now = Date.now()) {
    const file = errorsDbPath(storageDir);
    if (!existsSync(file)) {
        return { rows: [], total: 0, page: 1, pageCount: 1, stats: EMPTY_STATS, bans: [], banCount: 0, dbMissing: true };
    }

    if (!DatabaseSync) ({ DatabaseSync } = require('node:sqlite'));
    const db = new DatabaseSync(file);
    try {
        const total = db.prepare('SELECT COUNT(*) AS count FROM errors').get().count;
        // ts is an ISO-8601 UTC string, so lexicographic comparison is
        // chronological — no date parsing needed in SQLite.
        const since = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
        const stats = {
            last7d: db.prepare('SELECT COUNT(*) AS count FROM errors WHERE ts >= ?').get(since).count,
            sessions: db.prepare('SELECT COUNT(DISTINCT session_id) AS count FROM errors WHERE session_id IS NOT NULL').get().count,
            deviceWrites: db.prepare("SELECT COUNT(*) AS count FROM errors WHERE kind = 'deviceWrite'").get().count,
        };
        const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
        const normalizedPage = Math.min(page, pageCount);
        const offset = (normalizedPage - 1) * PAGE_SIZE;
        const rows = db
            .prepare(
                `SELECT id, ts, session_id, app_version, kind, message, stack, user_agent, flow_step
                 FROM errors
                 ORDER BY id DESC
                 LIMIT ? OFFSET ?`,
            )
            .all(PAGE_SIZE, offset);
        const banCount = db.prepare('SELECT COUNT(*) AS count FROM ip_blacklist').get().count;
        const bans = db
            .prepare(
                `SELECT ip, banned_at, reason, request_count, window_seconds
                 FROM ip_blacklist
                 ORDER BY banned_at DESC
                 LIMIT ?`,
            )
            .all(BAN_LIST_LIMIT)
            .map((ban) => {
                // Same expiry rule as the enforcement in error-store.mjs.
                const bannedAt = Date.parse(ban.banned_at);
                return { ...ban, active: Number.isFinite(bannedAt) && now - bannedAt < IP_BAN_DURATION_MS };
            });
        return { rows, total, page: normalizedPage, pageCount, stats, bans, banCount, dbMissing: false };
    } finally {
        db.close();
    }
}

/** 1,284 below 10K, then 12.9K — stat-tile values stay short. */
function compactNumber(value) {
    const n = Number.isFinite(value) ? value : 0;
    if (n >= 10000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    return n.toLocaleString('en-US');
}

// Known report kinds get a status tint; anything else stays neutral. The badge
// always carries the kind as text, so color is never the only signal.
function badgeClass(kind) {
    if (kind === 'deviceWrite') return 'badge warn';
    if (kind === 'unexpected') return 'badge alert';
    return 'badge';
}

/** '2026-06-24T13:00:00.000Z' → '2026-06-24 13:00' (full ISO kept in title). */
function shortTime(ts) {
    const s = String(ts || '');
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? `${s.slice(0, 10)} ${s.slice(11, 16)}` : s;
}

function cell(value, className = '') {
    if (value == null || value === '') return '<td><span class="none">—</span></td>';
    return `<td${className ? ` class="${className}"` : ''}>${escapeHtml(value)}</td>`;
}

function sessionCell(sessionId) {
    if (!sessionId) return '<td><span class="none">—</span></td>';
    const full = String(sessionId);
    const short = full.length > 8 ? full.slice(0, 8) : full;
    return `<td class="mono" title="${escapeHtml(full)}">${escapeHtml(short)}</td>`;
}

function renderErrorRow(row) {
    return `<tr>
        <td class="num">${row.id}</td>
        <td><time datetime="${escapeHtml(row.ts)}" title="${escapeHtml(row.ts)}">${escapeHtml(shortTime(row.ts))}</time></td>
        <td><span class="${badgeClass(row.kind)}">${escapeHtml(row.kind || 'unknown')}</span></td>
        ${cell(row.app_version, 'mono')}
        ${cell(row.flow_step, 'mono')}
        ${sessionCell(row.session_id)}
        <td class="error-cell"><details>
            <summary>${escapeHtml(row.message || 'No message')}</summary>
            <pre>${escapeHtml(errorExcerpt(row))}</pre>
            ${row.user_agent ? `<p class="ua">${escapeHtml(row.user_agent)}</p>` : ''}
        </details></td>
    </tr>`;
}

function renderBanRow(ban) {
    const status = ban.active ? '<span class="badge alert">active</span>' : '<span class="badge">expired</span>';
    return `<tr>
        <td class="mono">${escapeHtml(ban.ip)}</td>
        <td><time datetime="${escapeHtml(ban.banned_at)}" title="${escapeHtml(ban.banned_at)}">${escapeHtml(shortTime(ban.banned_at))}</time></td>
        <td>${status}</td>
        ${cell(ban.reason, 'mono')}
        ${cell(ban.request_count, 'num')}
        ${cell(ban.window_seconds, 'num')}
    </tr>`;
}

function renderBansSection(bans, banCount) {
    const heading = `<h2>Banned IPs${banCount ? ` (${banCount})` : ''}</h2>`;
    if (!bans.length) return `${heading}<p class="empty">No banned IPs.</p>`;
    const overflow = banCount > bans.length ? `<p class="meta section-note">Showing the ${bans.length} most recent of ${banCount} bans.</p>` : '';
    return `${heading}${overflow}<div class="card"><div class="table-scroll"><table>
        <thead>
            <tr>
                <th>IP</th>
                <th>Banned (UTC)</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Requests</th>
                <th>Window (s)</th>
            </tr>
        </thead>
        <tbody>${bans.map(renderBanRow).join('')}</tbody>
    </table></div></div>`;
}

function renderStatTiles(total, stats) {
    const tiles = [
        ['Total errors', total],
        ['Last 7 days', stats.last7d],
        ['Sessions affected', stats.sessions],
        ['Device-write failures', stats.deviceWrites],
    ];
    return `<section class="stats">${tiles
        .map(([label, value]) => `<div class="stat"><p class="label">${label}</p><p class="value">${compactNumber(value)}</p></div>`)
        .join('')}</section>`;
}

function renderAdminPage({ rows, total, page, pageCount, stats = EMPTY_STATS, bans = [], banCount = 0, dbMissing = false }) {
    const prev = page > 1 ? `<a class="btn" href="/admin?page=${page - 1}">&larr; Previous</a>` : '<span class="btn disabled">&larr; Previous</span>';
    const next = page < pageCount ? `<a class="btn" href="/admin?page=${page + 1}">Next &rarr;</a>` : '<span class="btn disabled">Next &rarr;</span>';
    const body = dbMissing
        ? '<p class="empty">No error log database exists yet.</p>'
        : rows.length
          ? `<div class="card"><div class="table-scroll"><table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Time (UTC)</th>
                        <th>Kind</th>
                        <th>Version</th>
                        <th>Flow step</th>
                        <th>Session</th>
                        <th>Error</th>
                    </tr>
                </thead>
                <tbody>${rows.map(renderErrorRow).join('')}</tbody>
            </table></div></div>`
          : '<p class="empty">No errors recorded yet.</p>';

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>KoboPatch Error Log</title>
    <style>
        /* Mirrors the app's design tokens (src/css/critical.css); the admin page
           is standalone, so the values are inlined. Theme follows the OS. */
        :root {
            color-scheme: light;
            --bg: #f5f5f7; --card-bg: #fff; --bg-subtle: #f9fafb;
            --border: #d1d5db; --border-light: #e5e7eb; --border-strong: #9ca3af;
            --text: #111827; --text-secondary: #6b7280; --text-muted: #9ca3af;
            --primary: #01a7c4;
            --error-bg: #fef2f2; --error-border: #fca5a5; --error-text: #991b1b;
            --warning-bg: #fffbeb; --warning-border: #fcd34d; --warning-text: #92400e;
            --shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04);
            --font-mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
        }
        @media (prefers-color-scheme: dark) {
            :root {
                color-scheme: dark;
                --bg: #15171c; --card-bg: #1e2128; --bg-subtle: #262a32;
                --border: #3a3f4b; --border-light: #2c313b; --border-strong: #565d6b;
                --text: #e6e8ec; --text-secondary: #9aa3b2; --text-muted: #6b7280;
                --primary: #13a0ba;
                --error-bg: #2a1517; --error-border: #7f1d1d; --error-text: #f5a3a3;
                --warning-bg: #2a2410; --warning-border: #854d0e; --warning-text: #fcd34d;
                --shadow: 0 1px 3px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.4);
            }
        }
        * { box-sizing: border-box; }
        body {
            margin: 0; background: var(--bg); color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
            font-size: 15px; line-height: 1.5;
        }
        .wrap { max-width: 1100px; margin: 0 auto; padding: 32px 24px 48px; }
        header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
        h2 { margin: 32px 0 12px; font-size: 1.05rem; }
        .section-note { margin: -6px 0 12px; font-size: 0.85rem; }
        .eyebrow { margin: 0; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--primary); }
        h1 { margin: 2px 0 4px; font-size: 1.55rem; line-height: 1.2; }
        .meta { margin: 0; color: var(--text-secondary); font-size: 0.9rem; }
        .btn {
            display: inline-flex; align-items: center; gap: 0.45rem;
            font-size: 0.9rem; font-weight: 500; padding: 0.5rem 1.1rem;
            border-radius: 8px; border: 1px solid var(--border);
            background: var(--card-bg); color: var(--text);
            text-decoration: none; box-shadow: var(--shadow);
        }
        a.btn:hover { background: var(--bg-subtle); border-color: var(--border-strong); }
        .btn.disabled { color: var(--text-muted); box-shadow: none; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 24px; }
        .stat { background: var(--card-bg); border: 1px solid var(--border-light); border-radius: 8px; box-shadow: var(--shadow); padding: 14px 16px; }
        .stat .label { margin: 0; font-size: 0.8rem; color: var(--text-secondary); }
        .stat .value { margin: 2px 0 0; font-size: 1.7rem; font-weight: 600; line-height: 1.2; }
        .card { background: var(--card-bg); border: 1px solid var(--border-light); border-radius: 8px; box-shadow: var(--shadow); overflow: hidden; }
        .table-scroll { overflow-x: auto; }
        /* Below the min-width the table scrolls inside .table-scroll instead of
           squeezing the error column into a one-word-per-line sliver. */
        table { width: 100%; min-width: 860px; border-collapse: collapse; font-size: 0.875rem; }
        th {
            text-align: left; font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
            color: var(--text-secondary); background: var(--bg-subtle);
            padding: 10px 14px; border-bottom: 1px solid var(--border-light); white-space: nowrap;
        }
        td { padding: 10px 14px; border-bottom: 1px solid var(--border-light); vertical-align: top; text-align: left; }
        tbody tr:last-child td { border-bottom: none; }
        tbody tr:hover { background: var(--bg-subtle); }
        .num { color: var(--text-muted); font-variant-numeric: tabular-nums; }
        .none { color: var(--text-muted); }
        time { color: var(--text-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .badge {
            display: inline-block; font-size: 0.72rem; font-weight: 600; line-height: 1.6;
            padding: 1px 9px; border-radius: 999px;
            border: 1px solid var(--border); background: var(--bg-subtle); color: var(--text-secondary);
            white-space: nowrap;
        }
        .badge.warn { background: var(--warning-bg); border-color: var(--warning-border); color: var(--warning-text); }
        .badge.alert { background: var(--error-bg); border-color: var(--error-border); color: var(--error-text); }
        .mono { font-family: var(--font-mono); font-size: 0.8rem; }
        .error-cell { max-width: 480px; }
        details summary { cursor: pointer; overflow-wrap: anywhere; }
        details[open] summary { margin-bottom: 8px; }
        pre {
            margin: 0 0 8px; padding: 10px 12px;
            background: var(--bg-subtle); border: 1px solid var(--border-light); border-radius: 6px;
            font-family: var(--font-mono); font-size: 0.78rem;
            white-space: pre-wrap; overflow-wrap: anywhere;
        }
        .ua { margin: 0; font-size: 0.75rem; color: var(--text-muted); overflow-wrap: anywhere; }
        .empty {
            margin: 0; padding: 40px 24px; text-align: center; color: var(--text-secondary);
            background: var(--card-bg); border: 1px dashed var(--border); border-radius: 8px;
        }
        nav { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 20px; font-size: 0.9rem; }
        nav .page { color: var(--text-secondary); }
    </style>
</head>
<body>
    <div class="wrap">
        <header>
            <div>
                <p class="eyebrow">KoboPatch Web UI</p>
                <h1>KoboPatch Error Log</h1>
                <p class="meta">${total} total error${total === 1 ? '' : 's'} · page ${page} of ${pageCount}</p>
            </div>
            <a class="btn" href="/admin/errors.sqlite">Download SQLite</a>
        </header>
        ${renderStatTiles(total, stats)}
        <h2>Error reports</h2>
        ${body}
        <nav>${prev}<span class="page" aria-current="page">Page ${page} of ${pageCount}</span>${next}</nav>
        ${renderBansSection(bans, banCount)}
    </div>
</body>
</html>
`;
}

export function handleAdminErrorsPage(
    req,
    res,
    { storageDir, credentials = adminCredentialsFromEnv(), url = new URL(req.url || '/admin', 'http://localhost') } = {},
) {
    if (!checkAdmin(req, res, credentials)) return;
    if (!methodAllowed(req, res)) return;

    try {
        const page = pageFromUrl(url);
        html(res, 200, renderAdminPage(readErrorPage(storageDir, page)), { head: req.method === 'HEAD' });
    } catch (err) {
        text(res, 500, `Could not read error log database: ${err.message}\n`);
    }
}

export function handleAdminErrorsDownload(req, res, { storageDir, credentials = adminCredentialsFromEnv() } = {}) {
    if (!checkAdmin(req, res, credentials)) return;
    if (!methodAllowed(req, res)) return;

    const file = errorsDbPath(storageDir);
    let stat;
    try {
        if (!existsSync(file)) throw new Error('missing');
        stat = statSync(file);
        if (!stat.isFile()) throw new Error('not a file');
    } catch {
        text(res, 404, 'No error log database found\n');
        return;
    }

    res.writeHead(200, {
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Disposition': 'attachment; filename="errors.sqlite"',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') {
        res.end();
        return;
    }

    createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res);
}
