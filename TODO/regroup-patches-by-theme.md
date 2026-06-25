# Re-group the patch UI by theme (presentation metadata layer)

> ✅ Implemented. Metadata lives in `src/js/patches/patch-metadata.js`; the patch
> list and incompatible-patches modal group by `PATCH_CATEGORIES`; validation is
> `scripts/check-patch-metadata.mjs` (`npm run check:patch-metadata`, a quick
> phase of `verify`/`test`).

**Goal:** stop grouping the patch list by the binary that gets patched (`Nickel`,
`Adobe RMSDK`, …). Instead present patches by user-facing theme, with clearer
display names and author credit in the notes.

**Decision:** keep all metadata in a separate webui-side layer — do **not** touch
the patch yaml. Reasons:

- The kobopatch format parser rejects unknown instruction keys
  (`patchfile/kobopatch/patch.go:70` → `unknown instruction type`), so a
  `- HumanName:`/`- Category:` in a patch breaks both the WASM patcher and the
  native binary.
- Leaving the yaml untouched keeps it valid for stock kobopatch and easy to
  re-sync from upstream (GeoffR / pgaskin / jackie_w). The yaml stays the source
  of truth; it can keep being updated freely.
- Patch names are unique (100 patches / 100 distinct names in both the 4.45 and
  4.38 sets — no within- or cross-file dupes), so the **patch name is the key**.
  No slugs/UUIDs needed: the cleanup only adds a display `label`, it never
  renames the yaml key, so the name stays a stable identity and manifests +
  `blacklist.json` keep keying by name with no migration.

## Metadata format

New module `src/js/patches/patch-metadata.js`:

```js
// Ordered list of themes. Render order = this order; unmatched patches fall into
// a trailing "Other" section.
export const PATCH_CATEGORIES = [
    { id: 'typography', label: 'Typography & Fonts' },
    { id: 'layout', label: 'Margins & Layout' },
    { id: 'home', label: 'Home & Library' },
    { id: 'header-footer', label: 'Reading Header & Footer' },
    { id: 'dictionary', label: 'Dictionary & Lookup' },
    { id: 'keyboards', label: 'Keyboards' },
    { id: 'input', label: 'Buttons & Gestures' },
    { id: 'power', label: 'Power & Sleep' },
    { id: 'features', label: 'Privacy & Features' },
    { id: 'pdf', label: 'PDF' },
    { id: 'sync', label: 'Cloud Sync' },
];

// Keyed by the exact patch name (the yaml key). `category` is required; `label`
// and `author` are optional. `label` overrides the displayed name only — the key
// is still the yaml name. `author` is shown in the notes; only set it when the
// yaml actually credits someone.
export const PATCH_META = {
    'test Pop-up footnote main text font-size': { category: 'typography', label: 'Pop-up footnote text size' },
    'Cyrillic Keyboard (GloHD/ClaraHD/AuraOne/H2O2)': { category: 'keyboards', label: 'Cyrillic keyboard' },
    'Remove footer (row3) on new home screen': { category: 'home', label: 'Hide home-screen footer row' },
    'jackie_w Screensaver full': { category: 'features', label: 'Full-screen screensaver', author: 'jackie_w' },
    'Remove PDF map widget shown during panning': { category: 'pdf', author: 'pgaskin (geek1011)' },
    'Unlock Dropbox and Google Drive support': { category: 'sync' },
    // …one entry per patch (see validation below)…
};

// Fallback so a not-yet-categorized patch still renders.
export function getPatchMeta(name) {
    return PATCH_META[name] ?? { category: 'other' };
}
```

Author sources (only credit where the yaml names someone — don't invent):
`libnickel.so.1.0.0.yaml` (GeoffR, jackie_w, NiLuJe, jcn363, pgaskin),
`nickel.yaml` (jackie_w, oren64, pgaskin), `libadobe.so.yaml` (pgaskin).

## Tasks

- [x] Create `patch-metadata.js` with `PATCH_CATEGORIES`, `PATCH_META`
      (one entry per patch), and `getPatchMeta()`.
- [x] Rewrite grouping in `patch-list-view.js`:
  - [x] Flatten patches across all files, bucket by `category` in
        `PATCH_CATEGORIES` order; unknown → trailing "Other" section. Render one
        `<details>` per non-empty category instead of one per file.
  - [x] Update the incompatible-patches modal (`#patch-blacklist-dialog`) to use
        the same visual section labels/order, since it currently mirrors the
        patch-list grouping with only user-facing section names.
  - [x] Display name = `meta.label || patch.name`; search matches the displayed
        label.
  - [x] Surface `author` in the notes (append to the shown `Description`, or show
        it even when there's no description).
  - [x] Keep `patchGroup` mutual-exclusion: radio `name` stays
        `pg_${filename}_${group}` regardless of visual grouping.
  - [x] Update `updatePatchCounts` + `filterPatches` to key off category instead
        of `dataset.filename` (they assume one section per file today).
- [x] Remove `PATCH_FILE_LABELS` from `patch-yaml.js` (unused once per-file
      grouping is gone).
- [x] Add the validation script + verify phase (below).

## Validation (required)

The yaml is the source of truth and keeps changing, so the metadata can drift.
Without a check, a newly added patch silently lands in "Other" with no
label/category.

- [x] Add `scripts/check-patch-metadata.mjs`, exposed as `check:patch-metadata`
      in `package.json` (mirror `validate:dist` / `test:patches:check`).
- [x] It parses every `patches/*/src/*.yaml` with `parsePatchYAML`, loads
      `PATCH_META`, and **fails (exit non-zero, listing `file → name`)** for any
      patch with no entry (or an entry missing `category`).
- [x] It also flags **orphan** entries (a `PATCH_META` name not present in any
      yaml) so the map doesn't rot — decide warn vs fail.
- [x] Wire it into `scripts/verify.mjs` as a new `quick: true` phase (runs in both
      `npm run verify` and `npm run test`), near the other static checks (after
      Unit tests, around Build).

## Out of scope / unaffected

- The file→target map (`patches/index.json`), patch identity, the patcher, the
  generated config, blacklist lookup, and saved manifests all stay as-is —
  categories/labels live only in the UI.
