import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createTerminal } from '../../src/js/shell/terminal.js';
import { AUDIT_LOG_DIRECTORY } from '../../src/js/kobo/audit-log.js';
import { RecordingDevice, bytes, text } from './test-helpers.js';

async function withDom(run) {
    const dom = new JSDOM(
        `<!doctype html><html><body>
        <div id="done-step">
            <div class="banner banner--info feedback" hidden>
                <span class="feedback-text">Prompt</span>
                <span class="feedback-thanks" hidden>Thanks</span>
                <span class="feedback-donate" hidden>Donate</span>
                <span class="feedback-buttons">
                    <button class="feedback-btn" data-vote="up" type="button">Up</button>
                    <button class="feedback-btn" data-vote="down" type="button">Down</button>
                </span>
            </div>
        </div>
    </body></html>`,
        { url: 'https://example.test/' },
    );

    const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');

    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: dom.window,
    });
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        writable: true,
        value: dom.window.document,
    });
    dom.window.__ANALYTICS_ENABLED = true;

    try {
        await run(dom.window.document);
    } finally {
        if (previousWindowDescriptor) Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
        else delete globalThis.window;

        if (previousDocumentDescriptor) Object.defineProperty(globalThis, 'document', previousDocumentDescriptor);
        else delete globalThis.document;
    }
}

test('writeToDevice writes every entry and persists an audit log on success', async () => {
    const device = new RecordingDevice();
    const errors = [];
    const terminal = createTerminal({ doneStep: {}, showError: (...args) => errors.push(args) });

    const result = await terminal.writeToDevice({
        device,
        auditName: 'custom-patches',
        writes: [{ path: ['.kobo', 'KoboRoot.tgz'], data: bytes('tgz-bytes'), label: 'Wrote KoboRoot.tgz' }],
    });

    assert.equal(result.ok, true);
    assert.equal(text(device.writeFor('.kobo/KoboRoot.tgz').data), 'tgz-bytes');

    // The run's audit log is persisted under .kobopatch-webui/logs/ and records the step.
    const auditWrite = device.writes.find((w) => w.path.startsWith(`${AUDIT_LOG_DIRECTORY}/logs/`));
    assert.ok(auditWrite, 'expected an audit log file to be written');
    assert.match(text(auditWrite.data), /Wrote KoboRoot\.tgz/);
    assert.equal(errors.length, 0);
});

test('writeToDevice routes a failed required write to the error screen with the audit log', async () => {
    const device = new RecordingDevice({ failWritePath: '.kobo/KoboRoot.tgz' });
    const errors = [];
    const terminal = createTerminal({ doneStep: {}, showError: (...args) => errors.push(args) });

    const result = await terminal.writeToDevice({
        device,
        auditName: 'custom-patches',
        writes: [{ path: ['.kobo', 'KoboRoot.tgz'], data: bytes('x'), label: 'w' }],
        failMessage: (err) => `Write failed: ${err.message}`,
    });

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.equal(errors.length, 1);
    const [message, log, options] = errors[0];
    assert.match(message, /Write failed: Refusing write to \.kobo\/KoboRoot\.tgz/);
    assert.equal(log, null);
    assert.ok(options.auditLog, 'error carries the audit log for download');
});

test('writeToDevice aborts on a failed write and leaves earlier changes in place (no rollback)', async () => {
    const device = new RecordingDevice({ failWritePath: '.kobo/KoboRoot.tgz' });
    const errors = [];
    const terminal = createTerminal({ doneStep: {}, showError: (...args) => errors.push(args) });

    const result = await terminal.writeToDevice({
        device,
        auditName: 'custom-patches',
        writes: [
            { path: ['.kobopatch-webui', 'custom-patches.json'], data: bytes('{}'), label: 'manifest' },
            { path: ['.kobo', 'KoboRoot.tgz'], data: bytes('x'), label: 'tgz' },
        ],
    });

    assert.equal(result.ok, false);
    assert.ok(result.error);
    // The app stops on the first write failure and does NOT try to undo earlier
    // writes — the connection or filesystem may be unreliable. The manifest that
    // was written before the failure is left exactly as it is.
    assert.equal(await device.pathExists(['.kobopatch-webui', 'custom-patches.json']), true);
    assert.equal(result.rollback, undefined);

    const [, , options] = errors[0];
    assert.equal(options.deviceWrite, true);
    assert.ok(options.auditLog, 'error carries the audit log for download');
    assert.equal(options.rollbackInstructions, undefined);
});

test('writeToDevice skips a failing optional write without failing the operation', async () => {
    const device = new RecordingDevice({ failWritePath: '.kobopatch-webui/custom-patches.json' });
    const errors = [];
    const terminal = createTerminal({ doneStep: {}, showError: (...args) => errors.push(args) });

    const originalWarn = console.warn;
    console.warn = () => {};
    let result;
    try {
        result = await terminal.writeToDevice({
            device,
            auditName: 'custom-patches',
            writes: [
                { path: ['.kobo', 'KoboRoot.tgz'], data: bytes('tgz'), label: 'wrote tgz' },
                {
                    path: ['.kobopatch-webui', 'custom-patches.json'],
                    data: bytes('{}'),
                    label: 'wrote manifest',
                    optional: true,
                },
            ],
        });
    } finally {
        console.warn = originalWarn;
    }

    assert.equal(result.ok, true);
    assert.ok(device.writeFor('.kobo/KoboRoot.tgz'));
    assert.equal(device.writeFor('.kobopatch-webui/custom-patches.json'), undefined);
    assert.equal(errors.length, 0);
});

test('wireFeedback resets the widget state when the done step is revisited', async () => {
    await withDom(async (document) => {
        const terminal = createTerminal({ doneStep: document.getElementById('done-step'), showError: () => {} });
        const widget = document.querySelector('.feedback');
        const textEl = widget.querySelector('.feedback-text');
        const thanksEl = widget.querySelector('.feedback-thanks');
        const donateEl = widget.querySelector('.feedback-donate');
        const upButton = widget.querySelector('[data-vote="up"]');

        terminal.wireFeedback();
        upButton.click();
        assert.equal(textEl.hidden, true);
        assert.equal(thanksEl.hidden, true);
        assert.equal(donateEl.hidden, false);

        terminal.wireFeedback();
        assert.equal(widget.hidden, false);
        assert.equal(textEl.hidden, false);
        assert.equal(thanksEl.hidden, true);
        assert.equal(donateEl.hidden, true);
        assert.equal(upButton.hidden, false);
        assert.equal(upButton.disabled, false);
    });
});

test('wireFeedback only shows the donate follow-up for thumbs up', async () => {
    await withDom(async (document) => {
        const votes = [];
        document.defaultView.umami = {
            track: (event, props) => votes.push([event, props]),
        };
        const terminal = createTerminal({
            doneStep: document.getElementById('done-step'),
            showError: () => {},
        });
        const widget = document.querySelector('.feedback');
        const thanksEl = widget.querySelector('.feedback-thanks');
        const donateEl = widget.querySelector('.feedback-donate');
        const upButton = widget.querySelector('[data-vote="up"]');
        const downButton = widget.querySelector('[data-vote="down"]');

        terminal.wireFeedback();
        upButton.click();
        assert.equal(donateEl.hidden, false);
        assert.equal(thanksEl.hidden, true);

        terminal.wireFeedback();
        downButton.click();
        assert.equal(donateEl.hidden, true);
        assert.equal(thanksEl.hidden, false);
        assert.deepEqual(votes, [
            ['feedback', { vote: 'up' }],
            ['feedback', { vote: 'down' }],
        ]);
    });
});
