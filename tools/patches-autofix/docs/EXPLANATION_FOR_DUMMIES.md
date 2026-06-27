# Patches explained (plain English)

This is the no-jargon companion to the technical report. It explains, for each
patch we fixed, **how it used to find its spot in the firmware** vs. **how it
finds it now** — and why the new way keeps working when Kobo ships a firmware
update. It also explains, simply, the one change we made to the patching engine
(kobopatch).

## The core problem, in one analogy

A patch is "change the code at *this exact spot*." The spot used to be described
like a street address: **"the building called `updateReadingMenu`, then walk 238
bytes in."** The building name (`updateReadingMenu`) is stable — the firmware
tells us where it is. But "238 bytes in" is fragile: when Kobo rebuilds the
firmware, the building's interior gets rearranged and the thing we wanted is now
"240 bytes in," or "230 bytes in." The patch then edits the wrong spot, fails its
safety check, and gets blacklisted. **That's what broke these patches.**

The fix: stop counting bytes. Instead say **"the building called
`updateReadingMenu`, then find the one phone call to `hasOrientationSensor`
inside it."** The phone call is what we actually care about, and the firmware
always tells us its number — so we can find it no matter how the interior was
rearranged. We taught the engine to do this "find the call" search (see the last
section). If there's more than one matching call (ambiguous) or none, it refuses
rather than guessing.

Below, "old way = count bytes" and "new way = find the call."

---

## The patches

### Allow rotation on all devices
**What it does:** lets you rotate the screen on devices Kobo didn't enable it for.
**Old way:** three byte-counts to three calls (`forceAllowLandscape`+238 etc.).
**New way:** find-the-call for each. (One of them, `forceAllowLandscape`, calls
the same function ten times, so for that one we search just a short stretch near
the start to grab the first.) **Result is provably the same edit, but self-locating.**

### Allow showing info panel on random screensaver
**What it does:** shows the book info panel even with a random screensaver image.
**Old way:** byte-count to a call to `…setInfoPanelVisible`. It broke because Kobo
**renamed the class** that owns that function (on the newer line,
`FullScreenDragonPowerView` → `BookCoverDragonPowerView`).
**New way:** find-the-call to the correctly-named function (each firmware line
keeps its own name). No byte-counting.

### Hide browser from beta features
**What it does:** hides the built-in web browser from the beta menu.
**Old way:** two byte-counts to two `isParentalControlEnabled` calls.
**New way:** find-the-call for both. Each is the only such call in its function,
so it's unambiguous.

### Replace adobe page numbers toggle with invert screen
**What it does:** swaps a rarely-useful settings toggle for an "invert screen" one.
**Old way:** byte-counts to several `getShowAdobePageNumbers`/`setShow…` calls.
**New way:** find-the-call for each.

### Set KePub hyphenation
**What it does:** forces hyphenation on in Kobo (KePub) books.
**The tricky one.** The code asks three nearly-identical questions in a row:
"is the alignment `default`?", "is it `default`?", "is it `justify`?" We only want
the **`justify`** one. The old way byte-counted straight to it.
**New way:** we search a window that starts *after* the first two questions, so the
only "is it equal?" call it can find is the `justify` one. We confirmed by reading
the disassembly that the third call really compares against `"justify"` (the first
two compare `"default"`). If a future firmware ever moved the questions enough to
blur this, the patch **refuses rather than risk editing the wrong question.**

### My 24 line spacing values
**What it does:** replaces Kobo's line-spacing options with a custom set of 24.
**This one didn't switch to find-the-call** — it rewrites a table of numbers, not a
single call. The firmware bump only nudged a few internal "sanity-check" bytes,
which we updated. It's guarded so it can only apply if everything around it still
matches; otherwise it safely refuses. (This is the one we'd most want a quick
on-device sanity check on, since it's a big structural edit.)

### Disable forward/backward swipe gestures  &  Disable menu swipe gesture
**What they do:** turn off page-turn-by-swipe and the swipe-up menu.
**Old way:** matched the *raw bytes* of the page-turn / menu calls — which change
every firmware, so they broke.
**New way:** find-the-call to the four functions by name (`nextPageWithTimer`,
`prevPageWithTimer`, `openQuickAccess`, `openFooterMenuOnSwipe`) and blank them out.
Fully self-locating now on both firmware lines.

### Remove PDF map widget shown during panning
**What it does:** hides the little map overlay when panning/zooming a PDF.
**Old way:** hardcoded numeric jump-addresses (and a stale "this is broken" TODO).
**New way:** describes the jumps **by the function they point to** (`updatePanningMap`
→ redirect to `hideMapWidget`). There are two such jumps right next to each other,
so we point each at its own short search window.

### Customize ComfortLight settings
**What it does:** changes the bedtime/ComfortLight dropdown times.
**Old way:** a single hardcoded address to an unnamed helper function (no name to
anchor on), so it broke whenever the address moved.
**New way:** we search for the function's **fingerprint** — the exact 16 bytes it
starts with, which are unique in the whole library and identical across firmware.
The patch finds itself. (This used kobopatch's existing "find by bytes" feature,
`FindBaseAddressHex`.)

### Remove forgot pin button from lock screen
**What it does:** hides the "Forgot PIN → Sign Out" button on the lock screen
(that button factory-resets your Kobo, so it's nice to hide it).
**Old way:** it edited the **stylesheet** (CSS) to make the button invisible. The
problem: the lock screen's stylesheet is a **byte-for-byte duplicate** of the
*parental-control* PIN screen's stylesheet. The engine literally can't tell the two
apart by content, and they even swap order between firmware builds — so any
content-based approach risks hiding the button on the *wrong* screen.
**New way:** we stopped touching the stylesheet and patched the **code** instead.
The lock screen is built by a function called `Ui_PinCodeInputDialog::setupUi`,
which is *completely separate* from the parental-control screen's code — so there's
no ambiguity. Inside it, the two labels' text is set by two `setText` calls; we
swap each for a `hide()` call (a trick already used by another Kobo patch). The
labels get hidden directly, no matter how they're arranged. This finally makes
forgot-pin work the same on every firmware build, with **no special engine code.**

---

## What we changed inside kobopatch

Exactly one new capability, kept deliberately small:

**Before:** a patch could say *"edit the call at function + an exact byte count."*
**After:** a patch can instead say *"edit the one call to function X that lives
inside function Y"* — no byte count. We call the new knob `Window` (it's the
stretch of the function to look in). If there's exactly one such call, it's edited;
if there's none or several, the patch refuses (so it can never hit the wrong thing).

That's it. Everything else about kobopatch is unchanged, and any patch that
doesn't use `Window` behaves exactly as before. We proved the new way is identical
to the old way by patching **8 different firmware builds** both ways and checking
the results are byte-for-byte the same — then rebuilt the in-browser engine and
ran the full test suite.

**Why this matters going forward:** the next time Kobo ships a firmware update, the
patches that now "find the call" should keep working automatically, instead of
needing a person to re-count the bytes. The few that still rely on byte positions
(like *My 24 line spacing* and a couple of older raw-byte patches) are the ones
most likely to need a touch-up — and the `tools/patches-autofix/finder` helper
makes that a one-minute job.
