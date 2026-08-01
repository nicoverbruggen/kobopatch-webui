/**
 * check-imports.mjs — every module specifier resolves, case-exactly, and git's
 * index agrees with the disk.
 *
 * Nothing else in the toolchain checks either half. ESLint does not resolve
 * paths, Prettier does not read them, and a test only fails for a module
 * something actually imports at runtime. That leaves two blind spots:
 *
 *   1. **JSDoc `import('...')` type paths.** Pure comments today, so a stale one
 *      is invisible until the TypeScript conversion turns it into a confusing
 *      "cannot find module".
 *   2. **Case.** macOS resolves `shell/dom.js` and `shell/DOM.js` to the same
 *      file, so a wrong-case specifier — or a rename git recorded under the old
 *      name — passes every local check and fails on Linux CI.
 *
 * Both halves are reported separately, because they have different fixes:
 *
 *   - **Unresolved specifiers** are a source edit.
 *   - **Index drift** is a `git mv --force`, which stages, so it belongs to
 *     whoever owns the repository's git state — not to a build step.
 *
 * Case is taken from `readdirSync`, which returns the name as stored: on a
 * case-preserving filesystem that is the only local source of truth, since
 * `existsSync` cannot tell the two spellings apart.
 *
 * **This is a bridge, not a fixture.** Once TypeScript lands, `tsc` resolves
 * every one of these — including the JSDoc ones under `checkJs` — and this phase
 * should be deleted rather than maintained beside it.
 *
 *   node scripts/check-imports.mjs
 *   node scripts/check-imports.mjs --selftest   # prove it can fail
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const ROOTS = ['src/js', 'tests', 'scripts', 'tools'];
const EXTRA_FILES = ['vite.config.mjs'];
const SKIP_DIRS = new Set(['node_modules', 'cached_assets', 'screenshots', '.git']);

/**
 * The vendored Go toolchain. It ships its own JS (`wasm_exec.js`, pprof's
 * bundled viewers) which we never edit and cannot fix, so a re-vendor must not
 * be able to fail this gate. Our own tooling under `tools/` stays in scope.
 */
const SKIP_PATHS = ['tools/kobopatch-wasm/go/'];

/** Documents whose filename references must all resolve. See `docReferences`. */
const DOCS = ['AGENTS.md', 'PROJECT.md', 'CONVENTIONS.md', 'README.md'];

/**
 * Specifier forms. `require()` matters because the whole E2E suite is CommonJS;
 * the template form matters because a few call sites append a cache-busting
 * query, and the part before the first `${` is still a real path.
 */
const FORMS = [
    { re: /\bfrom\s+'([^']+)'/g, kind: 'import' },
    { re: /\bfrom\s+"([^"]+)"/g, kind: 'import' },
    { re: /\bimport\s*\(\s*'([^']+)'\s*\)/g, kind: 'import()' },
    { re: /\bimport\s*\(\s*"([^"]+)"\s*\)/g, kind: 'import()' },
    { re: /\bimport\s*\(\s*`([^`]+)`\s*\)/g, kind: 'import() template' },
    { re: /\brequire\s*\(\s*'([^']+)'\s*\)/g, kind: 'require()' },
    { re: /\brequire\s*\(\s*"([^"]+)"\s*\)/g, kind: 'require()' },
    { re: /paths\.src\(\s*'([^']+)'\s*\)/g, kind: 'paths.src()' },
];

/**
 * Paths assembled from literal segments — `path.join(__dirname, '..', 'src', …)`.
 *
 * Not a specifier at all, so no import scanner sees it, and a rename leaves it
 * pointing at nothing until whatever loads it actually runs. One of these broke
 * the fonts E2E spec during the Phase 6 sweep, which is why it is checked here.
 */
const JOINED_PATH = /\bpath\.join\(\s*__dirname\s*,\s*([^)]*?)\)/g;

function joinedTargets(source, file) {
    const out = [];
    for (const match of source.matchAll(JOINED_PATH)) {
        const parts = [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
        if (!parts.length || !/\.[a-z]+$/.test(parts.at(-1))) continue;
        out.push({ spec: parts.join('/'), target: relative(REPO, resolve(dirname(join(REPO, file)), ...parts)), kind: 'path.join()' });
    }
    return out;
}

/** Repo-relative paths of everything on disk, spelled as the filesystem stores them. */
function filesOnDisk(dir = REPO, out = new Set()) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) filesOnDisk(abs, out);
        else out.add(relative(REPO, abs));
    }
    return out;
}

// This file is excluded from its own scan: its documentation necessarily quotes
// the specifier forms it looks for.
const SELF = 'scripts/check-imports.mjs';
const inScope = (f) =>
    f !== SELF &&
    /\.(js|mjs|cjs)$/.test(f) &&
    !SKIP_PATHS.some((prefix) => f.startsWith(prefix)) &&
    (ROOTS.some((r) => f.startsWith(r + '/')) || EXTRA_FILES.includes(f));

/**
 * Resolve the way the loader does. ESM needs the extension, CommonJS does not —
 * and the E2E suite is entirely CommonJS — so an extensionless specifier is
 * tried against each extension and then as a directory index.
 */
function resolves(onDisk, target) {
    if (onDisk.has(target)) return true;
    for (const ext of ['.js', '.mjs', '.cjs', '.json']) if (onDisk.has(target + ext)) return true;
    for (const ext of ['.js', '.mjs', '.cjs']) if (onDisk.has(join(target, 'index' + ext))) return true;
    return false;
}

/** Whether an offset sits inside a `//` line comment or a `*` block-comment line. */
function inComment(source, index) {
    const lineStart = source.lastIndexOf('\n', index) + 1;
    const before = source.slice(lineStart, index);
    return before.includes('//') || /^\s*\*/.test(before);
}

