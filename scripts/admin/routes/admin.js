/**
 * admin.js — authenticated admin views/downloads for persisted server
 * data. Disabled unless ADMIN_USERNAME and ADMIN_PASSWORD are configured.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const REALM = 'KoboPatch Web UI admin';
const PAGE_SIZE = 50;

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
    const stack = row.stack ? `\n${row.stack}` : '';
    const text = `${row.message || ''}${stack}`.trim();
    return text.length > 600 ? `${text.slice(0, 600)}...` : text;
}

function readErrorPage(storageDir, page) {
    const file = errorsDbPath(storageDir);
    if (!existsSync(file)) {
        return { rows: [], total: 0, page: 1, pageCount: 1, dbMissing: true };
    }

    if (!DatabaseSync) ({ DatabaseSync } = require('node:sqlite'));
    const db = new DatabaseSync(file);
    try {
        const total = db.prepare('SELECT COUNT(*) AS count FROM errors').get().count;
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
        return { rows, total, page: normalizedPage, pageCount, dbMissing: false };
    } finally {
        db.close();
    }
}

function renderAdminPage({ rows, total, page, pageCount, dbMissing = false }) {
    const prev = page > 1 ? `<a href="/admin?page=${page - 1}">Previous</a>` : '<span>Previous</span>';
    const next = page < pageCount ? `<a href="/admin?page=${page + 1}">Next</a>` : '<span>Next</span>';
    const body = dbMissing
        ? '<p class="empty">No error log database exists yet.</p>'
        : rows.length
          ? `<table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Time</th>
                        <th>Kind</th>
                        <th>Version</th>
                        <th>Flow step</th>
                        <th>Session</th>
                        <th>Error</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows
                        .map(
                            (row) => `<tr>
                                <td>${row.id}</td>
                                <td><time>${escapeHtml(row.ts)}</time></td>
                                <td>${escapeHtml(row.kind)}</td>
                                <td>${escapeHtml(row.app_version)}</td>
                                <td>${escapeHtml(row.flow_step)}</td>
                                <td>${escapeHtml(row.session_id)}</td>
                                <td><details><summary>${escapeHtml(row.message || 'No message')}</summary><pre>${escapeHtml(errorExcerpt(row))}</pre><p class="ua">${escapeHtml(row.user_agent)}</p></details></td>
                            </tr>`,
                        )
                        .join('')}
                </tbody>
            </table>`
          : '<p class="empty">No errors recorded yet.</p>';

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>KoboPatch Error Log</title>
    <style>
        :root { color-scheme: light dark; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        body { margin: 0; padding: 24px; background: Canvas; color: CanvasText; }
        header { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
        h1 { margin: 0; font-size: 24px; }
        p { margin: 4px 0 0; color: color-mix(in srgb, CanvasText 70%, Canvas); }
        a { color: LinkText; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        th, td { padding: 10px 12px; border-bottom: 1px solid color-mix(in srgb, CanvasText 18%, Canvas); text-align: left; vertical-align: top; }
        th { position: sticky; top: 0; background: Canvas; }
        td { max-width: 420px; overflow-wrap: anywhere; }
        details summary { cursor: pointer; max-width: 520px; overflow-wrap: anywhere; }
        pre { max-width: 680px; white-space: pre-wrap; overflow-wrap: anywhere; }
        .ua { font-size: 12px; }
        .empty { padding: 24px; border: 1px solid color-mix(in srgb, CanvasText 18%, Canvas); }
        nav { display: flex; gap: 12px; margin-top: 20px; }
        nav span { color: color-mix(in srgb, CanvasText 45%, Canvas); }
    </style>
</head>
<body>
    <header>
        <div>
            <h1>KoboPatch Error Log</h1>
            <p>${total} total error${total === 1 ? '' : 's'} · page ${page} of ${pageCount}</p>
        </div>
        <a href="/admin/errors.sqlite">Download SQLite</a>
    </header>
    ${body}
    <nav>${prev}<span aria-current="page">${page}</span>${next}</nav>
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
