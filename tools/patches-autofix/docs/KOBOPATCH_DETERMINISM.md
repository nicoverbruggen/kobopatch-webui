# kobopatch extension: `Window` search for `ReplaceBytes`

This documents the local change to kobopatch carried by
`tools/kobopatch-wasm/kobopatch-determinism.patch` (applied on top of pinned ref `6189c54` by
`setup.sh`). It is written so the upstream author can assess correctness and
decide whether it's worth upstreaming.

## Problem

Many patches locate a call site as `Base` (a symbol) **plus a fixed `Offset`** to
the instruction, e.g.:

```yaml
- ReplaceBytes: {Base: "ReadingMenuView::updateReadingMenu()", Offset: 238,
    FindInstBLX: {SymPLT: "Device::hasOrientationSensor() const"}, ReplaceH: 4F F0 01 00}
```

`Base` already re-resolves per firmware, and `FindInstBLX` already recomputes the
PC-relative encoding per firmware — so the **only** firmware-version-specific
quantity left is the in-function `Offset`. When a firmware update changes the
function body before the call, that offset shifts and the patch fails, even
though the call it wants is unambiguous ("the BLX to `hasOrientationSensor` in
`updateReadingMenu`"). This is the cause of most of the breakage we had to repair
after a firmware bump.

## Change

A new optional field `Window` on `ReplaceBytes`. When set together with
`FindInstBLX` or `FindInstBW`, kobopatch **searches** `[Base+Offset,
Base+Offset+Window)` for the single position whose PC-relative encoding to the
resolved target matches, instead of requiring the call at an exact `Offset`:

```yaml
- ReplaceBytes: {Base: "ReadingMenuView::updateReadingMenu()", Window: 700,
    FindInstBLX: {SymPLT: "Device::hasOrientationSensor() const"}, ReplaceH: 4F F0 01 00}
```

Because a BLX/B.W encoding is position-dependent, the expected 4 bytes are
recomputed for every candidate position (`AsmBLX`/`AsmBW`), exactly as the
existing single-offset path does. The match must be **unique**: zero or more than
one match is an error, so a patch can never silently land on the wrong call.
`Offset` (default 0) is the start of the window, so callers can skip earlier
identical calls (e.g. "the third `operator==`" by starting the window past the
first two).

## Implementation

Two small pieces, both additive:

**`patchlib/patcher.go`** — a generic unique-instruction scan plus two typed
wrappers:

```go
func (p *Patcher) findInstUnique(base, window int32, asm func(pos uint32) []byte) (int32, error)
func (p *Patcher) FindInstBLXOffset(base, window int32, tgt uint32) (int32, error) // asm = AsmBLX
func (p *Patcher) FindInstBWOffset (base, window int32, tgt uint32) (int32, error) // asm = AsmBW
```

`findInstUnique` walks the window in 2-byte (Thumb) steps, compares the 4 bytes
at each position to `asm(pos)`, and returns the single match or an error
("no matching instruction found in window" / "found N matching instructions").

**`patchfile/kobopatch/patch.go`** — `ReplaceBytes` gains `Window *int32`. In
`ApplyTo`, when `Window != nil`, it resolves the `FindInstBLX`/`FindInstBW`
target, calls the matching `*Offset` finder, and sets `r.Offset = pos - cur`
**before** the existing find/replace expansion runs. Everything downstream
(including the PC-relative `ReplaceInstBLX`/`ReplaceInstBW` re-encoding) then uses
the located offset unchanged. It requires exactly one of `FindInstBLX`/
`FindInstBW` (the only position-dependent finds).

## Backward compatibility

`Window` is optional; patches that don't set it behave exactly as before. No
existing field changed meaning. The full upstream `patchlib`/`patchfile` test
suites pass unmodified, plus two new tests (`TestFindInstBLXOffset`,
`TestFindInstBWOffset`) covering the found / zero-match / ambiguous cases.

## Why it's safe (and how it was validated)

- **Unique-or-error**: ambiguity is a hard error, never a silent pick.
- **Equivalence**: for every patch we converted from `Offset:` to `Window:`, we
  applied both forms and compared the patched ELF **byte-for-byte** across 8
  firmware builds (4.45.23646/23684/23697 and 4.38.23429/23552/23648/23684/23697).
  Every pair is byte-identical — i.e. the search resolves to exactly the same call
  the hardcoded offset did, just without hardcoding it.
- **End-to-end**: the WASM integration test (real firmware → patched
  `KoboRoot.tgz`) passes with the rebuilt binary.

## Regenerating after a ref bump

`kobopatch-determinism.patch` is a plain `git diff` against ref `6189c54`. If you
bump `KOBOPATCH_REF`, re-apply and re-export it:

```bash
cd tools/kobopatch-wasm/kobopatch-src && git diff > ../kobopatch-determinism.patch
```

`setup.sh` applies it idempotently (skips if already applied, errors loudly if it
no longer applies cleanly).
