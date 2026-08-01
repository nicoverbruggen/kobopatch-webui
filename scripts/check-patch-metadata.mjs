/**
 * check-patch-metadata.mjs — Keep the presentation metadata in sync with the YAML.
 *
 * The kobopatch YAML is the source of truth and keeps changing, so the webui's
 * `PATCH_META` layer can silently drift: a newly added patch would land in the
 * trailing "Other" section with no label/category. This check fails the build
 * if any patch in the patch-source YAML has no metadata entry (or an entry
 * without a `category`), and warns about orphan entries (a `PATCH_META` name not
 * present in any YAML) so the map doesn't rot.
 *
 * Wired into `scripts/verify.mjs` as a quick phase (runs in both `npm run
 * verify` and `npm run test`).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parsePatchYAML } from '../src/js/patches/PatchYAML.js';
import { PATCH_META, PATCH_CATEGORIES, OTHER_CATEGORY } from '../src/js/patches/PatchMetadata.js';

const appDir = join(import.meta.dirname, '..');
const patchesDir = join(appDir, 'patches');

const validCategories = new Set([...PATCH_CATEGORIES.map((c) => c.id), OTHER_CATEGORY.id]);

function patchYamlFiles() {
    const files = [];
    for (const versionDir of readdirSync(patchesDir, { withFileTypes: true })) {
        if (!versionDir.isDirectory()) continue;
        const srcDir = join(patchesDir, versionDir.name, 'src');
        let entries;
        try {
            entries = readdirSync(srcDir);
        } catch {
            continue; // not every patch folder has a src/ dir
        }
        for (const name of entries) {
            if (name.endsWith('.yaml')) files.push(join(srcDir, name));
        }
    }
    return files;
}

const errors = [];
const seenNames = new Set();

for (const file of patchYamlFiles()) {
    const rel = file.slice(appDir.length + 1);
    const patches = parsePatchYAML(readFileSync(file, 'utf8'));
    for (const patch of patches) {
        seenNames.add(patch.name);
        const meta = PATCH_META[patch.name];
        if (!meta) {
            errors.push(`${rel} → "${patch.name}": no PATCH_META entry`);
        } else if (!meta.category) {
            errors.push(`${rel} → "${patch.name}": entry is missing "category"`);
        } else if (!validCategories.has(meta.category)) {
            errors.push(`${rel} → "${patch.name}": unknown category "${meta.category}"`);
        }
    }
}

const orphans = Object.keys(PATCH_META).filter((name) => !seenNames.has(name));

if (orphans.length > 0) {
    console.warn(`⚠ ${orphans.length} PATCH_META entr${orphans.length === 1 ? 'y is' : 'ies are'} not present in any patch YAML:`);
    for (const name of orphans) console.warn(`  - "${name}"`);
}

if (errors.length > 0) {
    console.error(`\n✗ Patch metadata check failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const err of errors) console.error(`  - ${err}`);
    console.error('\nAdd an entry with a "category" to src/js/patches/PatchMetadata.js for each patch above.');
    process.exit(1);
}

console.log(`✓ Patch metadata: every patch has a category (${seenNames.size} patches checked).`);