/** A template specifier is usable up to its first interpolation. */
const staticPrefix = (spec) => (spec.includes('${') ? spec.slice(0, spec.indexOf('${')) : spec);

function checkSpecifiers(onDisk, files) {
    const problems = [];
    let checked = 0;

    for (const file of files) {
        const source = readFileSync(join(REPO, file), 'utf8');
        for (const { re, kind } of FORMS) {
            for (const match of source.matchAll(re)) {
                const spec = staticPrefix(match[1]).split('?')[0];
                if (!spec) continue;
                // A `require()` is never a type annotation, so one inside a
                // comment is prose — a shell example, or a note about a path.
                // JSDoc's `import('...')` is the opposite case and must be kept,
                // which is most of the value here.
                if (kind === 'require()' && inComment(source, match.index)) continue;

                let target;
                if (kind === 'paths.src()') target = join('src', spec);
                else if (spec.startsWith('.')) target = relative(REPO, resolve(dirname(join(REPO, file)), spec));
                else continue; // bare package specifier

                checked++;
                if (!resolves(onDisk, target)) problems.push({ file, spec, kind, target });
            }
        }
        for (const j of joinedTargets(source, file)) {
            checked++;
            if (!resolves(onDisk, j.target)) problems.push({ file, ...j });
        }
    }
    return { problems, checked };
}

