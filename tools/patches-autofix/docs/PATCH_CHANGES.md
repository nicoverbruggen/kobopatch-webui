# Patch changes since `develop`

Everything this branch changed about the patch catalog, and why. It covers the
repair of the patches that broke after the 2026 firmware bump (4.45.23697 /
4.38.23697), the rework that makes most of them **survive future firmware updates
on their own**, and the catalog/metadata cleanups. The one engine change that
enabled it (the `Window` search) has its own doc: **`KOBOPATCH_EXTENSION.md`**.

Firmware exercised: the 4.45 line (23646/23684/23697) and 4.38 line
(23429/23552/23648/23684/23697) — **8 builds**.

---

## At a glance

| Patch | On `develop` | Now | Lines |
|---|---|---|---|
| Allow showing info panel… | offset + stale class name | **self-locating** + renamed class | 4.45/4.38 |
| Hide browser from beta features | two stale offsets | **self-locating** (×2) | 4.45/4.38 |
| Replace adobe page numbers toggle… | stale offsets | **self-locating** | 4.45/4.38 |
| Set KePub hyphenation | one stale offset | **self-locating, bounded** to the `"justify"` call | 4.45/4.38 |
| Disable forward/backward swipe Gestures | raw BLX bytes | **self-locating** by symbol | 4.45/4.38 |
| Disable menu swipe gesture | raw BLX bytes | **self-locating** by symbol | 4.45/4.38 |
| Customize ComfortLight settings | hardcoded address | **self-locating** by code fingerprint | 4.45/4.38 |
| Remove PDF map widget… | hardcoded jump addresses | **self-locating** by target symbol | 4.45/4.38 |
| Remove forgot pin button… | CSS edit (in `nickel.yaml`) | **code patch** (in `libnickel…yaml`) | 4.45/4.38 |
| My 24 line spacing values | broken sanity bytes | sanity bytes refreshed (still offset-based) | 4.45/4.38 |
| **Allow rotation on all devices** | present | **removed** (see end) | 4.45/4.38 |

Plus: `blacklist.json` went **10 → 0**; `patch-metadata.js` got **9 friendlier UI
labels** and lost the rotation entry.

---

## The core idea (plain English)

A patch means "change the code at *this exact spot*." On `develop` the spot was
usually described like a street address: **"the function `updateReadingMenu`, then
walk 238 bytes in."** The function name is stable — the firmware tells us where it
is — but "238 bytes in" is fragile: a firmware update rearranges the function's
insides and the thing we wanted is now at 240, or 230. The patch edits the wrong
spot, fails its safety check, and gets blacklisted. **That's what broke these.**

The fix is to stop counting bytes: say **"the function `updateReadingMenu`, then
find the one call to `hasOrientationSensor` inside it."** The call is what we
actually care about, and the firmware always tells us where each function lives —
so we find it no matter how the insides moved. That "find the call" search is the
single small engine feature (`Window`) documented in `KOBOPATCH_EXTENSION.md`; if
there's more than one match (ambiguous) or none, it refuses rather than guess.

Below, "old = count bytes", "new = find the call."

---

## Per-patch changes

### Self-locating conversions (the `Window` search)

**Allow showing info panel on random screensaver** — shows the book info panel even
with a random screensaver image.
*Old:* byte-count to a `…setInfoPanelVisible` call. Doubly broken: the offset
drifted **and** Kobo renamed the owning class on the newer line
(`FullScreenDragonPowerView` → `BookCoverDragonPowerView`).
*Now:* find-the-call to the correctly-named function (each firmware line keeps its
own name; the old symbol is confirmed gone on 4.45).

**Hide browser from beta features** — hides the built-in browser from beta features.
*Old:* two byte-counts to two `isParentalControlEnabled` calls.
*Now:* find-the-call for both; each is the only such call in its function.

**Replace adobe page numbers toggle with invert screen** — swaps a rarely-useful
toggle for an "invert screen" one.
*Old:* byte-counts to several `getShowAdobePageNumbers`/`setShow…` calls.
*Now:* find-the-call for each.

