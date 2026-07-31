import './dom-harness.js'; // the real markup, which is the whole point of this file

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireInput, requireSelect } from '../../src/js/shell/dom.js';
import { Wizard } from '../../src/js/Wizard.js';
import { Session } from '../../src/js/shell/session.js';

// THIS FILE IS THE BOOT CHECK. Do not stub the flows to make it faster.
//
// Roughly two dozen classes look their elements up in their constructors with
// the typed `require*` helpers. A wrong helper — `requireInput` on a `<select>`,
// say — throws at construction and takes the whole app down at boot, and the
// only thing that catches it before the 90-second E2E gate is a unit test that
// builds the real object graph.
//
// That coverage used to be a side effect of `wizard.test.js` happening not to
// stub `PatchesFlow` and `NickelMenuFlow`, documented only in a comment. This
// file makes it an enforced invariant instead: it discovers every class in
// `src/js/` that does a constructor lookup, builds a real `Wizard`, and asserts
// each one was actually constructed. Add a screen, a step, a dialog or a
// component and forget to wire it in, and this fails by name.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'js');
const LOOKUP_CALL = /\brequire(?:Element|Input|Button|Dialog|Select)\(/;

/** Every `src/js` file that looks an element up, paired with the classes it exports. */
function classesWithConstructorLookups(dir = srcDir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...classesWithConstructorLookups(path));
            continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        const source = readFileSync(path, 'utf8');
        if (!LOOKUP_CALL.test(source)) continue;
        for (const match of source.matchAll(/^export class (\w+)/gm)) {
            found.push({ name: match[1], file: path.slice(srcDir.length + 1) });
        }
    }
    return found;
}

/**
 * Every class name reachable from `root` by walking own properties, including
 * the prototype chain of each object found — so an abstract base counts as
 * covered when one of its subclasses is built.
 */
function reachableClassNames(root) {
    const names = new Set();
    const seen = new Set();
    const queue = [root];

    while (queue.length) {
        const value = queue.pop();
        if (value === null || typeof value !== 'object' || seen.has(value)) continue;
        seen.add(value);

        for (let proto = Object.getPrototypeOf(value); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
            if (proto.constructor?.name) names.add(proto.constructor.name);
        }

        if (value instanceof Map) queue.push(...value.values());
        else if (Array.isArray(value)) queue.push(...value);
        else if (!(value instanceof window.Node)) queue.push(...Object.values(value));
    }
    return names;
}

function makeSession() {
    return new Session({
        device: { reset: () => {}, directoryHandle: null },
        patchUI: {
            onChange: null,
            render: () => {},
            getEnabledCount: () => 0,
            getAdditionalFileCount: () => 0,
            getAdditionalFiles: () => [],
            validateAdditionalFiles: () => ({ ok: true, message: '' }),
            hasEdits: () => false,
        },
        runner: {},
        nmInstaller: {},
        getSoftwareUrl: () => null,
        softwareUrlsReady: Promise.resolve(),
        blacklistReady: Promise.resolve(),
    });
}

test('every class that looks its elements up in a constructor is built when the app boots', () => {
    const declared = classesWithConstructorLookups();
    assert.ok(declared.length >= 20, `expected to discover the constructor-lookup classes, found ${declared.length}`);

    const wizard = new Wizard(makeSession());
    const reachable = reachableClassNames(wizard);
    reachable.add('Wizard');

    const unreachable = declared.filter(({ name }) => !reachable.has(name));

    assert.deepEqual(
        unreachable,
        [],
        `These classes look elements up in their constructors but nothing builds them here, so a wrong ` +
            `require* helper in them would reach production uncaught. Either construct them from the wizard, ` +
            `or give them their own construction test and add them to this file's exemption list:\n` +
            unreachable.map(({ name, file }) => `  ${name} (${file})`).join('\n'),
    );

    wizard.destroy();
});

test('a wrong element helper in any of those classes fails here, not in the browser', () => {
    // The mechanism this file protects, demonstrated rather than described:
    // `requireSelect` on a checkbox throws, and it throws during construction.
    assert.throws(() => requireSelect('nm-keep-items'), /is not a <select>/);
    assert.doesNotThrow(() => requireInput('nm-keep-items'));
});
