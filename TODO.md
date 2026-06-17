# TODO

## Front-end organization rework

The flow orchestration rework (step machine, session, terminal, probes/dialog
split, flow-declared error recovery) and the Stage 2/3 structural improvements
(element bundles, step registry, HTML partials, component helpers) are done.
This tracks any remaining work.

---

## Part A — Broad explanation (read this and critique)

### The core problem

We have two flows that look architecturally different for no good reason:

- The **patches flow** keeps its selection state in a model (`PatchUI`,
  `patches/ui.js`). That is exactly why patch logic is unit-testable today —
  you can construct a `PatchUI`, toggle patches, and assert on `generateConfig()`
  / `getOverrides()` without a browser.
- The **NickelMenu flow** keeps most of its selection state in the **DOM**. Some
  of it has already been lifted into the session (`selectedFeatureIds` — and
  `getSelectedFeatures()` already reads from the session, good), but three
  selections are still read straight off checkboxes at *advance/install* time:
  - **optional cleanup** to remove on uninstall (`nm-uninstall-<id>` checkboxes,
    read by `getSelectedOptionalCleanupFeatures` / `getKeptOptionalCleanupFeatures`),
  - **keep-legacy-config** (`$('nm-keep-items').checked`, read inside the install
    handler), and
  - the **backup choice** (a module-level `let nmBackupChoice`, modelled but
    living outside the session) and the **nm-option** radio (committed to the
    session only when "Next" is clicked).

Because those live in the DOM, the interesting NM decisions — "given these
selections, which features get installed / which cleanups get reverted / what
does the review screen list" — can only be exercised through Playwright. There
is no seam to unit-test them.

### What we're optimizing for

**Testability and clarity, by making the NM flow's *decisions* pure functions of
the session, the way the patches flow already is.** Concretely: the session
becomes the single source of truth for every NM selection, the checkboxes become
a *view* that writes into the session on change, and the "what does this produce"
logic is extracted into small pure selectors that take the session and return
data (feature lists, a review model) with no DOM access. The DOM render code then
consumes those selectors instead of being the source of truth.

This is the load-bearing change (**Stage 1**). It finishes the thread the
`Session` work started and is the prerequisite for being able to test the most
complex flow without a browser.

### Supporting moves

- **Stage 2 — HTML partials + a small component layer.** `index.html` is one
  797-line file with ~56 `selection-card`s, ~15 step-action footers, and ~12
  banners hand-copied throughout. There is already a build-time HTML step, so we
  can (a) split the 19 step sections into `src/html/steps/*.html` via a trivial
  build-time include, and (b) add render helpers for the truly repetitive
  primitives (`selection-card`, `banner`, `step-actions`) following the existing
  `renderNmCheckboxList` / `setupCardRadios` idiom. Pure maintainability + the
  helpers are independently testable. Lower risk than Stage 1; fully separable.
- **Stage 3 — element bundles + step registry.** Tame the ~148 ad-hoc `$('id')`
  lookups by gathering each flow's ids once (typo fails loudly at init), and let
  the step machine derive its `allSteps` list from the flows' declared `domId`s
  instead of maintaining a second hardcoded array. Small consistency wins.

### Explicit non-goals

- **No UI framework** (Lit/Preact/etc.). It would fight the zero-dep,
  reproducible-static-build ethos, and the step machine already provides the
  routing/lifecycle a framework would. 
- **Do not touch `PatchUI`'s selection model** — it is already the good pattern;
  Stage 1 makes NM match it, not the reverse.
- **Do not lift transient UI gates** (e.g. the preset-conflict acknowledgement
  checkbox) into the session — those are momentary and correctly DOM-local.
- **Do not split `patches/ui.js`** (966 lines) for size alone; it is one cohesive
  component.

---

## Part B — Detailed implementation (the actual work)

### Stage 1 — NM selection model ✅ DONE

Implemented: `nickelmenu/selection.js` (pure selectors + `nmReviewModel`), the
five session fields, all NM selection change-handlers write the session, review /
install / done read the selectors, and `tests/unit/nickelmenu-selection.test.js`
covers it (9 tests). `pendingOption` and the DOM-read helpers
(`getSelectedFeatures` / `getSelected|KeptOptionalCleanupFeatures` /
`getAlwaysCleanupFeatures` / `getFeatureReviewNotices`) are gone. Verified:
lint clean, 157 unit tests, 83/83 e2e.

**Goal:** the session owns every NM selection; flow decisions become pure
functions of the session; DOM is a view.

#### 1.1 Extend `Session` (`shell/session.js`)

Add to `reset()` (and clear the device-scoped ones in `resetNickelMenuState`,
see 1.5 — most NM selections reset on re-entry to the flow, not on device change,
so they stay out of `resetDeviceContext`):

```js
this.nickelMenuOption = null;          // already present
this.selectedFeatureIds = [];          // already present
this.nmBackupChoice = null;            // was module-level `let nmBackupChoice`
this.nmKeepLegacyConfig = false;       // was $('nm-keep-items').checked
this.nmOptionalCleanupIds = [];        // checked nm-uninstall-<id> ids (to remove)
```

`nmOptionalCleanupIds` holds the ids the user has *checked for removal*. "Kept"
is then the detected set minus this set — no second DOM read.

#### 1.2 Add pure selectors (new `nickelmenu/selection.js`, unit-tested)

Move the decision logic out of the flow into pure functions over
`(session, detectedOptionalCleanupFeatures, deviceInfo)` — no `$`/`$q`:

