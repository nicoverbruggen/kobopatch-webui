# TODO

## NickelMenu flow

### Write an install manifest on every device write

Both the NickelMenu and custom-patches flows should record what was written to the device, so the next visit can offer re-apply or precise removal.

#### NickelMenu manifest (`nickelmenu.json`)

In addition to the human-readable audit log, maintain a `nickelmenu.json` file in `.kobopatch-webui` that records exactly what was written — the single source of truth for removal. Currently, removal detection is entirely heuristic (file paths, conf settings), which is fragile across version changes (e.g. a script path moving between releases).

The removal flow already has two detection modes for each feature — heuristic (scan files/conf on the device) and explicit (defined in the feature's own `detect`/`cleanup`). The manifest becomes a third detection source: when present, the removal flow reads `nickelmenu.json` to find which features were installed and their exact paths and conf settings, instead of scanning the device. The UI, checklist rendering, and user options are unchanged — only the underlying detection data is different.

Key design notes:

- **Overwrite on every install/reinstall.** The manifest always reflects the latest state, not an append-only log.
- **Record per feature**, keyed by feature ID, grouping the files and conf settings that feature wrote. This maps directly to the removal checklist: each feature becomes a checkbox row.
- **Best-effort.** Never block removal if the manifest is missing; fall back to the current heuristics.
- **Record actual paths written *at install time*, not the feature's current declarations.** This is the core value: if a script path moved between versions, the old path recorded in the manifest is what removal uses, so it still cleans up correctly.
- **The uninstaller's `removeOptionalEntry` already catches missing paths**, so a stale manifest entry (deleted file) is a safe no-op.

Rough shape:

```json
{
    "selected": ["preset", "better-typography", "koreader"],
    "features": {
        "preset": {
            "files": [
                { "path": ".adds/nm/webui-preset", "type": "file" }
            ]
        },
        "better-typography": {
            "files": [
                { "path": ".adds/nm/scripts/toggle_typography.sh", "type": "file" }
            ],
            "conf": [
                { "section": "Reading", "key": "webkitTextRendering", "value": "optimizeLegibility", "revertTo": "" }
            ]
        },
        "koreader": {
            "files": [
                { "path": ".adds/koreader", "type": "directory" }
            ]
        }
    },
    "meta": {
        "writer" : { 
            "name": "kobopatch-webui",
            "version": "2.0"
        },
        "installed": { 
            "timestamp": "2026-01-01 12:00:00",
            "firmware": "4.45.12345",
            "model": "N306"
        }
    }
}
```

`selected` records the user's configuration choices — the feature IDs that were active at install time. Re-apply reads this to pre-fill the feature checklist. `features` records the actual device impact per feature — the exact paths and conf settings written, used by the removal flow.

#### Custom patches manifest (`custom-patches.json`)

Write a `.kobopatch-webui/custom-patches.json` recording the patches that were applied and their configuration. When the same device is reconnected on a future visit, the app checks for this file and offers to re-apply the same selection — convenient when a new firmware release ships and the user wants to re-patch with the same set.

Key design notes:

- **Overwrite on every apply.** The manifest always reflects the last-applied set.
- **Record which patches were enabled/disabled** (the `overrides` map, matching `getOverrides()`), so the app can pre-select them on reconnect.
- **Snapshot the raw YAML block of any patch the user has edited** (e.g. changed `Find`/`Replace` pixel values in `Increase home screen cover size`), keyed by source file then patch name. Only the specific patch definition the user customized is stored — much more compact than entire YAML files.
- **Firmware version + device model prefix** so the app can detect when the manifest was written for a different device or firmware version and warn the user.
- **Best-effort.** Never block if the manifest is missing.

Rough shape:

```json
{
    "overrides": {
        "src/nickel.yaml": {
            "Increase home screen cover size": true,
            "My Words (OPDS) - Allow deleting books": true
        }
    },
    "customized": {
        "src/nickel.yaml": {
            "Increase home screen cover size": "`Patch name`:\n  - Enabled: no\n  - PatchGroup: Home screen layout tweaks\n  - Description: ...\n  - ReplaceZlibGroup:\n      Replacements:\n      - {Find: \"qproperty-leftMargin: 32px;\",  Replace: \"qproperty-leftMargin: 16px;\"}\n      # ..."
        }
    },
    "files": [
        { "path": ".kobo/KoboRoot.tgz", "type": "file" }
    ],
    "meta": {
        "writer": {
            "name": "kobopatch-webui",
            "version": "2.0"
        },
        "installed": {
            "timestamp": "2026-01-01 12:00:00",
            "firmware": "4.45.12345",
            "model": "N306"
        }
    }
}
```

On re-apply, the app loads the catalog YAML files, replaces each customized patch's YAML block with the stored version, applies the `overrides`, and passes the result to the WASM patcher. A patch absent from `customized` uses its catalog definition as-is.

### Update install logs

Install logs are currently named e.g. `log-26-06-12_12-42.log` and are directly stored in `.kobopatch-webui`. Put these in a subfolder, `logs`.

They should be: `26-06-12_12-42-install-nickelmenu.log`
            or: `26-06-12_12-42-remove-nickelmenu.log`
            or: `26-06-12_12-42-custom-patches.log`

Depending on the actual flow. Also, these logs should be appended to in real-time if that isn't the case already, just to make sure that the log is actually accurate (if a write fails somehow, this way we have a log that explains where everything stopped).

### Consider making the required preset optional

When the user selects "Install with preset", the default menu items and "Tweak" label + icon should be optional but checked by default. This should be easier to achieve now that the way the NickelMenu config file is generated, has changed.

## Custom patches

### Customizing patches

Some patches are intended to be modified. It should be possible to press an "Edit" button which opens an editor that lets you customize (and validate!) the patch. This should probably be some sort of pop-up or popover.

### Side effects

Set up side effects for certain patches. For example, in order to easily enable Google Drive/Dropbox support. For more information, see: 
https://github.com/nicoverbruggen/kobopatch-webui/issues/10

This is probably the most difficult one because it also needs additional testing.
