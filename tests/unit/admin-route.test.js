import test from 'node:test';
import assert from 'node:assert/strict';

import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';

import { handleAdminBackendRoute } from '../../scripts/admin/routes/index.js';
import { adminCredentialsFromEnv, handleAdminErrorsDownload, handleAdminErrorsPage, parseBasicAuth } from '../../scripts/admin/routes/admin.js';
import { closeErrorStores, recordError } from '../../scripts/admin/error-store.mjs';

function tmp() {
    return mkdtempSync(join(tmpdir(), 'admin-route-'));
}

function basic(username, password) {
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function mockReq({ method = 'GET', authorization } = {}) {
    return {
        method,
        headers: authorization ? { authorization } : {},
    };
}

function mockRes() {
    const res = new PassThrough();
    res.statusCode = null;
    res.headers = {};
    res.writeHead = (statusCode, headers = {}) => {
        res.statusCode = statusCode;
        res.headers = headers;
        return res;
    };
    res.destroy = () => {
        PassThrough.prototype.destroy.call(res);
    };
    return res;
}

async function run(handler, req, options) {
    const res = mockRes();
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    handler(req, res, options);
    await once(res, 'finish');
    return { statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) };
}

test('adminCredentialsFromEnv requires both admin env vars', () => {
    assert.equal(adminCredentialsFromEnv({}), null);
    assert.equal(adminCredentialsFromEnv({ ADMIN_USERNAME: 'admin' }), null);
    assert.equal(adminCredentialsFromEnv({ ADMIN_PASSWORD: 'secret' }), null);
    assert.deepEqual(adminCredentialsFromEnv({ ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'secret' }), {
        username: 'admin',
        password: 'secret',
    });
});

test('parseBasicAuth decodes browser Basic Auth credentials', () => {
    assert.deepEqual(parseBasicAuth(basic('admin', 'secret')), { username: 'admin', password: 'secret' });
    assert.deepEqual(parseBasicAuth(basic('admin', 'secret:with:colons')), { username: 'admin', password: 'secret:with:colons' });
    assert.equal(parseBasicAuth('Bearer token'), null);
    assert.equal(parseBasicAuth(null), null);
});

