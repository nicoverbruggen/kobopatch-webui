import './dom-harness.js'; // the real markup, which is the whole point of this file

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { requireInput, requireSelect } from '../../src/js/shell/DOM.js';
import { Wizard } from '../../src/js/Wizard.js';
import { Session } from '../../src/js/shell/Session.js';

// THIS FILE IS THE BOOT CHECK. Do not stub the flows to make it faster.
//
// Roughly two dozen classes look their elements up in their constructors with
// the typed `require*` helpers. A wrong helper — `requireInput` on a `<select>`,
// say — throws at construction and takes the whole app down at boot, and the
// only thing that catches it before the 90-second E2E gate is a unit test that
// builds the real object graph. That has shipped once: two `<select>`s bound
// with `requireInput` went past 531 green unit tests.
//
// So this does not describe the invariant, it checks it: discover every class in
// `src/js/` that looks an element up in its constructor, build a real `Wizard`,
// and assert each one was actually constructed. Add a screen, step, dialog or
// component and forget to wire it in, and this fails by name.
//
// Two properties worth preserving if you edit it:
//
//   - **Matching is by class identity, never by name.** `nickelmenu/DoneStep`
//     and `patches/DoneStep` are two different classes with one name, and a
//     name-keyed check reports success when only one of them is built. The
//     file-named-after-class rule guarantees more of these collisions.
//   - **Discovery has to be over-broad rather than under-broad.** A class this
//     file fails to *find* is never checked and says nothing about it; a class
//     it finds but cannot place fails loudly, and EXEMPTIONS is the escape
//     hatch for the rare legitimate case.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'js');
const LOOKUP_CALL = /\brequire(?:Element|Input|Button|Dialog|Select)\(/;

/**
 * Classes that do a constructor lookup but are deliberately not built by the
 * wizard. Every entry needs a reason and its own construction test, and the
 * staleness check below removes the entry's excuse the moment it stops applying.
 *
 * @type {{file: string, name: string, reason: string}[]}
 */
const EXEMPTIONS = [];

/** Every `src/js` file whose source contains a constructor-time element lookup. */
function filesWithLookups(dir = srcDir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...filesWithLookups(path));
            continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        if (LOOKUP_CALL.test(readFileSync(path, 'utf8'))) found.push(path);
    }
    return found;
}

/**
 * The names a module exports classes under, covering both house styles:
 * `export class X`, and `class X {}` re-exported later via `export { X }` —
 * including `export { X as Y }`, where `Y` is the name to import.
 */
function exportedClassNames(source) {
    const names = new Set();
    for (const match of source.matchAll(/^export\s+class\s+(\w+)/gm)) names.add(match[1]);

    const declaredLocally = new Set([...source.matchAll(/^class\s+(\w+)/gm)].map((match) => match[1]));
    for (const block of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const clause of block[1].split(',')) {
            const [local, exported = local] = clause.split(/\s+as\s+/).map((part) => part.trim());
            if (local && declaredLocally.has(local)) names.add(exported);
        }
    }
    return names;
}

/** Every constructor-lookup class in `src/js`, as the actual class object. */
async function declaredLookupClasses() {
    const found = [];
    for (const path of filesWithLookups()) {
        const names = exportedClassNames(readFileSync(path, 'utf8'));
        if (names.size === 0) continue;
        const module = await import(pathToFileURL(path).href);
        for (const name of names) {
            if (typeof module[name] === 'function') {
                found.push({ name, file: path.slice(srcDir.length + 1), ctor: module[name] });
            }
        }
    }
    return found;
}

/**
 * Every class *object* reachable from `root` by walking own properties, taking
 * the whole prototype chain of each object found — so an abstract base counts as
 * covered when one of its subclasses is built.
 *
 * Identity, not names: see the header.
 */
