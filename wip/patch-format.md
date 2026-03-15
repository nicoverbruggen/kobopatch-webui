# Kobopatch Patch Format

## kobopatch.yaml (Main Config)

```yaml
version: 4.45.23646
in: src/kobo-update-4.45.23646.zip
out: out/KoboRoot.tgz
log: out/log.txt
patchFormat: kobopatch

patches:
  src/nickel.yaml: usr/local/Kobo/nickel
  src/nickel_custom.yaml: usr/local/Kobo/nickel
  src/libadobe.so.yaml: usr/local/Kobo/libadobe.so
  src/libnickel.so.1.0.0.yaml: usr/local/Kobo/libnickel.so.1.0.0
  src/librmsdk.so.1.0.0.yaml: usr/local/Kobo/librmsdk.so.1.0.0
  src/cloud_sync.yaml: usr/local/Kobo/libnickel.so.1.0.0

overrides:
  src/nickel.yaml:
    Patch Name Here: yes
    Another Patch: no
  src/libnickel.so.1.0.0.yaml:
    Some Other Patch: yes
```

The `overrides` section is what the web UI generates. Everything else stays fixed.

## Patch YAML Files

Each file contains one or more patches as top-level YAML keys:

```yaml
Patch Name:
  - Enabled: no
  - PatchGroup: Optional Group Name    # patches in same group are mutually exclusive
  - Description: |
      Multi-line description text.
      Can span multiple lines.
  - <patch instructions...>            # FindZlib, ReplaceBytes, etc. (opaque to UI)
```

### Fields the UI cares about

| Field | Required | Description |
|-------|----------|-------------|
| Name | yes | Top-level YAML key |
| Enabled | yes | `yes` or `no` - default state |
| Description | no | Human-readable description (single line or multi-line `\|` block) |
| PatchGroup | no | Mutual exclusion group - only one patch per group can be enabled |

### Patch Files and Their Targets

| File | Binary Target | Patch Count |
|------|--------------|-------------|
| nickel.yaml | nickel (main UI) | ~17 patches |
| nickel_custom.yaml | nickel | ~2 patches |
| libnickel.so.1.0.0.yaml | libnickel.so | ~50+ patches (largest) |
| libadobe.so.yaml | libadobe.so | 1 patch |
| librmsdk.so.1.0.0.yaml | librmsdk.so | ~10 patches |
| cloud_sync.yaml | libnickel.so | 1 patch |

## PatchGroup Rules

Patches with the same `PatchGroup` value within a file are mutually exclusive.
Only one can be enabled at a time. The UI should render these as radio buttons.

Example from libnickel.so.1.0.0.yaml:
- "My 10 line spacing values" (PatchGroup: Line spacing values alternatives)
- "My 24 line spacing values" (PatchGroup: Line spacing values alternatives)

## YAML Parsing Strategy

PHP doesn't have `yaml_parse` available on this system. Options:
1. Use a simple line-by-line parser that extracts only the fields we need
2. Install php-yaml extension
3. Use a pure PHP YAML library (e.g., Symfony YAML component)

The patch YAML structure is regular enough for a targeted parser:
- Top-level keys (no indentation, ending with `:`) are patch names
- `- Enabled: yes/no` on the next level
- `- Description: |` followed by indented text, or `- Description: single line`
- `- PatchGroup: group name`
- Everything else can be ignored
