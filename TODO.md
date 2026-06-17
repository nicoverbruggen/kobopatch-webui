# TODO

## Unit test coverage — continuation

Context: the JS was reorganized by responsibility and unit coverage was expanded
from 165 → 221 tests, including a jsdom harness (`tests/unit/dom-harness.js`) that
unlocks DOM-coupled modules. Pick up the remaining gaps below.

### Next reachable targets (jsdom harness already supports these)
- [ ] `shell/error-screen.js` — `showError` branching: device-write vs write-probe
      vs explicit title vs recovery vs back-step vs generic; the global
      `error`/`unhandledrejection` handlers; the error-step buttons (Back/recovery,
      Download log, Retry). Needs the error/patches step elements (already in the
      harness skeleton) plus a stub `getActiveFlow`.
- [ ] `nickelmenu/checkbox-list.js` — `renderNmCheckboxList`: sectioned/collapsible
      rendering, disabled + disabled-reason, version label, hint badge (URL vs
      text popup), the customize action button/summary. Pure DOM; pass item
      descriptors and assert the built structure.

### Lower priority / more setup
- [ ] `patches/ui.js` `loadFromZip` — build a small in-memory zip with JSZip and
      assert parsed `patchFiles`/`patchConfig`/pristine text. (ui.js model is
      otherwise well covered; this is the main remaining branch.)
- [ ] `shell/navigation.js` — `showStep` history push/rewind and `setupCardRadios`
      (jsdom). Currently only partially covered via step-machine.
- [ ] `nickelmenu/probes.js` — device-domain reads; mock device like the existing
      `kobo-device` / `terminal` tests (no DOM).

### E2E territory (low unit-test ROI — leave to Playwright)
- Flow controllers: `connect-flow`, `manual-flow`, `mode-flow`, `nickelmenu-flow`,
  `patches-flow`, `nickelmenu-execute`, and `app.js` (orchestrator).
- `shell/chrome.js`, `nickelmenu/customization-dialog.js` (canvas/image processing),
  `patches/runner.js` + `workers/patch-worker.js` (web worker).

## Coverage tooling
- [ ] Revisit a whole-tree coverage % once tooling catches up to Node 26. `c8` is
      currently incompatible (its yargs CLI crashes on startup under Node 26), so
      it was removed. `npm run test:unit:coverage` uses Node's native
      `--experimental-test-coverage`, which **only reports files that get loaded** —
      untested files are omitted, so the "all files" average is optimistic. A true
      denominator needs `c8 --all` (or `nyc --all`) seeding unloaded files at 0%,
      via the programmatic `c8` `Report` API if the CLI is still broken.

## Housekeeping
- This restructure + test work is **uncommitted**. Review the working tree and
  commit (branch off `develop`) when ready.
