import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

function installDialogStub(window) {
    const Dialog = window.HTMLDialogElement;
    if (!Dialog) return;

    Dialog.prototype.show = function show() {
        this.open = true;
    };
    Dialog.prototype.showModal = function showModal() {
        this.open = true;
    };
    Dialog.prototype.close = function close(returnValue) {
        if (returnValue !== undefined) this.returnValue = returnValue;
        this.open = false;
        this.dispatchEvent(new window.Event('close'));
    };
}

function createChromeDom(hostname) {
    const dom = new JSDOM(
        `<!doctype html><html><body>
        <span id="env-pill" hidden></span>
        <a href="#main-content" class="skip-link">Skip to content</a>
        <main id="main-content" tabindex="-1"></main>
        <a id="btn-how-it-works" href="#"></a>
        <dialog id="how-it-works-dialog"><button id="btn-close-dialog" type="button"></button></dialog>
        <a id="btn-credits" href="#"></a>
        <dialog id="credits-dialog"><button id="btn-close-credits" type="button"></button></dialog>
        <dialog id="hint-dialog"><button id="btn-hint-close" type="button"></button></dialog>
        <a id="btn-privacy" href="#" hidden></a>
        <span id="privacy-link-separator" hidden></span>
        <dialog id="privacy-dialog"><button id="btn-close-privacy" type="button"></button></dialog>
        <dialog id="mobile-dialog"><button id="btn-mobile-continue" type="button"></button></dialog>
    </body></html>`,
        {
            url: `https://${hostname}/`,
            pretendToBeVisual: true,
        },
    );
    installDialogStub(dom.window);
    return dom;
}

async function withChromeDom(hostname, run) {
    const dom = createChromeDom(hostname);
    const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const previousDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

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
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        writable: true,
        value: dom.window.navigator,
    });
    window.__ANALYTICS_ENABLED = false;

    try {
        const { initGlobalUI } = await import(`../../src/js/shell/global-ui.js?host=${hostname}&t=${Date.now()}`);
        initGlobalUI();
        await run(dom.window.document);
    } finally {
        if (previousWindowDescriptor) Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
        else delete globalThis.window;

        if (previousDocumentDescriptor) Object.defineProperty(globalThis, 'document', previousDocumentDescriptor);
        else delete globalThis.document;

        if (previousNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', previousNavigatorDescriptor);
        else delete globalThis.navigator;
    }
}

test('preview host shows both the preview pill and banner', async () => {
    await withChromeDom('kp-dev.nicoverbruggen.be', async (document) => {
        const pill = document.getElementById('env-pill');
        const banner = document.getElementById('preview-banner');

        assert.equal(pill.hidden, false);
        assert.equal(pill.textContent, 'Preview');
        assert.equal(banner.hidden, false);
    });
});

test('preview banner can be dismissed', async () => {
    await withChromeDom('kp-dev.nicoverbruggen.be', async (document) => {
        const banner = document.getElementById('preview-banner');
        document.getElementById('btn-preview-banner-close').click();
        assert.equal(document.getElementById('preview-banner'), null);
        assert.ok(banner);
    });
});

test('dev builds show the dev pill and preview banner on non-preview hosts', async () => {
    globalThis.__DEV_BUILD__ = true;

    try {
        await withChromeDom('localhost', async (document) => {
            const pill = document.getElementById('env-pill');
            const banner = document.getElementById('preview-banner');

            assert.equal(pill.hidden, false);
            assert.equal(pill.textContent, 'Under Development');
            assert.equal(banner.hidden, false);
        });
    } finally {
        delete globalThis.__DEV_BUILD__;
    }
});

test('stable hosts do not inject the preview banner', async () => {
    await withChromeDom('kp.nicoverbruggen.be', async (document) => {
        assert.equal(document.getElementById('preview-banner'), null);
        assert.equal(document.getElementById('env-pill').hidden, true);
    });
});
