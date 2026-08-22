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

const repo = resolve(import.meta.dirname, '..');
const roots = ['src/js', 'tests', 'scripts', 'tools'];
const extraFiles = ['vite.config.mjs'];
const skipDirs = new Set(['node_modules', 'cached_assets', 'screenshots', '.git']);

/**
 * The vendored Go toolchain ships its own JavaScript which we never edit and
 * cannot fix. Our own tooling under `tools/` stays in scope.
 */
const skipPaths = ['tools/kobopatch-wasm/go/'];

/** Documents whose filename references must all resolve. See `docReferences`. */
const docs = ['AGENTS.md', 'PROJECT.md', 'CONVENTIONS.md', 'README.md'];

/**
 * Specifier forms. `require()` matters because the E2E suite is CommonJS; the
 * template form matters because some call sites append a cache-busting query.
 */
const forms = [
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
 * Paths assembled from literal segments, such as
 * `path.join(__dirname, '..', 'src', …)`.
 */
const joinedPath = /\bpath\.join\(\s*__dirname\s*,\s*([^)]*?)\)/g;

function joinedTargets(source, file) {
    const out = [];
    for (const match of source.matchAll(joinedPath)) {
        const parts = [...match[1].matchAll(/'([^']*)'/g)].map((part) => part[1]);
        if (!parts.length || !/\.[a-z]+$/.test(parts.at(-1))) continue;
        out.push({
            spec: parts.join('/'),
            target: relative(repo, resolve(dirname(join(repo, file)), ...parts)),
            kind: 'path.join()',
        });
    }
    return out;
}

/** Repo-relative paths of everything on disk, using filesystem casing. */
function filesOnDisk(dir = repo, out = new Set()) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skipDirs.has(entry.name)) continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) filesOnDisk(absolute, out);
        else out.add(relative(repo, absolute));
    }
    return out;
}

// Excluded from its own scan because its documentation quotes the forms it checks.
const self = 'scripts/check-imports.mjs';
const inScope = (file) =>
    file !== self &&
    /\.(js|mjs|cjs)$/.test(file) &&
    !skipPaths.some((prefix) => file.startsWith(prefix)) &&
    (roots.some((root) => file.startsWith(root + '/')) || extraFiles.includes(file));

/** Resolve extensions and CommonJS directory indexes the way the loaders do. */
function resolves(onDisk, target) {
    if (onDisk.has(target)) return true;
    for (const extension of ['.js', '.mjs', '.cjs', '.json']) {
        if (onDisk.has(target + extension)) return true;
    }
    for (const extension of ['.js', '.mjs', '.cjs']) {
        if (onDisk.has(join(target, 'index' + extension))) return true;
    }
    return false;
}

/** Whether an offset sits inside a `//` comment or a block-comment line. */
function inComment(source, index) {
    const lineStart = source.lastIndexOf('\n', index) + 1;
    const before = source.slice(lineStart, index);
    return before.includes('//') || /^\s*\*/.test(before);
}

/** A template specifier is usable up to its first interpolation. */
const staticPrefix = (specifier) => (specifier.includes('${') ? specifier.slice(0, specifier.indexOf('${')) : specifier);

function checkSpecifiers(onDisk, files) {
    const problems = [];
    let checked = 0;

    for (const file of files) {
        const source = readFileSync(join(repo, file), 'utf8');
        for (const { re, kind } of forms) {
            for (const match of source.matchAll(re)) {
                const spec = staticPrefix(match[1]).split('?')[0];
                if (!spec) continue;
                // A require() in a comment is prose. A JSDoc import() is a type
                // path and remains in scope, which is much of this check's value.
                if (kind === 'require()' && inComment(source, match.index)) continue;

                let target;
                if (kind === 'paths.src()') target = join('src', spec);
                else if (spec.startsWith('.')) target = relative(repo, resolve(dirname(join(repo, file)), spec));
                else continue;

                checked++;
                if (!resolves(onDisk, target)) problems.push({ file, spec, kind, target });
            }
        }
        for (const joined of joinedTargets(source, file)) {
            checked++;
            if (!resolves(onDisk, joined.target)) problems.push({ file, ...joined });
        }
    }
    return { problems, checked };
}

