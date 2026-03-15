# WASM Feasibility — Confirmed

## Test Results

All kobopatch tests pass under both native and WASM targets.

### Native (`go test ./...`)
```
ok   github.com/pgaskin/kobopatch/kobopatch            0.003s
ok   github.com/pgaskin/kobopatch/patchfile/kobopatch   0.003s
ok   github.com/pgaskin/kobopatch/patchfile/patch32lsb  0.002s
ok   github.com/pgaskin/kobopatch/patchlib              0.796s
```

### WASM (`GOOS=js GOARCH=wasm`, run via Node.js)
```
ok   github.com/pgaskin/kobopatch/kobopatch            0.158s
ok   github.com/pgaskin/kobopatch/patchfile/kobopatch   0.162s
ok   github.com/pgaskin/kobopatch/patchfile/patch32lsb  0.133s
ok   github.com/pgaskin/kobopatch/patchlib              9.755s
```

### Notes

- `patchlib` tests are ~12x slower under WASM (9.7s vs 0.8s) — expected overhead
- All pure Go dependencies compile to WASM without issues
- No CGO, no OS-specific syscalls in the core libraries
- Go WASM executor: `$(go env GOROOT)/lib/wasm/go_js_wasm_exec`
- Node.js v25.8.1 used for WASM test execution

## What Works in WASM

- Binary patching (`patchlib`)
- ARM Thumb-2 instruction assembly (`patchlib/asm`)
- ELF symbol table parsing (`patchlib/syms`)
- YAML patch format parsing (`patchfile/kobopatch`)
- Binary patch format parsing (`patchfile/patch32lsb`)
- CSS parsing (`patchlib/css`)
- Zlib compression/decompression
- tar.gz reading/writing
- ZIP extraction

## What Won't Work in WASM (and doesn't need to)

- `os.Open` / `os.Create` — replace with in-memory I/O
- `os.Chdir` — not needed, use in-memory paths
- `exec.Command` (lrelease for translations) — skip, rare use case
- `ioutil.TempDir` — not needed with in-memory approach
