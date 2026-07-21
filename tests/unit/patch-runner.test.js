import test from 'node:test';
import assert from 'node:assert/strict';

// A controllable stand-in for the browser Worker. Records construction args and
// posted messages, and lets a test drive the worker→runner message protocol by
// invoking the handlers the runner assigns. The most recently constructed
// instance is exposed via `lastWorker` so a test can grab it right after calling
// patchFirmware (the runner builds the worker synchronously before returning).
let lastWorker = null;

class FakeWorker {
    constructor(url) {
        this.url = url;
        this.posted = [];
        this.terminated = false;
        this.onmessage = null;
        this.onerror = null;
        lastWorker = this;
    }

    postMessage(message, transfer) {
        this.posted.push({ message, transfer });
    }

    terminate() {
        this.terminated = true;
    }

    /** Deliver a message from the worker to the runner. */
    emit(data) {
        this.onmessage({ data });
    }

    /** Trigger the worker's error handler. */
    fail(message) {
        this.onerror({ message });
    }
}

// runner.js creates `new Worker(...)` and assigns `window.KoboPatchRunner` at
// import time, so both globals must exist before it is imported.
globalThis.window ??= {};
globalThis.Worker = FakeWorker;

const { KoboPatchRunner } = await import('../../src/js/patches/runner.js');

/** Start a run and return both the promise and the worker the runner created. */
function startRun(runner, { onProgress } = {}) {
    const firmwareZip = new Uint8Array([1, 2, 3]);
    const patchFiles = { 'src/foo.yaml': new Uint8Array([4, 5]) };
    const promise = runner.patchFirmware('config: yaml', firmwareZip, patchFiles, onProgress);
    return { promise, worker: lastWorker, firmwareZip, patchFiles };
}

test('patchFirmware posts a patch message to the worker and transfers the firmware buffer', () => {
    const runner = new KoboPatchRunner();
    const { promise, worker, firmwareZip, patchFiles } = startRun(runner);

    assert.equal(worker.url, 'js/workers/patch-worker.js');
    assert.equal(worker.posted.length, 1);

    const { message, transfer } = worker.posted[0];
    assert.equal(message.type, 'patch');
    assert.equal(message.configYAML, 'config: yaml');
    assert.equal(message.firmwareZip, firmwareZip);
    assert.deepEqual(message.patchFiles, patchFiles);
    assert.deepEqual(transfer, [firmwareZip.buffer]);

    // Settle the promise so it does not dangle.
    worker.emit({ type: 'done', tgz: new Uint8Array(), log: '' });
    return promise;
});

test('patchFirmware resolves with the tgz and log on "done" and terminates the worker', async () => {
    const runner = new KoboPatchRunner();
    const { promise, worker } = startRun(runner);

    const tgz = new Uint8Array([9, 9]);
    worker.emit({ type: 'done', tgz, log: 'patch log' });

    const result = await promise;
    assert.equal(result.tgz, tgz);
    assert.equal(result.log, 'patch log');
    assert.equal(worker.terminated, true);
});

test('patchFirmware forwards "progress" messages to onProgress without settling', async () => {
    const runner = new KoboPatchRunner();
    const messages = [];
    const { promise, worker } = startRun(runner, { onProgress: (m) => messages.push(m) });

    worker.emit({ type: 'progress', message: 'Reading firmware...' });
    worker.emit({ type: 'progress', message: 'Applying patches...' });

    assert.deepEqual(messages, ['Reading firmware...', 'Applying patches...']);
    assert.equal(worker.terminated, false);

    worker.emit({ type: 'done', tgz: new Uint8Array(), log: '' });
    await promise;
});

test('patchFirmware tolerates "progress" messages when no onProgress is given', async () => {
    const runner = new KoboPatchRunner();
    const { promise, worker } = startRun(runner);

    assert.doesNotThrow(() => worker.emit({ type: 'progress', message: 'ignored' }));

    worker.emit({ type: 'done', tgz: new Uint8Array(), log: '' });
    await promise;
});

test('patchFirmware rejects with the worker error message on "error" and terminates', async () => {
    const runner = new KoboPatchRunner();
    const { promise, worker } = startRun(runner);

    worker.emit({ type: 'error', message: 'patch failed: bad config' });

    await assert.rejects(promise, /patch failed: bad config/);
    assert.equal(worker.terminated, true);
});

test('patchFirmware rejects and terminates when the worker itself errors', async () => {
    const runner = new KoboPatchRunner();
    const { promise, worker } = startRun(runner);

    worker.fail('script load failure');

    await assert.rejects(promise, /Worker error: script load failure/);
    assert.equal(worker.terminated, true);
});

test('the runner is exposed on window for E2E test compatibility', () => {
    assert.equal(globalThis.window.KoboPatchRunner, KoboPatchRunner);
});
