import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { track, isEnabled } from '../../src/js/shell/Analytics.js';

/**
 * umami.track is an async function, so it hands back a promise even when it
 * fails. A bare call would drop that promise, and the app's global
 * `unhandledrejection` handler reads an unhandled rejection as the app
 * crashing — so a tracker having a bad day could put the error screen up.
 * These cover both halves: the event still gets through, and nothing escapes.
 */
async function withWindow(run) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: dom.window });
    try {
        await run(dom.window);
    } finally {
        if (previous) Object.defineProperty(globalThis, 'window', previous);
        else delete globalThis.window;
        dom.window.close();
    }
}

// Let the microtask queue drain and give node a turn to report an unhandled
// rejection, which it only does after the queue is empty.
async function settle() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

// Capture unhandled rejections instead of letting them fail the test run.
async function collectingUnhandledRejections(run) {
    const seen = [];
    const listener = (reason) => seen.push(reason);
    const existing = process.listeners('unhandledRejection');
    for (const l of existing) process.off('unhandledRejection', l);
    process.on('unhandledRejection', listener);
    try {
        await run();
        await settle();
    } finally {
        process.off('unhandledRejection', listener);
        for (const l of existing) process.on('unhandledRejection', l);
    }
    return seen;
}

test('track forwards the event when analytics is enabled', async () => {
    await withWindow(async (window) => {
        const sent = [];
        window.__ANALYTICS_ENABLED = true;
        window.umami = { track: async (name, data) => sent.push([name, data]) };

        track('flow-start', { method: 'connect' });
        await settle();

        assert.deepEqual(sent, [['flow-start', { method: 'connect' }]]);
    });
});

test('track is a no-op when analytics is disabled', async () => {
    await withWindow(async (window) => {
        const sent = [];
        window.umami = { track: async (name) => sent.push(name) };

        assert.equal(isEnabled(), false);
        track('flow-start', {});
        await settle();

        assert.deepEqual(sent, []);
    });
});

test('track is a no-op when umami never loaded', async () => {
    await withWindow(async (window) => {
        window.__ANALYTICS_ENABLED = true;
        // No window.umami — the script was blocked, or has not arrived yet.
        assert.doesNotThrow(() => track('flow-start', {}));
        await settle();
    });
});

test('a rejected tracker promise does not become an unhandled rejection', async () => {
    await withWindow(async (window) => {
        window.__ANALYTICS_ENABLED = true;
        window.umami = {
            track: async () => {
                throw new Error('tracker unreachable');
            },
        };

        const escaped = await collectingUnhandledRejections(async () => {
            track('flow-start', { method: 'connect' });
        });

        assert.deepEqual(escaped, [], 'a failing tracker must not surface as an app crash');
    });
});

test('a tracker that throws synchronously does not propagate', async () => {
    await withWindow(async (window) => {
        window.__ANALYTICS_ENABLED = true;
        window.umami = {
            track: () => {
                throw new Error('tracker exploded');
            },
        };

        assert.doesNotThrow(() => track('flow-start', {}));
        await settle();
    });
});

test('many failing track calls leave nothing unhandled', async () => {
    await withWindow(async (window) => {
        window.__ANALYTICS_ENABLED = true;
        window.umami = { track: async () => Promise.reject(new Error('down')) };

        const escaped = await collectingUnhandledRejections(async () => {
            for (let i = 0; i < 200; i++) track('flow-start', { i });
        });

        assert.deepEqual(escaped, []);
    });
});
