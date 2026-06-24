import test from 'node:test';
import assert from 'node:assert/strict';

import { reportError, resetErrorReporterForTests } from '../../src/js/shell/error-report.js';

async function bodyText(body) {
    if (body && typeof body.text === 'function') return body.text();
    return String(body);
}

async function withGlobals(values, run) {
    const descriptors = new Map();
    for (const key of Object.keys(values)) {
        descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: values[key],
        });
    }
    try {
        resetErrorReporterForTests();
        await run();
    } finally {
        resetErrorReporterForTests();
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    }
}

function storage() {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, String(value)),
    };
}

test('reportError sends the expected payload with sendBeacon', async () => {
    const sent = [];
    await withGlobals(
        {
            __APP_VERSION__: '1.37',
            crypto: { randomUUID: () => 'session-1' },
            sessionStorage: storage(),
            navigator: {
                userAgent: 'TestAgent/1.0',
                sendBeacon: (url, body) => {
                    sent.push({ url, body });
                    return true;
                },
            },
        },
        async () => {
            const err = new Error('boom');
            err.stack = 'Error: boom\n    at test';

            assert.equal(reportError({ kind: 'unexpected', error: err, flowStep: 'build' }), true);
            assert.equal(sent.length, 1);
            assert.equal(sent[0].url, '/api/error');

            const payload = JSON.parse(await bodyText(sent[0].body));
            assert.deepEqual(payload, {
                sessionId: 'session-1',
                appVersion: '1.37',
                kind: 'unexpected',
                message: 'boom',
                stack: 'Error: boom\n    at test',
                userAgent: 'TestAgent/1.0',
                flowStep: 'build',
            });
        },
    );
});

test('reportError reuses the session id from sessionStorage', async () => {
    const store = storage();
    store.setItem('kobopatch-webui:error-session-id', 'existing-session');
    const sent = [];

    await withGlobals(
        {
            __APP_VERSION__: '1.37',
            crypto: { randomUUID: () => 'new-session' },
            sessionStorage: store,
            navigator: {
                userAgent: 'TestAgent/1.0',
                sendBeacon: (_url, body) => {
                    sent.push(body);
                    return true;
                },
            },
        },
        async () => {
            reportError({ kind: 'unexpected', error: 'x' });
            const payload = JSON.parse(await bodyText(sent[0]));
            assert.equal(payload.sessionId, 'existing-session');
        },
    );
});

test('reportError falls back to fetch keepalive when sendBeacon is missing or returns false', async () => {
    const fetches = [];
    await withGlobals(
        {
            __APP_VERSION__: '1.37',
            crypto: { randomUUID: () => 'session-1' },
            sessionStorage: storage(),
            navigator: {
                userAgent: 'TestAgent/1.0',
                sendBeacon: () => false,
            },
            fetch: (url, options) => {
                fetches.push({ url, options });
                return Promise.resolve({ ok: true });
            },
        },
        async () => {
            assert.equal(reportError({ kind: 'deviceWrite', error: new Error('write failed'), flowStep: 'review' }), true);
            assert.equal(fetches.length, 1);
            assert.equal(fetches[0].url, '/api/error');
            assert.equal(fetches[0].options.method, 'POST');
            assert.equal(fetches[0].options.keepalive, true);
            assert.equal(fetches[0].options.headers['Content-Type'], 'application/json');

            const payload = JSON.parse(fetches[0].options.body);
            assert.equal(payload.kind, 'deviceWrite');
            assert.equal(payload.message, 'write failed');
            assert.equal(payload.flowStep, 'review');
        },
    );
});

test('reportError never throws when transports are missing', async () => {
    await withGlobals(
        {
            __APP_VERSION__: '1.37',
            crypto: { randomUUID: () => 'session-1' },
            sessionStorage: storage(),
            navigator: { userAgent: 'TestAgent/1.0' },
            fetch: undefined,
        },
        async () => {
            assert.doesNotThrow(() => reportError({ kind: 'unexpected', error: new Error('boom') }));
            assert.equal(reportError({ kind: 'another', error: new Error('boom') }), false);
        },
    );
});

test('reportError deduplicates identical reports and caps unique reports per load', async () => {
    const sent = [];
    await withGlobals(
        {
            __APP_VERSION__: '1.37',
            crypto: { randomUUID: () => 'session-1' },
            sessionStorage: storage(),
            navigator: {
                userAgent: 'TestAgent/1.0',
                sendBeacon: (url, body) => {
                    sent.push({ url, body });
                    return true;
                },
            },
        },
        async () => {
            assert.equal(reportError({ kind: 'unexpected', error: 'same', flowStep: 'a' }), true);
            assert.equal(reportError({ kind: 'unexpected', error: 'same', flowStep: 'a' }), false);
            assert.equal(sent.length, 1);

            for (let i = 0; i < 12; i += 1) {
                reportError({ kind: 'unexpected', error: `unique ${i}`, flowStep: 'a' });
            }
            assert.equal(sent.length, 10);
        },
    );
});
