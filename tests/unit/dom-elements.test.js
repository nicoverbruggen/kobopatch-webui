import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

// `bindElements()` and `requireElement()` are the eager existence check every
// screen leans on: a mistyped or removed id must fail at init time, naming the
// id so the markup is findable. These tests pin that contract down, for the map
// form the shell screens use and the single-element form the step classes use.

async function withDom(html, run) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

    // `requireInput` and friends assert with `window.HTMLInputElement`, so the
    // window has to be the same realm the elements come from.
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: dom.window.document });
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: dom.window });

    try {
        const dommod = await import('../../src/js/shell/DOM.js');
        await run(dommod, dom.window.document);
    } finally {
        if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
        else delete globalThis.document;
        if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
        else delete globalThis.window;
    }
}

test('bindElements maps every alias to the matching element', async () => {
    await withDom('<div id="step-connect"></div><button id="btn-connect"></button>', async ({ bindElements }, document) => {
        const elements = bindElements({ stepConnect: 'step-connect', btnConnect: 'btn-connect' });

        assert.deepEqual(Object.keys(elements), ['stepConnect', 'btnConnect']);
        assert.equal(elements.stepConnect, document.getElementById('step-connect'));
        assert.equal(elements.btnConnect, document.getElementById('btn-connect'));
    });
});

test('bindElements throws naming the DOM id, not the alias', async () => {
    await withDom('<div id="step-connect"></div>', async ({ bindElements }) => {
        assert.throws(
            () => bindElements({ btnConnect: 'btn-connect' }),
            (err) => {
                assert.ok(err instanceof Error);
                assert.equal(err.message, 'Element #btn-connect not found');
                assert.ok(!err.message.includes('btnConnect'));
                return true;
            },
        );
    });
});

test('bindElements throws on the first missing id in map order', async () => {
    await withDom('<div id="step-connect"></div>', async ({ bindElements }) => {
        assert.throws(
            () =>
                bindElements({
                    stepConnect: 'step-connect',
                    btnConnect: 'btn-connect',
                    deviceStatus: 'device-status',
                }),
            /Element #btn-connect not found/,
        );
    });
});

test('bindElements returns a frozen object', async () => {
    await withDom('<div id="step-connect"></div>', async ({ bindElements }) => {
        const elements = bindElements({ stepConnect: 'step-connect' });

        assert.ok(Object.isFrozen(elements));
        assert.throws(() => {
            elements.stepConnect = null;
        }, TypeError);
    });
});

test('bindElements with an empty map returns an empty frozen object', async () => {
    await withDom('', async ({ bindElements }) => {
        const elements = bindElements({});

        assert.deepEqual(Object.keys(elements), []);
        assert.ok(Object.isFrozen(elements));
    });
});

test('requireElement returns the element, or throws naming the id', async () => {
    await withDom('<div id="step-connect"></div>', async ({ requireElement }, document) => {
        assert.equal(requireElement('step-connect'), document.getElementById('step-connect'));
        assert.throws(() => requireElement('btn-connect'), /^Error: Element #btn-connect not found$/);
    });
});

test('the typed lookups return the element when the tag matches', async () => {
    const markup = '<input id="nm-keep-items" type="checkbox"><button id="btn-nm-next"></button><dialog id="nm-tabs-dialog"></dialog>';
    await withDom(markup, async ({ requireInput, requireButton, requireDialog }, document) => {
        assert.equal(requireInput('nm-keep-items'), document.getElementById('nm-keep-items'));
        assert.equal(requireButton('btn-nm-next'), document.getElementById('btn-nm-next'));
        assert.equal(requireDialog('nm-tabs-dialog'), document.getElementById('nm-tabs-dialog'));
    });
});

test('the typed lookups throw naming the id and the expected tag on a mismatch', async () => {
    await withDom('<div id="nm-keep-items"></div>', async ({ requireInput, requireButton, requireDialog }) => {
        assert.throws(() => requireInput('nm-keep-items'), /^Error: Element #nm-keep-items is not a <input>$/);
        assert.throws(() => requireButton('nm-keep-items'), /^Error: Element #nm-keep-items is not a <button>$/);
        assert.throws(() => requireDialog('nm-keep-items'), /^Error: Element #nm-keep-items is not a <dialog>$/);
    });
});

test('the typed lookups still throw the missing-element error first', async () => {
    // The tag assertion must not mask a missing id: the message a developer needs
    // is "this id is not in the markup", not "this is not a <button>".
    await withDom('', async ({ requireInput, requireButton, requireDialog }) => {
        assert.throws(() => requireInput('nope'), /Element #nope not found/);
        assert.throws(() => requireButton('nope'), /Element #nope not found/);
        assert.throws(() => requireDialog('nope'), /Element #nope not found/);
    });
});
