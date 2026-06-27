## Fix blacklisted kobopatch patches for a new firmware version

You are reverse-engineering Kobo firmware binaries (which I legitimately have cached
locally) to repair community `kobopatch` patches that stopped matching after a
firmware update. 

This is maintenance of an open-source tool for customizing
e-readers that the user owns. Fix as many blacklisted patches as you can; for any
you cannot fix with confidence, leave them blacklisted and explain why.

### Project layout you need

- **Patches (the YAML you edit):** `patches/<shortVersion>/src/*.yaml`
  (e.g. `patches/4.45/src/libnickel.so.1.0.0.yaml`). `<shortVersion>` is like `4.45`, `4.38`.
- **Blacklist (generated, do NOT hand-edit):** `patches/blacklist.json` — maps
  `shortVersion -> src yaml -> [failing patch names]`.
- **Which firmware versions map to which short version:** `tests/e2e/config/firmware-config.js`
  (`primary` = newest chipset line, `secondary` = older line). Each has `version`,
  `shortVersion`, `url`, `patchesSource`.
- **Cached firmware zips (~150 MB each, gitignored):**
  `tests/e2e/cached_assets/kobo-update-<version>.zip`. If a needed one is missing,
  download it from the `url` in the firmware config.
- **Native patch tester:** `tools/kobopatch-wasm/kobopatch` (prebuilt). Rebuild with
  `cd tools/kobopatch-wasm/kobopatch-src && go build -o ../kobopatch ./kobopatch`.
- **Config generator:** `tools/kobopatch-wasm/gen-kobopatch-config.mjs`.
- **Full regenerate / check scripts:** `npm run test:patches` (rewrites blacklist.json)
  and `npm run test:patches:check` (fails if out of date).

### Step 1 — Reproduce the failures (do this before changing anything)

For each firmware version under test, generate a config and run the tester. Work in a
scratch dir so you never dirty the repo. Example for one version:

```bash
SHORT=4.45; VER=4.45.23697   # from tests/e2e/config/firmware-config.js
ROOT=$(pwd)
FW="$ROOT/tests/e2e/cached_assets/kobo-update-$VER.zip"
WD=$(mktemp -d)
cp -r "$ROOT/patches/$SHORT/"* "$WD/"          # preserves the src/ subdir — required
node "$ROOT/tools/kobopatch-wasm/gen-kobopatch-config.mjs" \
  --source "$SHORT" --version "$VER" --in "$FW" > "$WD/kobopatch.yaml"
cd "$WD"
"$ROOT/tools/kobopatch-wasm/kobopatch" -t -f "$FW" kobopatch.yaml 2>&1 | tee test.log
```

Failing patches print `✕` and get a one-line reason under the `Errors:` section.
The reason tells you the failure class (see Step 3). Note the patch's `line N: inst K`
— that is the 0-based instruction index within that patch that failed.

### Step 2 — Extract the target binaries to disassemble

The patches target ELF files inside `KoboRoot.tgz` inside the firmware zip. Extract
the ones referenced by the failing patches (commonly `libnickel.so.1.0.0`,
`libadobe.so`, `librmsdk.so.1.0.0`, `nickel`):

```bash
BIN=$(mktemp -d); cd "$BIN"
unzip -o -q "$FW" KoboRoot.tgz
tar -xzf KoboRoot.tgz usr/local/Kobo/libnickel.so.1.0.0 usr/local/Kobo/libadobe.so
```

These are **32-bit ARM (armhf), little-endian, Thumb-2** shared objects. Use LLVM
`objdump` (already on this machine). Useful incantations:

```bash
B=usr/local/Kobo/libnickel.so.1.0.0
objdump -d --triple=armv7-linux-gnueabihf "$B" > nickel.asm   # full disasm (large)
objdump -T "$B" | grep -i 'someName'        # dynamic symbols (mangled C++)
# Disassemble one function by demangled name -> find its address first:
objdump -T "$B" | c++filt | grep -i 'FullScreenDragonPowerView::setInfoPanelVisible'
```

`kobopatch` resolves `BaseAddress: {Sym: "..."}` against the **mangled** symbol name,
so when a patch says `Sym: "_ZN..."` confirm that exact symbol still exists with
`objdump -T`. `SymPLT` resolves a PLT stub for an imported symbol.

### Step 3 — Diagnose and fix by failure class

