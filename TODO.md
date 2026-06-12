# TODO

## NickelMenu flow

### Audit should generate a parsable JSON manifest for informed removal

In addition to the human-readable install log, maintain a `kp-webui.json` file in `.kobopatch-webui` that records exactly what was written — the single source of truth for removal. Currently, removal detection is entirely heuristic (file paths, conf settings), which is fragile across version changes (e.g. a script path moving between releases).

Key design notes:

- **Overwrite on every install/reinstall.** The manifest always reflects the latest state, not an append-only log.
- **Best-effort.** Never block removal if the manifest is missing; fall back to the current heuristics.
- **Record actual paths written *at install time*, not the feature's current declarations.** This is the core value: if a script path moved between versions, the old path recorded in the manifest is what removal uses, so it still cleans up correctly.
- **Feature IDs** for the checklist UX, **files** for cleanup, **conf settings** (section/key/value) so reverts are precise.
- **The uninstaller's `removeOptionalEntry` already catches missing paths**, so a stale manifest entry (deleted file) is a safe no-op.

Rough shape:

```json
{
    "features": ["preset", "koreader"],
    "files": [
        { "path": ".adds/nm/webui-preset", "type": "file" },
        { "path": ".adds/nm/scripts/toggle_typography.sh", "type": "file" },
        { "path": ".adds/koreader", "type": "directory" }
    ],
    "conf": [
        { "section": "Reading", "key": "webkitTextRendering", "value": "optimizeLegibility" }
    ],
    "metadata": {
        "version": "1.15"
    }
}
```

### Offer alternative reading apps

Currently, KOReader is the only alternative reader app that's available to install.

I would like to expand this (see #11) with alternatives. The "KOReader" section should become "Reading Apps".

Add Plato (https://github.com/baskerville/plato) or Cadmus (https://github.com/OGKevin/cadmus) to "Reading Apps". These are mutually exclusive, so enabling one should automatically disable the other option. `excludes: ['cadmus']` is probably needed as part of the feature export for Plato (and vice-versa). It should be obvious in the UI that these are, in fact mutually exclusive w/ a label in red as soon as one is selected.

### Consider making the required preset optional

When the user selects "Install with preset", the default menu items and "Tweak" label + icon should be optional but checked by default. This should be easier to achieve now that the way the NickelMenu config file is generated, has changed.

## Custom patches

### Search feature

It currently isn't that easy to locate a specific patch if you know of one. A search field with live filtering would be very helpful here.

### Customizing patches

Some patches are intended to be modified. It should be possible to press an "Edit" button which opens an editor that lets you customize (and validate!) the patch. This should probably be some sort of pop-up or popover.

### Side effects

Set up side effects for certain patches. For example, in order to easily enable Google Drive/Dropbox support. For more information, see: 
https://github.com/nicoverbruggen/kobopatch-webui/issues/10

This is probably the most difficult one because it also needs additional testing.
