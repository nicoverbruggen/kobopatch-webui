# Add a post-write validation step

**Goal:** after a device install finishes (all files copied), verify every file
was actually written correctly by reading it back from the device. If a file
fails verification, try to write it again once; if it still fails, tell the user
the installation may not have worked and steer them to the manual installation
option (download the package and copy it by hand).

This is a reliability/safety feature: writes today are assumed to have succeeded
once `writeFile` resolves, but a flaky USB connection or filesystem can leave a
truncated or stale file with no error. Reading the bytes back catches that.

## Where this lives today

- **All device writes funnel through one function:** `writeToDevice` in
  `src/js/shell/terminal.js`. It loops over `writes`
  (`{ path, data, label, optional }`), calls `DeviceWriter.writeFile`, records an
  audit step per write, writes the audit log (`audit.write()`), and on failure
  records a `Failed:` line and routes to `state.showError` with `deviceWrite`.
  Both flows go through it: `flows/patches-flow.js` (`btnWrite` handler, ~line
  541) and `flows/nickelmenu-flow.js` (~line 688). **Putting verification here
  covers both flows for free** and keeps the flows/installer generic (per
  AGENTS.md).
- **Read-back is already available:** `DeviceWriter`
  (`src/js/kobo/device-writer.js`) exposes `readFileBytes(path)` and
  `readFileRange(path, offset, length)`. `device.verifyWriteAccess()`
  (`src/js/kobo/device.js:146`) already does a write-then-read-back probe of a
  scratch file — precedent for the exact pattern.
- **The data we compare against is exact bytes.** Each `write.data` is the
  `Uint8Array` we hand to `writeFile` (KoboRoot.tgz, the `custom-patches.json`
  manifest, conf-setting files, NickelMenu/add-on files). `writeFile` writes
  those bytes verbatim, so a correct read-back must equal `write.data`
  byte-for-byte. (The `Kobo eReader.conf` read-modify-write happens *before* the
  bytes reach `writeToDevice`, so we still just compare to the bytes we asked to
  write.)
- **Audit log** (`src/js/kobo/audit-log.js`) records each step; `writeToDevice`
  already records writes and a `Failed:` line. We add verification records here.
- **Manual-install affordance lives on the result step, not the error screen.**
  The Download button (`btnDownload` + `download-instructions` in
  `patches-flow.js`; equivalent in `nickelmenu-flow.js`) sits right next to Write
  on the same screen. The error screen (`shell/error-screen.js`) has a
  `deviceWrite` branch (connection tips, Retry, no Back) but **no
  download-for-manual-install action today.**

## Design / decisions

- **Verify inside `writeToDevice`, per write, right after each successful write.**
  Re-read with `writer.readFileBytes(write.path)` and compare: length first, then
  a byte compare. Only verify writes that actually happened — a *required* write
  that succeeded, or an *optional* write that succeeded. An optional write that
  was skipped (its `writeFile` threw and was swallowed) is **not** verified.
- **Do not verify the audit log itself.** It's written last by `audit.write()`
  and is best-effort; verifying it would be circular.
- **Retry policy:** on a mismatch or a read error, re-write the file once and
  re-verify. Still bad → it's an unrecoverable verification failure for that file.
- **Failure presentation — open decision (recommend Option A):**
  - **Option A (recommended): soft-fail on the result step.** Return a distinct
    result from `writeToDevice` — e.g.
    `{ ok: false, verifyFailed: true, failures: [path…], audit }` — **without**
    routing to the hard error screen. The caller keeps the user on the result
    step, flips the Write button back, and reveals a prominent warning next to
    the existing Download button: "We couldn't confirm every file was written.
    Download the package and install it manually." This reuses the manual-install
    UI that's already on that screen and is the least disruptive.
  - **Option B: hard error screen.** Route via `showError` with a new
    `verifyFailed` option + message. Mirrors the current write-failure path, but
    the error screen has no manual-download action, so we'd have to add one (or
    rely on Retry). More UI work for a worse outcome.
- **Performance.** Full byte re-read of every written file adds USB round-trips.
  KoboRoot.tgz is ~1–2 MB for patches, but NickelMenu/add-on installs (e.g.
  KOReader) write larger and/or many files. Mitigations: always compare length
  (cheap, catches truncation); show a "Verifying files…" status so a slow pass
  isn't a silent hang (`writeToDevice` has no progress UI today — add a light
  status/progress callback like the build phase, or thread one through). Optional
  optimization: above a size threshold, compare length + a hash of a few
  `readFileRange` windows instead of the whole file. Default to a full compare
  for correctness; only optimize if it proves slow.

## Tasks

- [ ] Add a verification pass to `writeToDevice` (`terminal.js`): after each
      successful, non-skipped write, re-read via `writer.readFileBytes(write.path)`
      and compare (length, then bytes). On mismatch/read-error, re-write once and
      re-verify.
- [ ] Record verification in the audit log: `Verified <path>`,
      `Re-wrote <path> after verification mismatch`,
      `Verification failed: <path>`.
- [ ] On unrecoverable verification failure, return the distinct result
      (`verifyFailed: true`, `failures: [paths]`) per Option A — do **not** throw,
      and leave the existing hard-write-failure path (`showError` + `deviceWrite`)
      unchanged.
- [ ] Update callers to handle `verifyFailed`:
  - [ ] `patches-flow.js` `btnWrite`: restore the Write button, reveal a
        verify-failed warning banner near Download, nudge to manual install.
  - [ ] `nickelmenu-flow.js` device-write path: same treatment.
  - [ ] Add the warning banner element(s) if not already present.
- [ ] Add a "Verifying files…" status while the pass runs (status text or a small
      progress indicator) so a slow read-back is visible.
- [ ] Add copy to `TL` (`src/js/shell/strings.js`): the verifying status, the
      verify-failed warning + manual-install nudge, and the audit phrases.

## Tests (required — this is the highest-risk path in the repo)

- [ ] Extend `RecordingDevice` (`tests/unit/test-helpers.js`) so read-back can be
      forged: e.g. `corruptReadbackPaths` (read-back differs from what was
      written) and `corruptReadbackOnce` (first read-back bad, second good) to
      drive the retry path. Today `readFileBytes` returns exactly what was written
      via `writeFor`, so verification would always pass without this hook.
- [ ] Unit (`tests/unit/terminal.test.js`):
  - [ ] success → every write verified, audit has `Verified` lines, `ok: true`.
  - [ ] mismatch then retry succeeds → a second `writeFile` is recorded, audit
        notes the re-write, `ok: true`.
  - [ ] mismatch persists after retry → `ok: false`, `verifyFailed: true`,
        `failures` lists the path, nothing thrown, audit notes the failure, and
        `showError` is **not** called (Option A).
  - [ ] read-back throws → treated the same as a mismatch (retry, then fail).
  - [ ] a skipped optional write is not verified (no spurious failure).
- [ ] E2E (Playwright): a mock device that accepts writes but returns differing
      bytes on read-back → after clicking Write the user stays on the result step,
      sees the verify-failed warning, and the Download button is offered. Cover
      both the patches and NickelMenu device-write specs (shared code path, but
      assert the UX in each).

## Out of scope

- **Download packages** — no device write happens, so there is nothing to verify.
- **Rollback** — still none. The app does not undo partial writes
  (see `device-writer.js`); a verification failure surfaces guidance, it does not
  try to clean up.
- **Write ordering and audit-log best-effort semantics** — unchanged.

## Open question to resolve before implementing

- Option A (soft-fail on the result step, reuse Download) vs Option B (hard error
  screen with a new download action). Recommend **A**.
