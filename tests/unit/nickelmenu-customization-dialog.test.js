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
        // Split across two modules in Phase 5: the preset grid lives with the
        // dialog, the image pipeline next door.
        const stamp = Date.now();
        const dialogMod = await import(`../../src/js/nickelmenu/features/custom-menu/MenuCustomizationDialog.js?t=${stamp}`);
        const imageMod = await import(`../../src/js/nickelmenu/features/custom-menu/MenuIconImages.js?t=${stamp}`);
        await run({ document: dom.window.document, ...dialogMod, ...imageMod });
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
