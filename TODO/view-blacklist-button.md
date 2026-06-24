# "View blacklist" button (currently blacklisted patches + last update)

**Goal:** a button that quickly shows which patches are currently blacklisted
(incompatible) and when the blacklist was last updated.

**Placement (decided):** on the **patches step header**, next to the patch list
search/header. The blacklist is per-firmware and the step already knows the
loaded firmware version, so the button can scope its list to exactly the
firmware the user is patching.

## Where this lives today

- `patches/blacklist.json` is the source of truth, keyed by short version →
  filename → `[patch names]` (e.g. `"4.45"` → `"src/libnickel.so.1.0.0.yaml"`
  → `[...]`). Loaded via `fetchPatchBlacklist` (`patches/catalog.js`) into
  `PatchUI.blacklist`; per-patch lookup is `PatchUI.isBlacklisted(filename,
  name)` (`patches/ui.js:50`), which scopes to the current `firmwareVersion`.
- The file is **generated**, not hand-maintained: `tools/kobopatch-wasm/test-patches.sh`
  runs the native kobopatch binary against each firmware and records the
  patches that fail. The build bakes it into the bundle
  (`scripts/build.mjs:61`).

## Open decision — "last update" needs a data source

`blacklist.json` has **no timestamp today**. Options (pick during implementation):

- Bake a build-time value into the bundle (mirror how `instructions.js` bakes the
  app version + timestamp). Cheapest source = the git commit date of
  `patches/blacklist.json`, or its mtime at build time. Preferred — no manual
  upkeep.
- Add an explicit `"_updated": "<ISO date>"` (or `_meta`) field that
  `test-patches.sh` writes when it regenerates the file. More explicit but the
  generator + the `--check` path + `validate-dist`/blacklist-check tooling all
  have to agree on it.

## Tasks

- [ ] Decide the "last update" source (see above) and expose it to the UI
      (build-baked global like the installables manifest, or a field read from
      `blacklist.json`).
- [ ] Add a "View blacklist" button to the patches step header markup
      (`src/html/steps/step-patches.html`), near the search/header.
- [ ] Add a `#patch-blacklist-dialog` modal (reuse the `hint-dialog` pattern in
      `src/index.html` + `shell/global-ui.js`): show the patches blacklisted for
      the **current firmware version** (grouped by file or flat with display
      names), the firmware version it applies to, and the "last updated" line.
- [ ] Populate the dialog from `PatchUI.blacklist` scoped to `firmwareVersion`
      (a small `PatchUI` accessor returning the current-version blacklist names
      keeps the flow thin). Handle the empty case ("No known incompatible
      patches for this version.").
- [ ] Add the copy to `TL.PATCH` in `shell/strings.js` (button label, dialog
      title, last-updated line, empty-state text).

## Tests

- [ ] Unit-test the new `PatchUI` blacklist accessor (correct names for a given
      firmware version; empty for an unknown version).
- [ ] E2E (Playwright): the button opens the dialog, lists the expected
      blacklisted patches for the loaded firmware, and shows the last-updated
      line.

## Out of scope

- How the blacklist is generated (`test-patches.sh`) and what it contains —
  unchanged except for possibly adding the timestamp field if that option wins.
