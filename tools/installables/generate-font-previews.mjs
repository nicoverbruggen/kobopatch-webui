#!/usr/bin/env node
/**
 * generate-font-previews.mjs — pre-render a type specimen for every font family.
 *
 * The "Select fonts" dialog shows a small square "Aa" tile next to each family,
 * but the fonts only exist inside the (gitignored, lazily-downloaded) collection
 * archives and the CSP forbids external resources. So this script renders a
 * fixed sample string through each family's Regular weight (fontkit →
 * SVG path data) and writes the result as a served asset
 * (assets/font-previews.json) next to the archives, per target. The dialog
 * fetches it lazily and renders inline SVGs; when the file is missing the
 * dialog simply shows no previews.
 *
 * Runs as the tail of tools/installables/installables.mjs (setup and update),
 * so every pipeline that fetches the archives also derives the previews. A
 * target whose existing previews match the locked version is skipped.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import * as fontkit from 'fontkit';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK_PATH = join(APP_DIR, 'installables.lock');
const PREVIEWS_FILE = 'font-previews.json';

// One cap and one lowercase letter: enough to read the family's contrast,
// terminals and x-height at a glance, and it fits a square tile at a size where
// the outlines stay legible.
const SAMPLE_TEXT = 'Aa';
const FONT_SIZE = 48;

// Square tile geometry, in em, shared by every family: same scale, same
// baseline, so a tall or wide family actually looks tall or wide instead of
// being normalised away. Sized from the extremes across the collection (ink up
// to 1.47em wide, caps up to 0.85em tall) so no family has to shrink to fit,
// with the band placed to optically centre a typical 0.7em cap height.
const TILE_SIZE = 1.62;
const TILE_TOP = -1.16;

async function loadCatalogue() {
    return import(join(APP_DIR, 'src', 'js', 'nickelmenu', 'features', 'additional-fonts', 'catalogue.js'));
}

async function lockedVersion() {
    const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'));
    const versions = ['ebook-fonts-core', 'ebook-fonts-extra'].map((id) => lock.installables[id]?.version ?? 'unknown');
    return [...new Set(versions)].join(' / ');
}

// One decimal is plenty at the ~1rem size the dialog renders previews at.
function fmt(value) {
    const rounded = Math.round(value * 10) / 10;
    return Object.is(rounded, -0) ? '0' : String(rounded);
}

function renderPreview(fontBuffer) {
    const font = fontkit.create(fontBuffer);
    const run = font.layout(SAMPLE_TEXT);
    const scale = FONT_SIZE / font.unitsPerEm;

    // Glyph outlines are in font units with y pointing up; flip y and scale to
    // FONT_SIZE while advancing the pen, producing one combined SVG path.
    const parts = [];
    let penX = 0;
    let inkLeft = Infinity;
    let inkRight = -Infinity;
    for (let i = 0; i < run.glyphs.length; i++) {
        const position = run.positions[i];
        const dx = (penX + position.xOffset) * scale;
        const dy = -position.yOffset * scale;
        const bbox = run.glyphs[i].bbox;
        inkLeft = Math.min(inkLeft, bbox.minX * scale + dx);
        inkRight = Math.max(inkRight, bbox.maxX * scale + dx);
        for (const { command, args } of run.glyphs[i].path.commands) {
            if (command === 'closePath') {
                parts.push('Z');
                continue;
            }
            const points = [];
            for (let a = 0; a < args.length; a += 2) {
                points.push(fmt(args[a] * scale + dx), fmt(-(args[a + 1] * scale) + dy));
            }
            const op = { moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', bezierCurveTo: 'C' }[command];
            if (!op) throw new Error(`unsupported path command ${command}`);
            parts.push(op + points.join(' '));
        }
        penX += position.xAdvance;
    }

    // A fixed em band (rather than each font's own ascent/descent) keeps every
    // family at the same optical size, which is the point of comparing them.
    // Only the horizontal position is per-family: the tile is centred on the
    // ink rather than the advance, so uneven side bearings don't push the
    // sample off-centre.
    const size = TILE_SIZE * FONT_SIZE;
    const centre = Number.isFinite(inkLeft) ? (inkLeft + inkRight) / 2 : (penX * scale) / 2;
    return {
        d: parts.join(''),
        viewBox: `${fmt(centre - size / 2)} ${fmt(TILE_TOP * FONT_SIZE)} ${fmt(size)} ${fmt(size)}`,
    };
}

/**
 * Generate font-previews.json into each target assets directory. Reads the
 * collection archives already present in that directory, so it must run after
 * the archives are set up. Cosmetic data: a family whose font fails to parse
 * is skipped with a warning rather than failing the pipeline.
 */
export async function generateFontPreviews(targetDirs) {
    const { FONT_COLLECTIONS, FONT_FAMILIES } = await loadCatalogue();
    const version = await lockedVersion();

    for (const dir of targetDirs) {
        const outPath = join(dir, PREVIEWS_FILE);
        if (existsSync(outPath)) {
            try {
                const existing = JSON.parse(await readFile(outPath, 'utf8'));
                // The sample is part of the check so changing how previews are
                // drawn regenerates them even when the font pack didn't move.
                if (existing.version === version && existing.sample === SAMPLE_TEXT && FONT_FAMILIES.every((family) => existing.families?.[family.id])) {
                    console.log(`[${dir}] ${PREVIEWS_FILE} up to date (${version}), skipping.`);
                    continue;
                }
            } catch {
                // Unreadable/corrupt: regenerate below.
            }
        }

        const families = {};
        for (const collection of FONT_COLLECTIONS) {
            const zipPath = join(dir, collection.asset);
            if (!existsSync(zipPath)) {
                console.warn(`[${dir}] ${collection.asset} missing, skipping font previews for this target.`);
                families.__incomplete = true;
                break;
            }
            const zip = await JSZip.loadAsync(await readFile(zipPath));
            for (const family of FONT_FAMILIES.filter((f) => f.collection === collection.id)) {
                const regular = zip.file(family.files[0]);
                if (!regular) {
                    console.warn(`[${dir}] ${family.files[0]} not in ${collection.asset}, no preview for ${family.name}.`);
                    continue;
                }
                try {
                    families[family.id] = renderPreview(await regular.async('nodebuffer'));
                } catch (err) {
                    console.warn(`[${dir}] could not render a preview for ${family.name}: ${err.message}`);
                }
            }
        }
        if (families.__incomplete) continue;

        await writeFile(outPath, JSON.stringify({ version, sample: SAMPLE_TEXT, families }) + '\n');
        console.log(`[${dir}] wrote ${PREVIEWS_FILE} (${Object.keys(families).length} families, ${version})`);
    }
}

// CLI entry point (installables.mjs calls generateFontPreviews() directly).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const targets = [];
    if (process.argv.includes('--src')) targets.push(join(APP_DIR, 'src', 'assets'));
    if (process.argv.includes('--dist')) targets.push(join(APP_DIR, 'dist', 'assets'));
    if (targets.length === 0) {
        console.error('Usage: generate-font-previews.mjs (--src|--dist)...');
        process.exit(2);
    }
    await generateFontPreviews(targets);
}
