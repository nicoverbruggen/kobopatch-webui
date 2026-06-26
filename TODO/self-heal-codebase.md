# Self-heal the codebase — consistent JS, well-organized CSS

## Goal

Whip `src/js` and `src/css` into shape: make the **JavaScript consistent** and
the **CSS well-organized**. This is a **cleanup/refactor pass, not a rewrite** —
behavior must not change. Same rendered UI, same DOM output, same network calls,
same analytics events, same downloads.

Do this in two independent passes (JS, then CSS) so changes stay reviewable.
Do **not** stage or commit anything — leave that to me.

## Tooling on this branch (`develop`) — use it, don't reinvent it

- **Prettier is the JS formatter** (`.prettierrc.json`: 4-space tabs, single
  quotes, `printWidth: 160`). Mechanical formatting — indentation, quotes,
  spacing, line wrapping — is **not** a manual job. Run `npm run format` and let
  Prettier handle it. Do not hand-tweak whitespace; focus your effort on
  *structural and semantic* consistency that a formatter can't fix.
- **ESLint** enforces correctness rules (`eqeqeq`, `no-var`, `no-undef`,
  `no-unused-vars`, `prefer-const`). Gate every change on `npm run lint`.
- **Vite** is the build tool. CSS is assembled via `@import` in
  `src/css/style.css`; `critical.css` is inlined at build time.
- **Prettier does NOT touch CSS** (it only globs `**/*.{js,mjs}`). All CSS
  organization is therefore manual and is the main substance of Pass 2.
- Respect `.prettierignore` / `eslint.config.mjs` ignores: never touch
  `src/js/wasm_exec.js`, `dist/`, vendored Go sources, etc.

## Hard constraints

- **No behavior changes.** Purely consistency and organization.
- **No new dependencies** and no new build/lint/format tooling.
- After each pass, all of these must pass:
  - `npm run format:check`
  - `npm run lint`
  - `npm run build`
  - `npm test`, `npm run test:unit`
- Touch only `src/js/**` and `src/css/**`. Do not modify `dist/`, `tools/`,
  `tests/`, `scripts/`, or config files.
- Prefer many small, self-explanatory edits over sweeping single-file rewrites.

## Established conventions (match these — do not invent new ones)

The structure already encodes strong conventions. The job is to make
**outliers conform**, not to redesign the conventions.

### JavaScript (`src/js`)
- ES modules (`"type": "module"`), **named exports**, no default exports.
- `const`/`let` only, `===`/`!==`, no `var` (ESLint enforces).
- Every module opens with a **JSDoc file header** explaining its role — see
  `src/js/app.js`, `src/js/flows/patches-flow.js`, `src/js/shell/dom.js` for the
  canonical format. Exported functions get a short JSDoc describing intent.
- The codebase is heavily **decomposed by domain**: `flows/`, `kobo/`,
  `nickelmenu/` (+ `nickelmenu/features/*`), `patches/`, `shell/`, `workers/`.
  New/relocated code belongs in the folder matching its domain.
- DOM access goes through the `$ / $q / $qa` helpers in `src/js/shell/dom.js` —
  flag raw `document.getElementById` / `querySelector` that should use them.
- User-facing strings go through the `TL` layer (`src/js/shell/strings.js`) —
  flag hardcoded user-facing text.
- Section dividers use the existing banner-comment style where present —
  keep it consistent.

### CSS (`src/css`)
- `critical.css` is the **single source of truth for `:root` design tokens**
  (inlined at build time). **Never** redefine tokens elsewhere — flag any that
  are.
- Layered into `base.css`, `components/`, `layout/`, `features/`. Each rule
  belongs in the layer matching its role.
- `src/css/style.css` is the `@import` manifest — keep it in sync with the
  actual file set (no orphaned or missing imports).
- Use existing `var(--token)` values for colors/spacing — flag hardcoded
  literals that duplicate an existing token.
- 4-space indentation, lowercase hex, one selector per line in grouped
  selectors. (Manual — Prettier won't do this for you.)

## Pass 1 — JavaScript consistency (`src/js`)

1. Run `npm run format` first to clear all mechanical noise, then `npm run lint`
   to surface correctness issues. Fix lint warnings/errors.
2. **Audit and report before structural edits.** Read every module under
   `src/js` (skip ignored/vendored files) and produce a concise findings list:
   - Missing/malformed file-header or function JSDoc.
   - Raw DOM access that should use `$ / $q / $qa`.
   - Hardcoded user-facing strings that should use `TL`.
   - Inconsistent naming (file names, exported symbols, local idioms) across
     sibling modules — especially within `flows/`, `kobo/`, `patches/`,
     `nickelmenu/features/`.
   - Dead code, unused exports/imports, duplicated helpers that could be shared.
   - Inconsistent import ordering/grouping.
3. **Then apply fixes**, smallest blast radius first. Don't change a public
   function signature unless every caller is updated in the same edit.
4. Confirm `npm run format:check`, `npm run lint`, `npm run build`,
   `npm test`, `npm run test:unit` all pass.

## Pass 2 — CSS organization (`src/css`)

1. **Audit and report before editing.** Map every rule to its file and check:
   - Rules in the wrong layer (`base` vs `components` vs `layout` vs
     `features`) — propose moves.
   - Duplicate / near-duplicate rules across files.
   - Hardcoded color/spacing literals that duplicate an existing `:root` token.
   - Token redefinitions outside `critical.css` (these are bugs).
   - Suspected **dead selectors** — cross-check class/id names against `src/js`
     and any HTML templates before deleting. When unsure, list as "suspected
     dead" rather than removing.
   - `@import` order/completeness in `style.css` vs the actual file set.
2. **Then apply fixes:** consolidate, move rules to the correct layer, replace
   duplicated literals with existing tokens, keep the `@import` manifest in sync.
   Only introduce a **new** token if replacing a literal that recurs 3+ times —
   and if you do, define it in `critical.css`.
3. Confirm `npm run build` succeeds and the built CSS is visually identical.
   Note (but don't run unless I ask) the screenshot/e2e checks
   (`npm run screenshots`, `npm run test:e2e`).

## Deliverable

For each pass, give me:
1. The **audit findings** (grouped, concise) — surfaced **before** editing.
2. The **changes made**, one-line rationale each.
3. Confirmation that **format:check + lint + build + tests pass**.
4. A short list of what you **intentionally left alone** and why (risky moves,
   ambiguous dead code, things that need my decision).

Pause for my review after each audit before large or structural changes
(file moves, deletions, shared-helper extraction).
