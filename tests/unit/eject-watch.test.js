import test from 'node:test';
import assert from 'node:assert/strict';

import { watchForEject } from '../../src/js/kobo/eject-watch.js';

/**
 * A stand-in device whose reachability is scripted per probe. Each entry is
 * either a boolean (what `pathExists` resolves to) or an Error to throw.
 */
function fakeDevice(script) {
    const calls = [];
    return {
        calls,
        async pathExists(pathParts) {
            calls.push(pathParts.join('/'));
            const next = calls.length <= script.length ? script[calls.length - 1] : script[script.length - 1];
            if (next instanceof Error) throw next;
            return next;
        },
    };
}

/** Run the watch to completion on a fast interval, resolving with the outcome. */
function run(device, opts = {}) {
    return new Promise((resolve) => {
        const watch = watchForEject(device, {
            intervalMs: 1,
            onGone: () => resolve({ outcome: 'gone', watch }),
            onGiveUp: () => resolve({ outcome: 'gaveUp', watch }),
            ...opts,
        });
    });
}

test('probes .kobo/version rather than the directory root', async () => {
    const device = fakeDevice([false, false]);
    await run(device);
    assert.deepStrictEqual(device.calls[0].split('/'), ['.kobo', 'version']);
});

test('a single missed probe is not treated as a disconnect', async () => {
    // Present, one blip, present again, then really gone. Only the trailing
    // pair of misses should count.
    const device = fakeDevice([true, false, true, false, false]);
    const { outcome } = await run(device);
    assert.equal(outcome, 'gone');
    assert.equal(device.calls.length, 5);
});

test('two consecutive misses report the device as gone', async () => {
    const device = fakeDevice([true, false, false]);
    const { outcome } = await run(device);
    assert.equal(outcome, 'gone');
    assert.equal(device.calls.length, 3);
});

test('a throwing probe counts as a miss, not a crash', async () => {
    // An unmounted volume rejects rather than reporting the file as missing.
    const device = fakeDevice([new Error('NotReadableError'), new Error('NotReadableError')]);
    const { outcome } = await run(device);
    assert.equal(outcome, 'gone');
});

test('gives up while the device is still connected', async () => {
    const device = fakeDevice([true]);
    let clock = 0;
    const { outcome } = await run(device, { timeoutMs: 50, now: () => (clock += 30) });
    assert.equal(outcome, 'gaveUp');
});

test('onGone fires once and polling stops afterwards', async () => {
    const device = fakeDevice([false, false]);
    let goneCount = 0;
    await new Promise((resolve) => {
        watchForEject(device, {
            intervalMs: 1,
            onGone: () => {
                goneCount++;
                resolve();
            },
        });
    });
    const callsAtDetection = device.calls.length;
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(goneCount, 1);
    assert.equal(device.calls.length, callsAtDetection, 'no probes after the device was reported gone');
});

test('stop() halts polling and suppresses the callbacks', async () => {
    const device = fakeDevice([false, false, false, false]);
    let fired = false;
    const watch = watchForEject(device, { intervalMs: 1, onGone: () => (fired = true) });
    watch.stop();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(fired, false);
    assert.equal(device.calls.length, 0);
});

test('stop() during an in-flight probe suppresses onGone', async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const device = {
        calls: [],
        async pathExists() {
            this.calls.push('probe');
            await gate;
            return false;
        },
    };
    let fired = false;
    const watch = watchForEject(device, { intervalMs: 1, failuresBeforeGone: 1, onGone: () => (fired = true) });
    await new Promise((r) => setTimeout(r, 10));
    watch.stop();
    release();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(fired, false, 'a probe that resolves after stop() must not report');
});

test('stop() is safe to call twice and after the watch ended', async () => {
    const device = fakeDevice([false, false]);
    const { watch } = await run(device);
    watch.stop();
    watch.stop();
});