/** Files git tracks under a different spelling than the disk uses. */
const trackedFiles = () => execFileSync('git', ['-C', repo, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);

/** `tracked` is injectable so the self-test can use a synthetic index. */
function indexDrift(onDisk, tracked = trackedFiles()) {
    const diskByLower = new Map([...onDisk].map((file) => [file.toLowerCase(), file]));
    const drift = [];
    for (const indexPath of tracked) {
        if (onDisk.has(indexPath)) continue;
        const actual = diskByLower.get(indexPath.toLowerCase());
        if (actual) drift.push({ indexPath, actual });
    }
    return drift;
}

/**
 * Names the prose mentions because they no longer exist. Entries must describe
 * repository history rather than silence a stale reference.
 */
const docHistorical = new Map([['blocked-extensions.js', 'PROJECT.md describes it as reverted, never shipped']]);
const docReference = /`([\w./-]+\.(?:js|mjs|cjs))`/g;

/** Check filenames mentioned in documentation by exact path or path suffix. */
function docReferences(onDisk) {
    const paths = [...onDisk];
    const known = (name) => name.startsWith('.') || docHistorical.has(name) || paths.some((file) => file === name || file.endsWith('/' + name));
    const stale = [];
    for (const doc of docs) {
        let source;
        try {
            source = readFileSync(join(repo, doc), 'utf8');
        } catch {
            continue;
        }
        for (const [, name] of source.matchAll(docReference)) {
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
        for (const problem of problems.sort((a, b) => a.file.localeCompare(b.file))) {
            console.error(`  ${problem.file}\n      ${problem.kind}  ${problem.spec}`);
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
        console.log(`Every filename named in ${docs.length} documents exists.`);
    }

    if (drift.length) {
        console.error(`${drift.length} file(s) are tracked under a different case than the disk uses.`);
        console.error('Case-only renames that git did not record resolve on macOS and fail on Linux.');
        console.error('Repairing this stages changes, so it belongs to the repository owner:\n');
        for (const { indexPath, actual } of drift.sort((a, b) => a.indexPath.localeCompare(b.indexPath))) {
            console.error(`  git mv --force ${indexPath} ${actual}`);
        }
        console.error('');
    }

    return problems.length || stale.length || drift.length ? 1 : 0;
}

function selftest() {
    // Hide one real file and prove every import pointing at it is reported.
    const victim = 'src/js/shell/strings.js';
    const onDisk = filesOnDisk();
    if (!onDisk.has(victim)) {
        console.error(`selftest: expected ${victim} on disk`);
        return 1;
    }
    const crippled = new Set(onDisk);
    crippled.delete(victim);
    const files = [...onDisk].filter(inScope);
    const caught = checkSpecifiers(crippled, files).problems.filter((problem) => problem.target === victim);
    if (!caught.length) {
        console.error(`selftest FAILED: hiding ${victim} produced no findings.`);
        return 1;
    }
    console.log(`selftest passed: hiding ${victim} is reported by ${caught.length} specifier(s).`);

    // Prove index casing drift is detected without altering the real index.
    const misCased = 'src/js/shell/Strings.js';
    const pretendIndex = [...onDisk].filter((file) => file !== victim).concat(misCased);
    const found = indexDrift(onDisk, pretendIndex).filter((entry) => entry.indexPath === misCased);
    if (found.length !== 1 || found[0].actual !== victim) {
        console.error(`selftest FAILED: ${misCased} was not reported as casing drift.`);
        return 1;
    }
    if (indexDrift(onDisk, [...onDisk]).length) {
        console.error('selftest FAILED: an index matching the disk was reported as drift.');
        return 1;
    }
    console.log(`selftest passed: ${misCased} is reported as casing drift, and matching casing is not.`);

    // Hide a file named in the docs and prove that check can fail too.
    const named = 'src/js/shell/session.js';
    if (docReferences(onDisk).length) {
        console.error('selftest: the documentation check is already failing, so this arm proves nothing');
        return 1;
    }
    const withoutNamed = new Set(onDisk);
    withoutNamed.delete(named);
    if (!docReferences(withoutNamed).some((reference) => named.endsWith('/' + reference.name) || reference.name === named)) {
        console.error(`selftest FAILED: deleting ${named} was not reported as a stale documentation reference.`);
        return 1;
    }
    console.log(`selftest passed: deleting ${named} is reported as a stale documentation reference.`);
    return 0;
}

process.exit(process.argv.includes('--selftest') ? selftest() : main());
