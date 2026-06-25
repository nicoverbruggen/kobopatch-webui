# Own the patch prose in metadata (descriptions, notes, customization tips)

> ✅ Implemented. `PATCH_META` entries carry optional `description`/`note`/`tips`;
> the patch list prefers `meta.description` and renders the note + author, and the
> patch editor surfaces `tips` next to the value fields.

**Goal:** move all human-facing prose into the metadata layer too — a polished
description, an optional note, and customization tips/instructions. This makes
the `#` comments in the yaml files no longer relevant to the UI: today the
tuning instructions (e.g. "Part 2: change the font-size value here", multi-step
margin notes) live only as yaml comments that the webui never surfaces. Depends
on the [metadata layer](regroup-patches-by-theme.md).

Extends `PATCH_META` (same name key) with optional prose fields:

```js
'Custom synopsis font size': {
    category: 'home',
    label: 'Book-details synopsis font size',
    // Replaces the displayed blurb. Falls back to the yaml `Description:` when absent.
    description: 'Sets the font size of the synopsis text on the book details page.',
    // Short extra context (compatibility caveat, "no visible effect on X", etc.).
    note: 'Has no effect on sideloaded books without a synopsis.',
    // Instructions shown when customizing patch values in the editor. Markdown
    // or an array of steps — pick one and apply consistently.
    tips: [
        'Edit the `ReplaceString` value to your preferred size in px.',
        'Default is 30px; values below ~18px get cramped.',
    ],
},
```

Display rules: shown description = `meta.description ?? patch.description`
(the parsed yaml `Description:`); `note` renders under it; `tips` surface in the
**patch editor** (`patch-editor.js`, `openPatchEditor`) where a user actually
changes values — that's where the old yaml comments were useful.

## Tasks

- [x] Add `description` / `note` / `tips` to `PATCH_META` (incrementally — only
      where there's something worth saying; the validation script must NOT
      require them, unlike `category`).
- [x] Update `patch-list-view.js` to prefer `meta.description` over the parsed
      `patch.description`, and render `note`.
- [x] Update `patch-editor.js` to show `tips` alongside the value fields.
- [x] Migrate the worthwhile yaml-comment instructions into `tips` (one pass per
      file). Leave the comments in the yaml for upstream/maintainer reference —
      the point is only that the UI no longer needs them.

## Notes

- `description`/`note`/`tips` are all optional; `category` stays the only
  required field, so the existing validation gate is unchanged.
- Keep the yaml `Description:` field intact (it's a real kobopatch field and
  upstream content); metadata only overrides it for display.
