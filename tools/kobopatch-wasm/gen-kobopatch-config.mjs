// ============================================================================
// TEST-ONLY TOOLING — not part of the build or deploy.
//
// Only the kobopatch test harnesses use this (test-patches.sh, which lives
// beside this file, and test-integration.sh). It is intentionally NOT wired
// into scripts/build.mjs or the nixpacks deploy build.
//
// Why it exists: the real kobopatch (native binary + WASM) needs a config file
// with the file→target map. In production the browser never writes one — it
// synthesizes the config in-memory at runtime via PatchUI.generateConfig()
// (src/js/patches/PatchUI.js). The test harnesses drive the real kobopatch directly,
// so they regenerate the equivalent config on demand from patches/index.json
// (the single source of truth, since the source dirs no longer ship a
// kobopatch.yaml).
// ============================================================================
//
// Usage:
//   node gen-kobopatch-config.mjs --source 4.45 --version 4.45.23697 --in /path/firmware.zip
//   node gen-kobopatch-config.mjs --filename patches_4.45.zip --version 4.45.23697
//
// Writes the config to stdout.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// This file lives in tools/kobopatch-wasm/, so the repo root is two levels up.
const appDir = join(import.meta.dirname, '..', '..');

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const source = arg('source');
const filename = arg('filename') || (source ? `patches_${source}.zip` : undefined);
const version = arg('version');
const inPath = arg('in') || 'firmware.zip';

if (!filename) {
    console.error('error: provide --source <dir> or --filename <patches_*.zip>');
    process.exit(1);
}
if (!version) {
    console.error('error: provide --version <firmware version>');
    process.exit(1);
}

const index = JSON.parse(readFileSync(join(appDir, 'patches', 'index.json'), 'utf-8'));
const entry = index.find((e) => e.filename === filename);
if (!entry) {
    console.error(`error: no index.json entry for ${filename}`);
    process.exit(1);
}
if (!entry.patches || Object.keys(entry.patches).length === 0) {
    console.error(`error: index.json entry ${filename} has no patches map`);
    process.exit(1);
}

let out = '';
out += `version: ${version}\n`;
out += `in: ${inPath}\n`;
out += `out: out/KoboRoot.tgz\n`;
out += `log: out/log.txt\n`;
out += `patchFormat: kobopatch\n`;
out += `\npatches:\n`;
for (const [file, target] of Object.entries(entry.patches)) {
    out += `  ${file}: ${target}\n`;
}

process.stdout.write(out);
