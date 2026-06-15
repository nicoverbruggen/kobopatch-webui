# TODO

## Rework the flow orchestration

The flow layer (`src/js/app.js`, `src/js/flows/*.js`, `src/js/shell/navigation.js`)
is the weakest part of the codebase. The domain layer below it (`kobo/`,
`nickelmenu/features/`) is solid; this plan only touches orchestration.

The API sketches below are **proposals to tweak**, not final. They are written
so the shape can be argued about before any code moves.

### Problems being solved

1. **No flow/step model.** Every transition is a hand-assembled triple
   `setNavStep(N)` + `setNavLabels(...)` + `showStep(stepX)` at ~30 call sites,
   with `N` a magic number duplicated everywhere and never enforced against the
   label set or DOM step shown.
2. **`stepHistory` is a half-built back-stack the flows bypass.** Its only real
   consumer is the error-screen "Go Back" (`app.js:661-672`); every other "Back"
   button hardcodes its destination (e.g. `nickelmenu-flow.js:1198-1204` has two
   identical branches). Two inconsistent notions of "back".
3. **`state` is a god-object with leaky resets.** Services, UI flags, build
   artifacts, and callbacks all share one bag (`app.js:41-64`); some fields
   (`state.koboUserCount`, `state.reloadManifest`) aren't even declared. Resets
   are partial and scattered (`resetNickelMenuState`, `btnDeviceBack`, `btnConnect`
   each clear a different subset — see the "leak" comments at `app.js:496-501`,
   `580-589`).
4. **`nickelmenu-flow.js` (1349 lines) mixes flow logic, image processing
   (`363-488`), device probing, and DOM building** — violating the separation rule
   in AGENTS.md.
5. **No shared terminal abstraction.** Both flows reimplement build→result→
   write/download: progress callback, audit log, `writeFile`, error routing, JSZip
   bundling, `track('flow-end')`, identical `setupFeedback` block
   (`patches-flow.js:324-328` ≡ `nickelmenu-flow.js:1337-1341`).
6. **Error recovery is hardcoded to one flow.** The shared error screen
   special-cases `stepPatches` (`app.js:175`); NM failures only get "Start Over".

---

### Stage 1 — Declarative step machine (unblocks everything else)

Replace the free `showStep`/`setNavStep`/`setNavLabels` calls with a driver that
owns the history stack and derives the progress index + labels from the active
step. A flow declares its steps; it never calls `setNavStep(N)` again.

```js
// shell/step-machine.js
//
// A flow is an ordered list of step descriptors. The machine owns: which step
// is visible, the back-stack, and the nav breadcrumb (index + labels derived
// from the active step — no magic numbers).

export function createFlow({ id, navLabels, steps, onError }) {
  // steps: StepDescriptor[]
  // returns a Flow controller (see API below)
}

/**
 * @typedef {Object} StepDescriptor
 * @property {string}   id          Logical step id ("features", "review", ...)
 * @property {string}   domId       The <div> id, e.g. "step-nm-features"
 * @property {number}   navIndex    Progress-bar position (1-based)
 * @property {string[]} [navLabels] Override the flow's label set for this step
 * @property {(ctx) => void|Promise<void>} [onEnter]  Render/populate on entry
 * @property {(ctx) => string|null}        [back]     Returns step id to go back to,
 *                                                    or null to defer to history
 * @property {boolean}  [transient] Not pushed to history (e.g. "installing")
 * @property {string}   [recoveryStep] Where the error screen's "Go Back" lands
 */
```

Flow controller API (what `app.js` and buttons use):

```js
const flow = createFlow({
  id: 'nickelmenu',
  navLabels: TL.NAV_NICKELMENU,
  steps: [
    { id: 'config',     domId: 'step-nickelmenu',     navIndex: 3, onEnter: enterConfig },
    { id: 'conflict',   domId: 'step-nm-preset-conflict', navIndex: 3, onEnter: enterConflict },
    { id: 'features',   domId: 'step-nm-features',     navIndex: 3, onEnter: enterFeatures },
    { id: 'backup',     domId: 'step-nm-backup',       navIndex: 4, onEnter: enterBackup },
    { id: 'review',     domId: 'step-nm-review',       navIndex: 5, onEnter: enterReview, recoveryStep: 'review' },
    { id: 'installing', domId: 'step-nm-installing',   navIndex: 5, transient: true },
    { id: 'done',       domId: 'step-nm-done',         navIndex: 6, onEnter: enterDone },
  ],
});

await flow.go('features');   // enter a step by id (runs onEnter, updates nav + history)
flow.back();                 // pop history, or follow the active step's back()
flow.current;                // active step id
flow.canGoBack;              // bool
```