**Set KePub hyphenation** — forces hyphenation on in KePub books. *The tricky one.*
The code asks three near-identical questions in a row: "alignment == `default`?",
"== `default`?", "== `justify`?" We want only the **`justify`** one.
*Old:* byte-count straight to it.
*Now:* a **bounded** find-the-call — the search window starts *after* the first two
questions, so the only match is the `justify` one (verified by disassembling all
three: the first two compare `"default"`, the third `"justify"`). If a future build
blurs that, it refuses rather than edit the wrong comparison.

**Disable forward/backward swipe gestures** & **Disable menu swipe gesture** — turn
off swipe-to-turn-page and the swipe-up menu.
*Old:* matched the **raw bytes** of the page-turn / menu calls — which change every
firmware, so they broke.
*Now:* find-the-call to the four functions by name (`nextPageWithTimer`,
`prevPageWithTimer`, `openQuickAccess`, `openFooterMenuOnSwipe`) and blank them out.
(On `develop`, 4.38 had drifted raw bytes that failed on older 4.38 builds; both
lines are now self-locating.)

### Self-maintaining, but not via `Window`

**Customize ComfortLight settings** — changes the ComfortLight/bedtime dropdown times.
*Old:* a single hardcoded address to an **unnamed** helper function (no symbol to
anchor on), so it broke whenever the address moved.
*Now:* anchored on the function's **16-byte prologue fingerprint** via kobopatch's
existing `FindBaseAddressHex` — unique in the library and identical across firmware,
so the patch finds itself. All its inner edits are `Find`-guarded (fail safe).

**Remove PDF map widget shown during panning** — hides the map overlay while panning
a PDF.
*Old:* hardcoded numeric jump addresses (with a stale "this is broken" TODO).
*Now:* the two jumps are described **by the function they target**
(`updatePanningMap` → redirected to `hideMapWidget`) using `SymPLTTail`; each of the
two adjacent jumps is found within its own short search window.

### Reworked from a different angle

**Remove forgot pin button from lock screen** — hides the "Forgot PIN → Sign Out"
button (it factory-resets the device, so hiding it prevents accidents).
*Old:* edited the lock screen's **stylesheet (CSS)**. The problem: that stylesheet
is a **byte-for-byte duplicate** of the parental-control PIN screen's stylesheet,
so nothing can tell them apart by content — and they even swap order between builds,
risking hiding the button on the *wrong* screen.
*Now:* patches the **code** instead. The lock screen is built by
`Ui_PinCodeInputDialog::setupUi` — a class entirely separate from the parental-
control view — where the two labels' text is set by two `setText` calls. Each is
swapped for `QWidget::hide()` (an idiom already used by another Kobo patch), hiding
the labels directly regardless of layout. This **moved the patch** from
`nickel.yaml` (a resource edit) to `libnickel.so.1.0.0.yaml` (a code edit) and made
it work identically on every build, with no special engine code. **Verified working
on-device** (the Forgot PIN / Sign Out button is gone and PIN unlock still works).

### Still position-based (couldn't switch to find-the-call)

**My 24 line spacing values** — replaces Kobo's line-spacing slider with 24 custom
values. It rewrites a *table of numbers*, not a single call, so there's no call to
search for. The firmware bump only nudged a few internal "sanity-check" bytes, which
were refreshed; the patch is `Find`-guarded so it can only apply if everything
around it still matches, otherwise it refuses. **Verified working on-device** (the
slider shows the 24 values and applies correctly).

---

## Display labels (`src/js/patches/patch-metadata.js`)

Nine patches whose raw YAML names read awkwardly got a friendlier **display label**
(the YAML key — the patch's stable identity — is unchanged; the original name still
shows in "original format" view):

| YAML name | Label |
|---|---|
| My 24 line spacing values | More line-spacing steps (24) |
| My 10 line spacing values | Fewer line-spacing steps (10) |
| Set KePub hyphenation | Always hyphenate KePubs |
| Un-Force user font-family in KePubs | Allow publisher fonts in KePubs |
| Un-force link decoration in KePubs | Keep publisher link styling (KePubs) |
| ePub constant font sharpness | Fixed ePub font sharpness |
| Set visible SmartLink | Choose home-screen SmartLink |
| Increase size of kepub/audio chapter progress chart | Larger chapter progress chart |
| Don't uppercase header/footer text and change page number text | Lowercase header/footer + custom page numbers |

