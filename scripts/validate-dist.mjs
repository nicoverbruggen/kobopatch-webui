import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const appDir = join(import.meta.dirname, '..');
const dist = join(appDir, 'dist');

const required = [
    'index.html',
    'bundle.js',
    // The running app fetches this to tell "the deployment moved on" apart from
    // "that download was corrupt"; without it every mismatch reads as corrupt.
    'version.json',
    'css/style.css',
    'js/workers/patch-worker.js',
    'js/workers/wasm_exec.js',
    'wasm/kobopatch.wasm',
    'patches/index.json',
    'patches/blacklist.json',
    'patches/downloads.json',
    'assets/NickelMenu.tgz',
    'assets/koreader-kobo.zip',
    'assets/simpleui.koplugin.zip',
    'assets/kobo-core-fonts.zip',
    'assets/kobo-extra-fonts.zip',
    'assets/font-previews.json',
    // Vite-tracked NickelMenu feature assets (the items file is generated from
    // feature menuItems hooks, so it is no longer shipped as a static asset).
    'assets/.cog.png',
    'assets/moon.png',
    'assets/toggle_hidden_home.sh',
    'assets/toggle_tabs.sh',
    'assets/toggle_typography.sh',
    'assets/toggle_nickelclock.sh',
];

let missing = 0;

function requireFile(relativePath) {
    if (!existsSync(join(dist, relativePath))) {
        console.error(`FAIL: missing ${relativePath}`);
        missing += 1;
    }
}

const patchIndexPath = join(dist, 'patches/index.json');
if (existsSync(patchIndexPath)) {
    const patchIndex = JSON.parse(readFileSync(patchIndexPath, 'utf-8'));
    for (const { filename } of patchIndex) {
        if (!existsSync(join(dist, 'patches', filename))) {
            console.error(`FAIL: missing patches/${filename} (listed in index.json)`);
            missing += 1;
        }
    }
} else {
    console.error('FAIL: missing patches/index.json');
    missing += 1;
}

for (const file of required) requireFile(file);

if (missing > 0) {
    console.error(`${missing} required file(s) missing from dist/`);
    process.exit(1);
}

console.log('All required dist resources present.');