/** Files git tracks under a different spelling than the disk uses. */
const trackedFiles = () => execFileSync('git', ['-C', REPO, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

/** `tracked` is injectable so the selftest can prove this half with a synthetic index. */
function indexDrift(onDisk, tracked = trackedFiles()) {
    const diskByLower = new Map([...onDisk].map((f) => [f.toLowerCase(), f]));
    const drift = [];
    for (const indexPath of tracked) {
        if (onDisk.has(indexPath)) continue;
        const actual = diskByLower.get(indexPath.toLowerCase());
        if (actual) drift.push({ indexPath, actual });
    }
    return drift;
}

/**
 * Filenames named in the documentation, in backticks: `NickelMenuInstaller.js`.
 *
 * A rename leaves the prose describing a file that no longer exists, and nothing
 * reads the docs, so the mistake survives until a person trips over it. This
 * happened twice in one round of the Phase 6 sweep, the second time *after* the
 * documentation pass, because a late rename landed behind it.
 *
 * Matched by path *suffix*, not by full path: the docs write partial paths like
 * `shell/GlobalUI.js` and bare names like `Session.js`, and both should pass as
 * long as some file ends that way. Pinning them to a full repo path would make
 * every legitimate move a documentation failure, which is not what this checks.
 *
 * Names beginning with a dot are suffix patterns (`.shots.mjs`), not filenames.
 */

/**
 * Names the prose mentions *because* they no longer exist. Keep this short and
 * keep the reason with the name: an entry added to silence a rename defeats the
 * check. Anything here should read as history, not as a description of the code.
 */
const DOC_HISTORICAL = new Map([['blocked-extensions.js', 'PROJECT.md describes it as reverted, never shipped']]);
const DOC_REFERENCE = /`([\w./-]+\.(?:js|mjs|cjs))`/g;

function docReferences(onDisk) {
    const paths = [...onDisk];
    const known = (name) => name.startsWith('.') || DOC_HISTORICAL.has(name) || paths.some((f) => f === name || f.endsWith('/' + name));
    const stale = [];
    for (const doc of DOCS) {
        let source;
        try {
            source = readFileSync(join(REPO, doc), 'utf8');
        } catch {
            continue;
        }
        for (const [, name] of source.matchAll(DOC_REFERENCE)) {
            if (!known(name)) stale.push({ doc, name });
        }
    }
    return stale;
}

function main() {
    const onDisk = filesOnDisk();
    const files = [...onDisk].filter(inScope).sort();
    const { problems, checked } = checkSpecifiers(onDisk, files);
    const drift = indexDrift(onDisk);
    const stale = docReferences(onDisk);

    if (problems.length) {
        console.error(`\n${problems.length} specifier(s) do not resolve to a file on disk:\n`);
        for (const p of problems.sort((a, b) => a.file.localeCompare(b.file))) {
            console.error(`  ${p.file}\n      ${p.kind}  ${p.spec}`);
        }
        console.error('');
    } else {
        console.log(`All ${checked} relative specifiers resolve (${files.length} files scanned).`);
    }

    if (stale.length) {
        console.error(`${stale.length} filename(s) in the documentation do not exist:\n`);
        for (const { doc, name } of stale) console.error(`  ${doc}  names  ${name}`);
        console.error('');
    } else {
        console.log(`Every filename named in ${DOCS.length} documents exists.`);
    }

    if (drift.length) {
        console.error(`${drift.length} file(s) are tracked under a different case than the disk uses.`);
        console.error('Case-only renames that git did not record, because core.ignorecase is true: they');
        console.error('resolve on macOS and fail on a case-sensitive filesystem. Repairing this stages,');
        console.error('so it belongs to the repository owner rather than to a build step:\n');
        for (const { indexPath, actual } of drift.sort((a, b) => a.indexPath.localeCompare(b.indexPath))) {
            console.error(`  git mv --force ${indexPath} ${actual}`);
        }
        console.error('');
    }

    return problems.length || stale.length || drift.length ? 1 : 0;
}

function selftest() {
    // A gate nobody has watched fail is not a gate. Hide one real file from the
    // resolver and assert every specifier pointing at it is reported.
    const victim = 'src/js/shell/Strings.js';
    const onDisk = filesOnDisk();
    if (!onDisk.has(victim)) {
        console.error(`selftest: expected ${victim} on disk`);
        return 1;
    }
    const crippled = new Set(onDisk);
    crippled.delete(victim);
    const files = [...onDisk].filter(inScope);
    const caught = checkSpecifiers(crippled, files).problems.filter((p) => p.target === victim);
    if (!caught.length) {
        console.error(`selftest FAILED: hiding ${victim} produced no findings — the check cannot fail.`);
        return 1;
    }
    console.log(`selftest passed: hiding ${victim} is reported by ${caught.length} specifier(s).`);

    // The drift half has to be proven synthetically. Today it is demonstrated by
    // 20 real findings, but those are about to be repaired, and after that a
    // broken drift check would report nothing and look exactly like success.
    const lowercased = victim.toLowerCase();
    if (lowercased === victim) {
        console.error(`selftest: ${victim} has no case to drift`);
        return 1;
    }
    const pretendIndex = [...onDisk].filter((f) => f !== victim).concat(lowercased);
    const found = indexDrift(onDisk, pretendIndex).filter((d) => d.indexPath === lowercased);
    if (found.length !== 1 || found[0].actual !== victim) {
        console.error(`selftest FAILED: an index holding ${lowercased} while the disk holds ${victim} was not reported as drift.`);
        return 1;
    }

    // And the inverse: an index that agrees with the disk must report nothing,
    // or the check would "pass" by flagging everything.
    if (indexDrift(onDisk, [...onDisk]).length) {
        console.error('selftest FAILED: an index matching the disk exactly was still reported as drift.');
        return 1;
    }
    console.log(`selftest passed: an index holding ${lowercased} against a disk holding ${victim} is reported as drift, and a matching index is not.`);

    // Same argument for the documentation half: it is green now, so from here on
    // only a planted failure can show it still works. Hide a file the docs name.
    const named = 'src/js/shell/Session.js';
    if (docReferences(onDisk).length) {
        console.error('selftest: the documentation check is already failing, so this arm proves nothing');
        return 1;
    }
    const withoutNamed = new Set(onDisk);
    withoutNamed.delete(named);
    if (!docReferences(withoutNamed).some((r) => named.endsWith('/' + r.name) || r.name === named)) {
        console.error(`selftest FAILED: deleting ${named} was not reported, though the documentation names it.`);
        return 1;
    }
    console.log(`selftest passed: deleting ${named} is reported as a stale documentation reference.`);
    return 0;
}

process.exit(process.argv.includes('--selftest') ? selftest() : main());