The "Allow rotation on all devices" metadata entry was removed along with the patch.

## Blacklist

`patches/blacklist.json` listed **10** incompatible patches on `develop` (8 in 4.45,
2 in 4.38). It is now **empty** for both lines.

---

## How it was verified

- **Byte-for-byte equivalence.** Every patch converted from a fixed `Offset` to a
  `Window` search was applied **both ways** and the resulting ELF compared across
  all 8 builds — every pair is identical, i.e. the search lands on exactly the call
  the hardcoded offset did. ComfortLight's signature form is likewise byte-identical
  to its original hardcoded address on the build where that address was valid.
- **Forgot-pin** (a genuinely new mechanism, not comparable byte-for-byte) was
  verified by disassembling the patched binary on every build to confirm both
  `setText` sites became `hide()`.
- **Apply across builds.** `kobopatch -t` passes for all patches on all 8 builds
  (the only historical exceptions were unrelated and on the oldest 4.38 build).
- **End to end.** Go unit tests for the new search, `npm run test:patches:check`,
  `npm run check:patch-metadata`, and the WASM integration test all pass; the
  in-browser engine was rebuilt with the change.

---

## Method & future maintenance

How these were diagnosed and fixed, and how to redo it after the next firmware bump:

1. **Reproduce.** Generate a config and run the tester per firmware (see
   `tools/kobopatch-wasm/test-patches.sh`, or `npm run test:patches`). Failing
   patches print `✕` with a one-line reason and the failing `line N: inst K`.
2. **Extract & disassemble.** Pull the target ELFs from a cached firmware zip
   (`tools/patches-autofix/extract-binaries.sh <version>`) and disassemble with
   LLVM `objdump --triple=thumbv7-linux-gnueabihf` (these are 32-bit ARM Thumb-2).
3. **Locate the new target.** `tools/patches-autofix/finder` reuses kobopatch's own
   resolver/assembler to report exactly where a call moved
   (`finder findblx <bin> "<Func>" "<TargetSym>" <window>`), so updating an
   `Offset` — or confirming a `Window` is unambiguous — is a ~1-minute step.
4. **Prefer self-locating forms.** Use `Window` (find-the-call) over a fixed
   `Offset` wherever the target call is unique in its function; it should survive
   the next bump untouched. The patches still on fixed offsets (My 24 line spacing,
   and any other raw-byte edits) are the ones most likely to need a refresh.
5. **Verify.** Re-run the tester until `✓`; for self-locating conversions, confirm
   byte-identical output vs. the prior form; then `npm run test:patches` to
   regenerate `blacklist.json` and confirm it shrank.

Guardrails: edit only `patches/<short>/src/*.yaml`; never hand-edit
`blacklist.json` (generated); preserve each patch's `Enabled:`/`Description:`/
intent; if a fix is uncertain, leave it blacklisted and say why — a wrong patch can
brick a device.

---

## Removed: Allow rotation on all devices

This patch (on `develop`) forced screen rotation on devices Kobo doesn't officially
rotate. It was first repaired like the others, but it has a deeper problem a
byte-patch can't fix: forcing rotation rotates the **display** but not the
**touch-input coordinate transform**, so on devices like the Clara BW (`spaBW`) the
screen rotates while taps land in the wrong place. The fix belongs in the input
layer — `generic/libkevdevtouch.so`, whose `mapFromDevice` only ships rotation
mappers for `condor`/`monza` — and is better delivered as a standalone mod (like
NickelMenu/NickelClock) that can own the touch transform, not as a kobopatch patch.
So the patch was **removed** from the catalog and its metadata entry deleted.

Notes for that future mod: the Clara BW needs `(x,y) → (y, 1448 − x)` in landscape
(1448 = its long edge; the same pattern as `condor`=1872 / `monza`=1680), and the
handler also honors `QT_QPA_EVDEV_TOUCHSCREEN_PARAMETERS`, so an env-var route set
before nickel starts may avoid binary patching entirely.