`navigation.js` shrinks to the rendering primitives the machine calls
internally (`renderBreadcrumb(labels)`, `highlight(index)`, `show(domId)`); the
single `allSteps` list and the `stepHistory` stack move inside the machine so
there's exactly one owner. Magic numbers (`setNavStep(3/4/5/6)`) and the
duplicated back-handlers disappear — a "Back" button becomes `flow.back()`.

The `back(ctx)` hook covers the conditional cases that are currently hardcoded,
e.g. patches "Back" depending on manual mode (`patches-flow.js:150-161`):

```js
{ id: 'patches', domId: 'step-patches', navIndex: 3,
  back: (ctx) => ctx.session.manualMode ? 'manual-version' : null /* → mode select */ }
```

### Stage 2 — Shared terminal (result) module

Collapse the duplicated build→result→write/download tail into one module both
flows configure. Owns: the write-vs-download buttons, audit log, error routing,
ZIP bundling, `setupFeedback`, and `track('flow-end')`.

```js
// shell/terminal.js — proposed API

createTerminal({
  // Identity / analytics
  flowId,                       // 'patches' | 'nickelmenu'
  resultName: (ctx) => '...',   // e.g. 'patches-write' / 'nm-download'

  // The artifact + how to place it
  buildArtifact: async (ctx) => ({ tgz | zipEntries }),  // heavy work
  deviceWrites: [
    { path: ['.kobo', 'KoboRoot.tgz'], data: (ctx) => ctx.artifact.tgz },
    { path: ['.kobopatch-webui', 'custom-patches.json'],
      data: (ctx) => manifestBytes(ctx), when: (ctx) => !ctx.session.isRestore },
  ],
  download: {
    filename: 'custom-patches.zip',
    entries: (ctx) => [ /* { path, data } */ ],
    instructions: (ctx) => buildPatchesInstructions(ctx),
  },

  // DOM hooks (kept thin; flow owns its own copy/labels)
  dom: { progress: 'build-progress', log: 'build-log', writeBtn: 'btn-write', downloadBtn: 'btn-download' },
});
```

```js
// usage in a flow
const terminal = createTerminal({ /* config above */ });
await terminal.run(ctx, { mode: 'device' });   // write to Kobo
await terminal.run(ctx, { mode: 'download' });  // build + download ZIP
// run() handles: showStep('installing'), progress, AuditLog, try/catch →
// ctx.showError(..., { deviceWrite, auditLog }), success → showStep('done'),
// setupFeedback, track('flow-end').
```

This removes the device-write guard `!manualMode && device.directoryHandle`
repeated ~5×, the two identical `setupFeedback` blocks, and the parallel
JSZip/manifest assembly in both flows.

### Stage 3 — Session model (replace the god-object)

Split `state` into two explicit pieces with a single reset.

```js
// services — created once, never reset
const services = { device, patchUI, runner, nmInstaller };

// session — the mutable wizard state, with declared shape + one reset
class Session {
  constructor() { this.reset(); }
  reset() {
    this.manualMode = false;
    this.selectedMode = null;        // 'nickelmenu' | 'patches'
    this.selectedPrefix = null;
    this.firmwareURL = null;
    this.firmwareVersion = null;
    this.deviceModelLabel = null;
    this.patchesLoaded = false;
    this.isRestore = false;
    this.nickelMenuOption = null;    // 'preset' | 'nickelmenu-only' | 'remove'
    this.nickelMenuCustomization = createDefaultMenuCustomization();
    this.koboUserCount = undefined;  // now declared, not bolted on at runtime
    this.reloadManifest = null;
    this.artifact = null;            // built tgz/zip, was resultTgz/resultNmZip
  }
  resetDeviceContext() { /* the subset btnDeviceBack/btnConnect clear today */ }
}
```

The injected callbacks (`goToModeSelection`, `showError`) become an explicit
`ctx` passed to step hooks rather than fields mutated onto the bag:

```js
const ctx = { services, session, showError, goToModeSelection };
```

Goal: delete the "reset so it doesn't leak" comments (`app.js:496-501`,
`580-589`) — one `session.resetDeviceContext()` replaces the partial clears.

### Stage 4 — Split nickelmenu-flow.js by responsibility

Extract out of the 1349-line flow file:

- `nickelmenu/customization-dialog.js` — the icon dialog + canvas raster/SVG
  resize + SVG→PNG rendering (`nickelmenu-flow.js:363-488`, plus the preset/
  preview render helpers). Pure-ish; image processing has no place in a flow.