function reachableConstructors(root) {
    const constructors = new Set();
    const seen = new Set();
    const queue = [root];

    while (queue.length) {
        const value = queue.pop();
        if (value === null || typeof value !== 'object' || seen.has(value)) continue;
        seen.add(value);

        for (let proto = Object.getPrototypeOf(value); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
            if (typeof proto.constructor === 'function') constructors.add(proto.constructor);
        }

        // Containers hold the interesting objects — the dialog registry is a Map,
        // a flow's steps are an Array — so anything iterable has to be descended
        // into or the classes inside it are invisible.
        if (value instanceof Map) queue.push(...value.values());
        else if (value instanceof Set) queue.push(...value);
        else if (Array.isArray(value)) queue.push(...value);
        else if (!(value instanceof window.Node)) queue.push(...Object.values(value));
    }
    return constructors;
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

const isExempt = ({ file, name }) => EXEMPTIONS.some((entry) => entry.file === file && entry.name === name);

test('every class that looks its elements up in a constructor is built when the app boots', async () => {
    const declared = await declaredLookupClasses();
    assert.ok(declared.length >= 20, `expected to discover the constructor-lookup classes, found ${declared.length}`);

    const wizard = new Wizard(makeSession());
    const reachable = reachableConstructors(wizard);

    const unbuilt = declared.filter((entry) => !reachable.has(entry.ctor) && !isExempt(entry));

    assert.deepEqual(
        unbuilt.map(({ name, file }) => `${file} -> ${name}`),
        [],
        'These classes look elements up in their constructors, but building a real Wizard does not construct them, ' +
            'so a wrong require* helper in them would reach production uncaught.\n\n' +
            'Fix it one of two ways:\n' +
            '  1. Wire the class into the object graph the wizard builds (usually the right answer), or\n' +
            "  2. if it is deliberately built elsewhere, give it its own construction test and add it to this file's\n" +
            '     EXEMPTIONS list with a reason. Exemptions are checked for staleness, so a wrong one fails too.\n\n' +
            'Do NOT narrow the discovery regex or delete this test: either silently drops the other classes.',
    );

    wizard.destroy();
});

test('the exemption list does not rot', async () => {
    // An exemption that no longer applies is worse than none: it hides a class
    // that has quietly become checkable, or names one that no longer exists.
    const declared = await declaredLookupClasses();
    const wizard = new Wizard(makeSession());
    const reachable = reachableConstructors(wizard);

    for (const entry of EXEMPTIONS) {
        const match = declared.find(({ file, name }) => file === entry.file && name === entry.name);
        assert.ok(match, `EXEMPTIONS names ${entry.file} -> ${entry.name}, which no longer does a constructor lookup. Delete the entry.`);
        assert.ok(!reachable.has(match.ctor), `EXEMPTIONS names ${entry.file} -> ${entry.name}, but the wizard now builds it. Delete the entry.`);
        assert.ok(entry.reason?.length > 0, `EXEMPTIONS entry ${entry.file} -> ${entry.name} needs a reason.`);
    }

    wizard.destroy();
});

test('discovery finds both export styles, and tells same-named classes apart', async () => {
    // The two ways this check can lie to you, pinned directly rather than left to
    // the integration test above.
    const declared = await declaredLookupClasses();

    // `nickelmenu/DoneStep` and `patches/DoneStep` share a name and must be two
    // distinct entries carrying two distinct class objects.
    const doneSteps = declared.filter(({ name }) => name === 'DoneStep');
    assert.equal(doneSteps.length, 2, 'both DoneStep classes are discovered separately');
    assert.notEqual(doneSteps[0].ctor, doneSteps[1].ctor, 'and they are different classes, so identity can tell them apart');

    // `class X {}` + `export { X }` is the house style in four files; a discovery
    // regex that only matched `export class X` would never see them.
    assert.deepEqual([...exportedClassNames('class Hidden {\n}\nexport { Hidden };\n')], ['Hidden']);
    assert.deepEqual([...exportedClassNames('class Local {\n}\nexport { Local as Renamed };\n')], ['Renamed']);
    assert.deepEqual([...exportedClassNames('export class Plain {\n}\n')], ['Plain']);
    assert.deepEqual([...exportedClassNames('const notAClass = 1;\nexport { notAClass };\n')], []);
});

test('a wrong element helper in any of those classes fails here, not in the browser', () => {
    // The mechanism this file protects, demonstrated rather than described:
    // `requireSelect` on a checkbox throws, and it throws during construction.
    assert.throws(() => requireSelect('nm-keep-items'), /is not a <select>/);
    assert.doesNotThrow(() => requireInput('nm-keep-items'));
});