Read the failing patch in `patches/<SHORT>/src/<file>.yaml`. A patch is a named list
of instructions: `BaseAddress` (an anchor: `Sym`, or `Sym`+offset), then
`ReplaceBytes` / `ReplaceInstBW` (BW = Thumb `B.W` branch) / `ReplaceInt` / `ReplaceString`
ops, each with a `Find...` and a `Replace...`. The fix depends on the error:

- **`no such symbol "..."` (ResolveSym / ResolveSymPLT):** the symbol was renamed or
  removed in the new firmware. Find the new name: `objdump -T "$B" | c++filt | grep`
  for the class and a distinctive method substring. Kobo sometimes renames internal
  classes (e.g. `FullScreenDragonPowerView` ↔ similar). Update the `Sym:`/`SymPLT:`
  to the new mangled symbol. If the feature was removed entirely, it cannot be fixed —
  keep it blacklisted and say so.

- **`could not find specified bytes` (no offset, i.e. a search/pattern op):** the byte
  pattern the patch searches for changed. Disassemble the relevant function, locate
  the logically-equivalent instruction sequence (the compiler re-encoded it or moved a
  register), and update `FindInstBW`/`FindBytes` to the new encoding. Keep the
  `Replace` semantically identical to the original intent (e.g. force a branch, NOP a
  call, flip a comparison).

- **`could not find specified bytes at offset` (Base+Offset op):** the anchor symbol
  still resolves but the instruction at `Offset` bytes past it changed — usually the
  function grew/shrank or an instruction was re-encoded. Disassemble from the symbol,
  walk to the intended instruction, and update both `Offset` and the `FindInst*`/`Find`
  bytes to match. Verify the surrounding context still matches the patch's stated intent
  (read the patch's comments/Description).

- **`ReplaceInt ... could not find` :** same as above but the find target is an integer
  immediate at a fixed offset. Confirm the immediate's new location/encoding.

**For PLT-branch patches (`FindInstBW`/`FindInstBLX` with `SymPLT`):** if a comment in
the patch mentions PLT parsing being broken for a binary (libadobe had a known
`TODO: figure out what broke the plt parsing in kobopatch for libadobe in 18730+`),
the fix may be to switch from a symbolic PLT reference to an explicit
`ReplaceInstBW: {Offset, FindInstBW, ReplaceInstBW}` with hand-computed branch
offsets, or vice-versa. Compute B.W offsets from the disassembly of the call sites.

### Step 4 — Iterate per patch

After each edit, re-run **only** the affected file to get fast feedback (re-run the
Step 1 block; it re-reads the YAML each time). A patch is fixed when it shows `✓`.
Make the smallest change that makes the patch apply correctly AND preserves its
original behavior — do not change what a patch does, only where/how it matches.

### Step 5 — Verify and regenerate the blacklist

When done, regenerate the committed blacklist and confirm it shrank:

```bash
npm run test:patches          # rewrites patches/blacklist.json from a clean test run
git diff patches/blacklist.json
```

Then `npm run test:patches:check` must pass (exit 0). Report: which patches you fixed
(with the before/after find bytes or symbol), which you left blacklisted and why, and
the net change to `patches/blacklist.json`. Do not mark a patch fixed unless it shows
`✓` against the real cached firmware.

### Guardrails

- Edit only `patches/<SHORT>/src/*.yaml`. Never hand-edit `patches/blacklist.json`
  (it is generated). Never touch the cached firmware zips.
- Preserve each patch's `Enabled:`, `Description:`, and intent. If unsure what a patch
  is supposed to do, read its comments and the surrounding disassembly before editing.
- If a fix is uncertain or speculative, leave the patch blacklisted and explain —
  a wrong patch can brick a user's device. Correctness over coverage.

---

## Notes captured from the 4.45.23697 / 4.38.23697 run (2026-06)

Failure classes seen, for reference:

- `libnickel.so.1.0.0.yaml: Allow showing info panel on random screensaver` —
  symbol gone: `FullScreenDragonPowerView::setInfoPanelVisible(bool)` (SymPLT).
- `Hide browser from beta features`, `Replace adobe page numbers toggle with invert screen`
  — `could not find specified bytes` (search-pattern drift).
- `Allow rotation on all devices`, `Set KePub hyphenation`, `My 24 line spacing values`
  — `could not find specified bytes at offset` (Base+Offset drift).
- `Customize ComfortLight settings` — `ReplaceInt: could not find specified bytes at offset`.
- `libadobe.so.yaml: Remove PDF map widget shown during panning` — `could not find
  specified bytes`; patch carries a known `TODO` about broken libadobe PLT parsing in
  18730+ and uses hand-coded `ReplaceInstBW` offsets that need re-deriving.