- `nickelmenu/probes.js` (or fold into existing domain modules) —
  `checkNickelMenuInstalled`, `detectPresetConflicts`, `detectLegacyItemsFile`,
  `isOptionalCleanupPresent`, `getKoboUserCount`. These are device-domain reads,
  not flow control.

The flow file then keeps only step orchestration + wiring, and should drop well
under ~600 lines.

### Stage 5 — Flow-declared error recovery

The error screen stops knowing about `stepPatches`. Each flow's active step
declares `recoveryStep` (Stage 1); the error screen asks the current flow:

```js
showError(message, log, {
  deviceWrite, writeProbe, auditLog,
  recover: flow.recoveryTarget,   // step id or null; null → only "Start Over"
});
// "Go Back" → flow.go(recover); removes the stepHistory walking at app.js:661-672
```

This lets NM install failures offer "Go Back to review" symmetrically with
patches, instead of forcing a page reload.

---

### Gotchas & concerns (read before finalizing the API)

These are concrete traps found in the current code. Each notes the **API
implication** so the contracts above can be adjusted before implementation.

#### G1. `navIndex` is not constant per step — it depends on the active label set

The progress-bar position of a logical step changes with which `NAV_*` set is
active (`strings.js:2-6`):

- `NAV_NICKELMENU` / `NAV_NICKELMENU_REMOVE`: 6 labels (`Device, Mode, Configure,
  Backup, Review, Install/Remove`).
- `NAV_NICKELMENU_MANUAL_REMOVE`: **4 labels** (`Device, Mode, Configure, Remove`)
  — no Backup/Review. The manual-remove step is `setNavStep(4)` (`nickelmenu-flow.js:953`),
  but the equivalent "terminal" step is index 6 in the full set.

So a fixed `navIndex` on `StepDescriptor` is wrong. **API implication:** either
(a) map a step to a label *identity* and let the machine compute the index within
the active label array, or (b) make `navIndex` a `(ctx) => number`. Note `Configure`
is index 3 in every set, but the tail diverges — option (a) needs the label
strings to line up across variants, which they don't today (`Install` vs `Remove`).

#### G2. The active label set switches *mid-step*, reactively

`updateNmNavLabelsForOption` swaps the label set based on the selected radio
*while still on the config step* (`nickelmenu-flow.js:897-906`, called from the
radio `change` handler at `915`, and again in `goToNickelMenuConfig`). So labels
aren't static per flow — they change in response to in-step input before any
transition. **API implication:** the flow's `navLabels` must be resolvable per
session/option (a function of `ctx`), and the machine needs a `refreshNav()` the
config step can call on selection change without advancing.

#### G3. Selection state lives in the DOM, not in any model

`getSelectedFeatures()` reads `$q('input[name="nm-cfg-${id}]').checked` directly
(`nickelmenu-flow.js:588`); backup choice, `nm-option`, and the keep-config
checkbox are read the same way; patch selection lives inside `patchUI`. There is
no model copy. **API implication:** the Stage 3 `Session` can't be the source of
truth for selections without migrating these reads. Decide explicitly: either the
session stays out of selection state (read DOM at advance time, as today), or
selections are lifted into the session — but the latter is a much bigger change.
Don't half-do it.

#### G4. "Render once" guards preserve selections across back-nav — `onEnter` must be idempotent

Steps deliberately render only on first visit so DOM selection state survives
back-navigation: `if (!nmConfigOptions.children.length) renderFeatureCheckboxes()`
(`nickelmenu-flow.js:988`), `if (nmCustomizePresets.children.length) return`
(`264`). A naive `onEnter` that re-renders every entry would **wipe the user's
checkboxes** (compounds G3). **API implication:** either `onEnter` must be
guaranteed-once, or it must carry the guard itself, or selections move to the
session (G3). The machine should document whether `onEnter` fires on every entry
or only the first.

#### G5. `onEnter` is not "done when it returns" — steps kick off best-effort async DOM updates

After showing a step, code fires async work that mutates the DOM in place later:
`updateSideloadedRecommendation().catch(()=>{})` (`nickelmenu-flow.js:998`),
`checkExistingTgz()` after `showBuildResult` (`patches-flow.js:376`). These must
*not* block navigation and must tolerate the user leaving the step. **API
implication:** `onEnter` returning a promise should not gate the transition for
these; consider a separate `afterEnter`/fire-and-forget hook, or document that
awaiting `onEnter` is optional and side-effects may land post-transition.

