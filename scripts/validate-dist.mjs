import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const appDir = join(import.meta.dirname, '..');
const dist = join(appDir, 'dist');

const required = [
    'index.html',
    'bundle.js',
    'css/style.css',
    'js/workers/patch-worker.js',
    'js/workers/wasm_exec.js',
    'wasm/kobopatch.wasm',
    'patches/index.json',
    'patches/blacklist.json',
    'patches/downloads.json',
    'assets/NickelMenu.zip',
    'assets/koreader-kobo.zip',
    'assets/KF_Readerly.zip',
    // Runtime-fetched NickelMenu feature assets (the items file is generated from
    // feature menuItems hooks, so it is no longer shipped as a static asset).
    'js/nickelmenu/features/custom-menu/.cog.png',
    'js/nickelmenu/features/hide-home-content/scripts/toggle_hidden_home.sh',
    'js/nickelmenu/features/simplify-tabs/scripts/toggle_tabs.sh',
    'js/nickelmenu/features/nickelclock/scripts/toggle_nickelclock.sh',
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