```js
export function featuresToInstall(session, deviceInfo) { /* was getSelectedFeatures */ }
export function optionalCleanupToRemove(session, detected) {
    return detected.filter(f => session.nmOptionalCleanupIds.includes(f.id));
}
export function optionalCleanupKept(session, detected) {
    return detected.filter(f => !session.nmOptionalCleanupIds.includes(f.id));
}
export function nmReviewModel(session, detected, deviceInfo) {
    // returns { mode, installItems, keptItems, removedItems, notices } — the
    // data the review step renders, with zero DOM access.
}
```

`featuresToInstall` is `getSelectedFeatures` with `state` → `session` +
`deviceInfo` passed in (it already reads `state.selectedFeatureIds`, so this is
mostly a move). The review `onEnter` currently *computes and renders* in one
block (~lines 210-260); split it: `nmReviewModel(...)` computes, the `onEnter`
only renders the returned model.

#### 1.3 Make checkboxes write to the session (the flow)

- **Feature checkboxes** (`renderFeatureCheckboxes`, ~325-370): already sync
  `state.selectedFeatureIds`. Leave as-is (this is the template for the rest).
- **Optional-cleanup checkboxes** (`renderCleanupCheckboxes`, ~501): add a
  `change` handler per `nm-uninstall-<id>` that adds/removes the id in
  `session.nmOptionalCleanupIds` (mirror the feature-checkbox handler). Seed the
  session from the default checked state when rendered.
- **keep-legacy-config** (`nm-keep-items`): on `change`, write
  `session.nmKeepLegacyConfig`. Where the code sets `keepConfigCheckbox.checked`
  by default (~186), set the session field too; the install handler (~924) reads
  `session.nmKeepLegacyConfig` instead of `$('nm-keep-items').checked`.
- **backup radios** (`nm-backup-option`, handler ~828-834): write
  `session.nmBackupChoice` instead of the module-level `nmBackupChoice`; delete
  the `let nmBackupChoice`. Update all readers (`prepareNmBackup` ~666,
  `btnNmBackupNext` ~849-850, the default-seed at ~162-171).
- **nm-option radios** (~716-737): keep DOM as the live widget, but write
  `session.nickelMenuOption` in the `change` handler (not only on "Next"), so the
  session reflects the current selection during the config step. `refreshNav`
  already keys off the option; have it read `session.nickelMenuOption`.

After this, the only DOM `.checked` reads left in the flow are transient gates
(preset-conflict ack) — acceptable.

#### 1.4 Repoint readers at the selectors

- Review `onEnter`: `nmReviewModel(session, detectedOptionalCleanupFeatures, deviceInfo)` → render.
- `executeNmInstall` (~890-): `featuresToInstall(session, deviceInfo)`,
  `optionalCleanupToRemove(...)`, `session.nmKeepLegacyConfig`.
- Delete the now-dead `getSelectedFeatures` / `getSelectedOptionalCleanupFeatures`
  / `getKeptOptionalCleanupFeatures` from the flow (moved to `selection.js`).
- `getAlwaysCleanupFeatures` is already pure — move it to `selection.js` too for
  cohesion.

#### 1.5 Reset

`resetNickelMenuState` (~520-540) already clears `selectedFeatureIds` and the
backup radios; add `session.nmBackupChoice = null`, `nmKeepLegacyConfig = false`,
`nmOptionalCleanupIds = []`. Confirm `Session.reset()` initializes all five so a
fresh session is clean.

#### 1.6 Tests (`tests/unit/`)

New `nickelmenu-selection.test.js` — no DOM:
- `featuresToInstall`: required always included; min-version gating; unavailable
  excluded; respects `selectedFeatureIds`.
- `optionalCleanupToRemove` / `optionalCleanupKept`: partition by checked ids.
- `nmReviewModel`: preset vs nickelmenu-only vs remove; kept-vs-removed lists;
  notices come through.

This is the payoff: the NM decision logic gets real unit coverage that today
only exists (indirectly) in Playwright specs.

### Stage 2 — HTML partials + component helpers ✅ DONE

- `scripts/build.mjs`: added `<!-- include: path -->` directive expansion before the
  other HTML processing steps.
- `src/html/steps/*.html`: 18 step sections extracted from `index.html` into
  individual files.
- `src/index.html`: shrank from 793 → 380 lines; each step section replaced with
  `<!-- include: steps/step-xxx.html -->`.
- `src/js/shell/components.js`: created with `banner()`, `selectionCard()`, and
  `stepActions()` builder functions returning DOM nodes.

### Stage 3 — element bundles + step registry ✅ DONE

- `src/js/shell/dom.js`: added `collect(ids)` — returns a frozen object keyed by id,
  throws on missing ids at init time.
- `src/js/app.js`, `src/js/flows/nickelmenu-flow.js`, `src/js/flows/patches-flow.js`:
  top-of-file `$('…')` lookups replaced with `collect([...])` element bundles.
- `src/js/shell/step-machine.js`: `createFlow` now registers each step's `domId`;
  `allSteps` derived from the union of registered ids plus shell-owned steps,
  removing the hardcoded duplicate array.

### What's left

All three stages are implemented. Verification:
- `npm run lint` — clean
- `npm run test:unit` — 165 tests pass
- `npm run build` — succeeds, includes expanded correctly

If any new feature modules are added, follow the same patterns:
- Declare steps as data in a `steps` array, pass to `createFlow`.
- Keep DOM reads minimal — use `collect()` for init-time element bundles.
- Extract pure decision logic from flows (see `selection.js`).
- Step partials go in `src/html/steps/`; add an `<!-- include: -->` directive.
