# TODO

For the latest, see GitHub. This file is a WIP file for TODOs that are currently worked on.

## Re-group the patch UI by theme (presentation metadata layer)

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

### Metadata format

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

### Tasks

- [ ] Create `patch-metadata.js` with `PATCH_CATEGORIES`, `PATCH_META`
      (one entry per patch), and `getPatchMeta()`.
- [ ] Rewrite grouping in `patch-list-view.js`:
  - [ ] Flatten patches across all files, bucket by `category` in
        `PATCH_CATEGORIES` order; unknown → trailing "Other" section. Render one
        `<details>` per non-empty category instead of one per file.
  - [ ] Display name = `meta.label || patch.name`; search matches the displayed
        label.
  - [ ] Surface `author` in the notes (append to the shown `Description`, or show
        it even when there's no description).
  - [ ] Keep `patchGroup` mutual-exclusion: radio `name` stays
        `pg_${filename}_${group}` regardless of visual grouping.
  - [ ] Update `updatePatchCounts` + `filterPatches` to key off category instead
        of `dataset.filename` (they assume one section per file today).
- [ ] Remove `PATCH_FILE_LABELS` from `patch-yaml.js` (unused once per-file
      grouping is gone).
- [ ] Add the validation script + verify phase (below).

### Validation (required)

The yaml is the source of truth and keeps changing, so the metadata can drift.
Without a check, a newly added patch silently lands in "Other" with no
label/category.

- [ ] Add `scripts/check-patch-metadata.mjs`, exposed as `check:patch-metadata`
      in `package.json` (mirror `validate:dist` / `test:patches:check`).
- [ ] It parses every `patches/*/src/*.yaml` with `parsePatchYAML`, loads
      `PATCH_META`, and **fails (exit non-zero, listing `file → name`)** for any
      patch with no entry (or an entry missing `category`).
- [ ] It also flags **orphan** entries (a `PATCH_META` name not present in any
      yaml) so the map doesn't rot — decide warn vs fail.
- [ ] Wire it into `scripts/verify.mjs` as a new `quick: true` phase (runs in both
      `npm run verify` and `npm run test`), near the other static checks (after
      Unit tests, around Build).

### Out of scope / unaffected

- The file→target map (`patches/index.json`), patch identity, the patcher, the
  generated config, blacklist lookup, and saved manifests all stay as-is —
  categories/labels live only in the UI.

## Own the patch prose in metadata (descriptions, notes, customization tips)

**Goal:** move all human-facing prose into the metadata layer too — a polished
description, an optional note, and customization tips/instructions. This makes
the `#` comments in the yaml files no longer relevant to the UI: today the
tuning instructions (e.g. "Part 2: change the font-size value here", multi-step
margin notes) live only as yaml comments that the webui never surfaces. Depends
on the metadata layer above.

Extends `PATCH_META` (same name key) with optional prose fields:

```js
'Custom synopsis font size': {
    category: 'home',
    label: 'Book-details synopsis font size',
    // Replaces the displayed blurb. Falls back to the yaml `Description:` when absent.
    description: 'Sets the font size of the synopsis text on the book details page.',
    // Short extra context (compatibility caveat, "no visible effect on X", etc.).
    note: 'Has no effect on sideloaded books without a synopsis.',
    // Instructions shown when customizing patch values in the editor. Markdown
    // or an array of steps — pick one and apply consistently.
    tips: [
        'Edit the `ReplaceString` value to your preferred size in px.',
        'Default is 30px; values below ~18px get cramped.',
    ],
},
```

Display rules: shown description = `meta.description ?? patch.description`
(the parsed yaml `Description:`); `note` renders under it; `tips` surface in the
**patch editor** (`patch-editor.js`, `openPatchEditor`) where a user actually
changes values — that's where the old yaml comments were useful.

### Tasks

- [ ] Add `description` / `note` / `tips` to `PATCH_META` (incrementally — only
      where there's something worth saying; the validation script must NOT
      require them, unlike `category`).
- [ ] Update `patch-list-view.js` to prefer `meta.description` over the parsed
      `patch.description`, and render `note`.
- [ ] Update `patch-editor.js` to show `tips` alongside the value fields.
- [ ] Migrate the worthwhile yaml-comment instructions into `tips` (one pass per
      file). Leave the comments in the yaml for upstream/maintainer reference —
      the point is only that the UI no longer needs them.

### Notes

- `description`/`note`/`tips` are all optional; `category` stays the only
  required field, so the existing validation gate is unchanged.
- Keep the yaml `Description:` field intact (it's a real kobopatch field and
  upstream content); metadata only overrides it for display.