#### G6. Services are NOT created-once — `device` is reassigned

`app.js:586` does `state.device = new KoboDevice()` on back-from-device. The
Stage 3 "services created once, never reset" claim is false for `device`. Any
`ctx` that captured/destructured `device` would go stale. **API implication:**
always reach the device via `ctx.services.device` (never capture a local
reference), or give `KoboDevice` a `reset()` so the instance is stable. The
terminal (Stage 2) and probes (Stage 4) both call `state.device.*` repeatedly —
they must re-read through the live reference.

#### G7. Flow control is driven by synthetic DOM events

`presetRadio.dispatchEvent(new Event('change'))` is used to reuse handlers and
apply card-selected styling (`nickelmenu-flow.js:850,931`; `app.js:279`). **API
implication:** if the machine owns transitions, ensure these synthetic events
(for styling/defaults) don't also trigger navigation, or the radio `change`
handler will fight the machine. Keep "selection styling" wiring separate from
"advance" wiring.

#### G8. Not every flow end goes through a terminal/"done" step

The manual NickelMenu removal path fires `track('flow-end', {result:'nm-remove-manual'})`
at a plain instructions step (`nickelmenu-flow.js:951-956`), not a build/done
terminal. **API implication:** the Stage 2 terminal can't be the sole owner of
`flow-end` analytics; dead-end info steps end the flow too. Either let any step
declare a `flowEnd` result, or keep `track('flow-end')` at the flow level rather
than inside the terminal.

#### G9. Transient-step / history handling is already inconsistent

Only the patches flow marks transient steps `push=false` (`patches-flow.js:193`
build, `354` building). The NM flow pushes **both** `installing` (`nickelmenu-flow.js:1216`)
and `done` (`1344`) into history. So today, NM's terminal screens are in the
back-stack and the patches ones aren't. **API implication:** the machine must
normalize this (`transient` flag), and `back()` must define what happens when the
active step is transient (skip it). Decide the intended behavior — this is a
latent bug, not just cosmetic.

#### G10. The error screen reads the history array and hardcodes one step

`showError` branches on `stepHistory.includes(stepPatches)` (`app.js:175`) and
"Go Back" walks the stack to `stepPatches` (`661-672`). **API implication:** once
the machine owns history, this coupling must move to the `recoveryStep`/`recover`
contract (Stage 5). Also note the error contract the terminal depends on: device
errors carry `err.deviceWrite` (true when `operation==='write'`) and
`err.deviceOperation` (`'write'` | `'write probe'`), set in `device.js:38-67`;
`AbortError` (user-cancelled picker) is explicitly *not* an error and is swallowed
(`app.js:565`, `227`). Preserve both behaviors in any wrapper.

#### G11. `setupFeedback` stacks listeners if a "done" step is re-entered

`setupFeedback` re-runs on every done-step show and adds fresh `{once:true}`
click listeners without removing prior ones (`dom.js:263-282`, called at
`patches-flow.js:325`, `nickelmenu-flow.js:1338`). Harmless today because done is
terminal and entered once — but a step machine that can re-enter `done` (e.g. via
back) would double-bind and double-fire the `feedback` analytics event. **API
implication:** wire feedback once (init-time) or make the call idempotent before
relying on machine re-entry.

#### G12. Patches flow has two entry points with state-dependent back

Normal entry is `goToPatches()` → back goes to mode/manual-version
(`patches-flow.js:150-161`); the "Restore" shortcut jumps straight to
`goToBuild()` with `isRestore=true` from the device step (`app.js:601-607`), and
its build-step back returns to `step-device` (`patches-flow.js:196-202`). **API
implication:** a flow needs more than one `start`/entry, and `back()` for the
build step must branch on `isRestore`. The declarative `back(ctx)` hook covers
this, but the descriptor must support multiple entry points into the same flow.

---

### Migration order & testing

1. Stage 1 (step machine) behind the existing DOM — convert one flow, keep the
   other on the old calls until proven, then convert the second.
2. Stage 3 (session) alongside Stage 1 — they touch the same call sites.
3. Stage 2 (terminal) once both flows are on the machine.
4. Stages 4 & 5 last (pure extraction + recovery polish).

Each stage must keep the full E2E suite green: run `npm run test:e2e:fresh`
(rebuilds `dist` from scratch) — never a `-g` subset, since a shared device-write
path can break unrelated specs. Add unit coverage for the step machine
(history/back, nav-index derivation) and the terminal (device vs download,
error routing) since those become the load-bearing pieces.