test('disabled admin endpoint returns 404 without an auth challenge', async () => {
    const dir = tmp();
    try {
        const res = await run(handleAdminErrorsDownload, mockReq(), { storageDir: dir, credentials: null });
        assert.equal(res.statusCode, 404);
        assert.equal(res.headers['WWW-Authenticate'], undefined);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('missing or wrong credentials return a browser Basic Auth challenge', async () => {
    const dir = tmp();
    try {
        const credentials = { username: 'admin', password: 'secret' };
        const missing = await run(handleAdminErrorsDownload, mockReq(), { storageDir: dir, credentials });
        assert.equal(missing.statusCode, 401);
        assert.match(missing.headers['WWW-Authenticate'], /^Basic realm="KoboPatch Web UI admin"/);

        const wrong = await run(handleAdminErrorsDownload, mockReq({ authorization: basic('admin', 'wrong') }), { storageDir: dir, credentials });
        assert.equal(wrong.statusCode, 401);
        assert.match(wrong.headers['WWW-Authenticate'], /^Basic realm="KoboPatch Web UI admin"/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('authorized request returns 404 when errors.sqlite does not exist', async () => {
    const dir = tmp();
    try {
        const credentials = { username: 'admin', password: 'secret' };
        const res = await run(handleAdminErrorsDownload, mockReq({ authorization: basic('admin', 'secret') }), { storageDir: dir, credentials });
        assert.equal(res.statusCode, 404);
        assert.match(res.body.toString('utf-8'), /No error log database/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('authorized request downloads errors.sqlite as an attachment', async () => {
    const dir = tmp();
    try {
        const data = Buffer.from('sqlite bytes');
        writeFileSync(join(dir, 'errors.sqlite'), data);
        const credentials = { username: 'admin', password: 'secret' };

        const res = await run(handleAdminErrorsDownload, mockReq({ authorization: basic('admin', 'secret') }), { storageDir: dir, credentials });

        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['Content-Type'], 'application/vnd.sqlite3');
        assert.equal(res.headers['Content-Disposition'], 'attachment; filename="errors.sqlite"');
        assert.equal(res.headers['Content-Length'], data.length);
        assert.equal(res.headers['Cache-Control'], 'no-store');
        assert.deepEqual(res.body, data);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('authorized HEAD request returns download headers without a body', async () => {
    const dir = tmp();
    try {
        const data = Buffer.from('sqlite bytes');
        writeFileSync(join(dir, 'errors.sqlite'), data);
        const credentials = { username: 'admin', password: 'secret' };

        const res = await run(handleAdminErrorsDownload, mockReq({ method: 'HEAD', authorization: basic('admin', 'secret') }), {
            storageDir: dir,
            credentials,
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['Content-Length'], data.length);
        assert.equal(res.body.length, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('authorized /admin page renders an empty state when errors.sqlite is missing', async () => {
    const dir = tmp();
    try {
        const credentials = { username: 'admin', password: 'secret' };
        const res = await run(handleAdminErrorsPage, mockReq({ authorization: basic('admin', 'secret') }), {
            storageDir: dir,
            credentials,
            url: new URL('http://localhost/admin'),
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
        assert.match(res.body.toString('utf-8'), /No error log database exists yet/);
        assert.match(res.body.toString('utf-8'), /href="\/admin\/errors\.sqlite"/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('authorized /admin page lists errors newest first and escapes error content', async () => {
    const dir = tmp();
    try {
        recordError(
            dir,
            {
                sessionId: 's-1',
                appVersion: '1.37',
                kind: 'unexpected',
                message: '<script>alert(1)</script>',
                stack: 'at <frame>',
                flowStep: 'step-error',
            },
            { ts: '2026-06-24T13:00:00.000Z', userAgent: 'TestAgent/1.0' },
        );
        closeErrorStores();

        const credentials = { username: 'admin', password: 'secret' };
        const res = await run(handleAdminErrorsPage, mockReq({ authorization: basic('admin', 'secret') }), {
            storageDir: dir,
            credentials,
            url: new URL('http://localhost/admin'),
        });
        const body = res.body.toString('utf-8');

        assert.equal(res.statusCode, 200);
        assert.match(body, /KoboPatch Error Log/);
        assert.match(body, /1 total error/);
        assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
        assert.match(body, /at &lt;frame&gt;/);
        assert.ok(!body.includes('<script>alert(1)</script>'));
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('authorized /admin page paginates errors with newest rows first', async () => {
    const dir = tmp();
    try {
        for (let i = 1; i <= 55; i += 1) {
            recordError(
                dir,
                { kind: 'manual-test', message: `error ${i}`, flowStep: `step-${i}` },
                { ts: `2026-06-24T13:${String(i).padStart(2, '0')}:00.000Z` },
            );
        }
        closeErrorStores();

        const credentials = { username: 'admin', password: 'secret' };
        const page1 = await run(handleAdminErrorsPage, mockReq({ authorization: basic('admin', 'secret') }), {
            storageDir: dir,
            credentials,
            url: new URL('http://localhost/admin?page=1'),
        });
        const page1Body = page1.body.toString('utf-8');
        assert.match(page1Body, /55 total errors · page 1 of 2/);
        assert.match(page1Body, /error 55/);
        assert.doesNotMatch(page1Body, /error 5</);
        assert.match(page1Body, /href="\/admin\?page=2"/);

        const page2 = await run(handleAdminErrorsPage, mockReq({ authorization: basic('admin', 'secret') }), {
            storageDir: dir,
            credentials,
            url: new URL('http://localhost/admin?page=2'),
        });
        const page2Body = page2.body.toString('utf-8');
        assert.match(page2Body, /55 total errors · page 2 of 2/);
        assert.match(page2Body, /error 5/);
        assert.match(page2Body, /href="\/admin\?page=1"/);
    } finally {
        closeErrorStores();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('authorized HEAD request for /admin returns page headers without a body', async () => {
    const dir = tmp();
    try {
        const credentials = { username: 'admin', password: 'secret' };
        const res = await run(handleAdminErrorsPage, mockReq({ method: 'HEAD', authorization: basic('admin', 'secret') }), {
            storageDir: dir,
            credentials,
            url: new URL('http://localhost/admin'),
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
        assert.equal(res.body.length, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('shared admin route index dispatches admin backend paths and ignores static paths', async () => {
    const dir = tmp();
    try {
        const req = mockReq({ authorization: basic('admin', 'secret') });
        const res = mockRes();
        const handled = handleAdminBackendRoute(req, res, {
            storageDir: dir,
            url: new URL('http://localhost/admin'),
        });

        assert.equal(handled, true);
        await once(res, 'finish');
        assert.equal(res.statusCode, 404);

        assert.equal(
            handleAdminBackendRoute(mockReq(), mockRes(), {
                storageDir: dir,
                url: new URL('http://localhost/bundle.js'),
            }),
            false,
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
