import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

async function withDom(run) {
    const dom = new JSDOM(`<!doctype html><html><body><div id="nm-customize-presets"></div></body></html>`, {
        url: 'https://example.test/',
        pretendToBeVisual: true,
    });

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

    try {
        const mod = await import(`../../src/js/nickelmenu/customization-dialog.js?t=${Date.now()}`);
        await run({ document: dom.window.document, ...mod });
    } finally {
        if (previousWindowDescriptor) Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
        else delete globalThis.window;

        if (previousDocumentDescriptor) Object.defineProperty(globalThis, 'document', previousDocumentDescriptor);
        else delete globalThis.document;
    }
}

test('renderNmCustomizationPresets reuses the rendered grid but updates the click callback', async () => {
    await withDom(async ({ document, renderNmCustomizationPresets }) => {
        const container = document.getElementById('nm-customize-presets');
        const firstSelections = [];
        const secondSelections = [];

        renderNmCustomizationPresets(container, async (icon) => {
            firstSelections.push(icon.id);
        });
        container.querySelector('[data-icon-id="book"]').click();

        renderNmCustomizationPresets(container, async (icon) => {
            secondSelections.push(icon.id);
        });
        container.querySelector('[data-icon-id="cat"]').click();

        assert.deepEqual(firstSelections, ['book']);
        assert.deepEqual(secondSelections, ['cat']);
    });
});

test('handleNmIconUpload ignores stale async completions', async () => {
    await withDom(async (mod) => {
        const file = {
            name: 'icon.svg',
            type: 'image/svg+xml',
            text: async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
        };
        const draft = { icon: { type: 'default' } };
        const messages = [];
        const originalCreateObjectURL = window.URL.createObjectURL;
        const originalRevokeObjectURL = window.URL.revokeObjectURL;
        window.URL.createObjectURL = () => 'blob:test';
        window.URL.revokeObjectURL = () => {};

        try {
            await mod.handleNmIconUpload(
                file,
                draft,
                (msg) => messages.push(msg),
                () => false,
            );
            assert.deepEqual(draft, { icon: { type: 'default' } });
            assert.deepEqual(messages, []);
        } finally {
            window.URL.createObjectURL = originalCreateObjectURL;
            window.URL.revokeObjectURL = originalRevokeObjectURL;
        }
    });
});

function makeMenuDialog(document) {
    const dialog = document.createElement('dialog');
    dialog.showModal = () => {
        dialog.open = true;
    };
    return {
        dialog,
        labelInput: document.createElement('input'),
        counter: document.createElement('span'),
        presets: document.createElement('div'),
        uploadPreview: document.createElement('div'),
        uploadName: document.createElement('span'),
        save: document.createElement('button'),
        status: document.createElement('span'),
    };
}

function controlPresetRendering(window, document) {
    const pending = [];
    const realImage = window.Image;
    const realCreateElement = document.createElement.bind(document);

    window.Image = class {
        set src(_value) {
            pending.push(this);
        }
    };
    document.createElement = (tag, ...rest) => {
        if (String(tag).toLowerCase() !== 'canvas') return realCreateElement(tag, ...rest);
        return {
            width: 0,
            height: 0,
            getContext: () => ({ clearRect() {}, drawImage() {} }),
            toBlob: (callback) => callback(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
        };
    };

    return {
        restore() {
            window.Image = realImage;
            document.createElement = realCreateElement;
        },
        async finish() {
            assert.equal(pending.length, 1);
            pending.pop().onload();
            for (let index = 0; index < 10; index++) await Promise.resolve();
        },
        async fail() {
            assert.equal(pending.length, 1);
            pending.pop().onerror();
            for (let index = 0; index < 10; index++) await Promise.resolve();
        },
    };
}

test('a preset render that finishes after the menu dialog reopens is ignored', async () => {
    await withDom(async ({ document, openMenuCustomizeDialog }) => {
        const dialogDom = makeMenuDialog(document);
        const rendering = controlPresetRendering(window, document);
        const state = { nickelMenuCustomization: { label: 'Toggle', icon: { type: 'default' } } };

        try {
            openMenuCustomizeDialog(state, dialogDom, null);
            dialogDom.presets.querySelector('[data-icon-id="book"]').click();

            const reopenedDraft = openMenuCustomizeDialog(state, dialogDom, null);
            const reopenedStatus = dialogDom.status.textContent;
            await rendering.finish();

            assert.equal(reopenedDraft.icon.type, 'default');
            assert.equal(dialogDom.status.textContent, reopenedStatus);
        } finally {
            rendering.restore();
        }
    });
});

test('a preset render that finishes in its original menu session still applies', async () => {
    await withDom(async ({ document, openMenuCustomizeDialog }) => {
        const dialogDom = makeMenuDialog(document);
        const rendering = controlPresetRendering(window, document);
        const state = { nickelMenuCustomization: { label: 'Toggle', icon: { type: 'default' } } };

        try {
            const draft = openMenuCustomizeDialog(state, dialogDom, null);
            dialogDom.presets.querySelector('[data-icon-id="book"]').click();
            await rendering.finish();

            assert.equal(draft.icon.type, 'preset');
            assert.equal(draft.icon.id, 'book');
            assert.deepEqual(draft.icon.data, new Uint8Array([1, 2, 3]));
        } finally {
            rendering.restore();
        }
    });
});

test('a stale preset-render failure does not overwrite the reopened dialog status', async () => {
    await withDom(async ({ document, openMenuCustomizeDialog }) => {
        const dialogDom = makeMenuDialog(document);
        const rendering = controlPresetRendering(window, document);
        const state = { nickelMenuCustomization: { label: 'Toggle', icon: { type: 'default' } } };

        try {
            openMenuCustomizeDialog(state, dialogDom, null);
            dialogDom.presets.querySelector('[data-icon-id="book"]').click();

            openMenuCustomizeDialog(state, dialogDom, null);
            const reopenedStatus = dialogDom.status.textContent;
            await rendering.fail();

            assert.equal(dialogDom.status.textContent, reopenedStatus);
        } finally {
            rendering.restore();
        }
    });
});
