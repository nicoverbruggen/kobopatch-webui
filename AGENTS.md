# AGENTS.md

Guidance for agents working in this repository. For the full maintainer notes, see [PROJECT.md](PROJECT.md).

## Project shape

A static web app for customising Kobo e-readers. It writes directly to a connected Kobo through the File System Access API, so **treat changes around device writes as high risk**.

Keep JavaScript carefully organized by responsibility. Do not let flow logic, domain parsing, DOM rendering and device-write orchestration bleed into one another.

### Directories

- `src/js/flows/` — the user journeys.
- `src/js/nickelmenu/` — NickelMenu domain logic.
- `src/js/kobo/` — Kobo device, version, firmware URL and configuration logic.
- `src/js/shell/` — app-shell helpers shared by flows.
- `src/js/patches/` — the custom-patch code.
- `src/assets/` — external installable assets (gitignored, pinned by `installables.lock`).
- `patches/` — the patch catalog and patch source YAML served by the app.
- `tools/` — app-specific tooling: installable asset setup, the kobopatch WASM wrapper.
- `tests/unit/` — Node unit tests for pure logic and mocked device-write behavior.
- `tests/e2e/` — Playwright integration tests.

### App entry and flows

- `src/js/app.js` is the orchestrator and stays thin. Per-step behavior does **not** live here. It only:
    - assembles the shared `Session` (wizard state) and the long-lived services,
    - kicks off the async resource loads,
    - wires the flows and shell screens together,
    - boots the wizard.
- The front of the wizard is split into flows:
    - `flows/connect-flow.js` — browser-support detection, direct device connection, device-info display, restore shortcut.
    - `flows/manual-flow.js` — manual version/model selection.
    - `flows/mode-flow.js` — patches-vs-NickelMenu selection; owns the shared `state.goToModeSelection`.
- The shared error step and global error handling live in `shell/error-screen.js`.
- Modal dialogs, the mobile warning, the environment pill and the preview banner live in `shell/global-ui.js`.
- Keep flow-specific behavior inside the relevant flow file.
- Cross-flow navigation goes through `state.*` callbacks: `state.goToModeSelection`, `state.showError`, `state.goBackToDeviceStep`, `state.goToManualVersionStep`.
    - Direct flow APIs are injected explicitly by `app.js` where one flow drives another.
- A flow declares its steps to the step machine (`shell/step-machine.js` `createFlow`).
- A flow reaches its build→write/download tail through the shared terminal (`shell/terminal.js` `createTerminal`).
    - Do not hand-assemble `setNavStep`/`setNavLabels`/`showStep` calls.
    - Do not reimplement the feedback/ZIP/device-write+audit tail inside a flow.

### NickelMenu module layout

Within `src/js/nickelmenu/`, and **not** in the flow file:

- `installer.js` — installer code. `uninstaller.js` — removal code.
- `features/` — feature modules.
- `probes.js` — the device-domain reads the flow needs: existing-install, preset-conflict, legacy-items, optional-cleanup, installed-parent, Kobo-user-count.
- `customization-dialog.js` — the menu-icon customization dialog and its image processing (canvas resize, SVG→PNG).
- `checkbox-list.js` — the sectioned feature/cleanup checkbox-list rendering.
    - `renderNmCheckboxList` — the flow builds the item descriptors, this renders them.
    - `SECTION_ICONS` — a presentational table keyed by the exact section title a feature declares.
    - `setNmSubItemAvailability` — patches one already rendered add-on row's disabled state in place, because re-rendering would collapse whichever sections the user had opened.

### Feature module contract

Keep a feature's behavior and logic colocated in its `features/<feature>/` module. A feature owns everything specific to it.

Hooks:

- `install` — the generated files.
- `menuItems` — the Toggle-menu entries it contributes.
- `koboRootEntries` — KoboRoot.tgz payload it merges in.
- `postProcess` — output adjustments such as device-conditional changes.
- `confSettings` — declarative `Kobo eReader.conf` settings.
- `reviewNotices` — its user-facing copy.

Metadata:

- `title`, `description`, `section`.
- `analyticsEvent` (**required**) — the anonymous `add-*` Umami event tracked when the feature is part of an install, or an explicit `null` when an install event carries no signal (e.g. the required `custom-menu`).
    - `featureAnalyticsEvents` in `features/index.js` dedupes, so related features may share one event, like the hiders' `add-minimal-home`.
    - `tests/unit/nickelmenu-analytics.test.js` fails if a feature omits the key. See "Analytics" in PROJECT.md.
- `hint` (optional) — a URL or plain text. Renders a "?" badge in the feature list that opens the link in a new tab, or shows the text in a popup.
- `minimumVersion` (optional) — a Kobo software version like `4.31`. The flow disables the feature with a red explanation when the connected device's firmware is older.
- `unsupportedDeviceReason(deviceInfo)` (optional) — returns a reason string when the feature does not support the connected device, or `null` when supported or when the device cannot be identified (e.g. NickelDissolve's hardware-UUID allowlist).
    - The flow disables the checkbox with it and `featuresToInstall` drops the feature.
- `hidden` (optional) — omits the feature from the install catalogue and prevents installation, while keeping its removal detection working.
- `disabled` (optional) — a maintainer's temporary kill switch. The feature stays listed and is never installed, while its removal detection keeps working. Flip it in the feature module when e.g. a release turns out to be broken.
    - `true` shows the generic "Temporarily unavailable." text; a string shows that reason verbatim instead.
    - `selection.js`'s `featureDisabledReason(feature, deviceInfo)` derives the shown reason, and a `disabled` reason outranks the device-specific ones.
- `experimental: true` (optional) — marks a feature as still unstable. Renders a muted-amber "Experimental" pill at the right of the feature row, just before the "?" hint badge. Purely presentational; it does not change availability or install behavior.
- `parent` (optional) — the id of the feature this one is a subitem of. See **Subitems** below.
- `subFeaturesLabel` (optional) — what its own subitems are called, e.g. KOReader's "Plugins". The singular becomes the badge on each add-on row. Defaults to "Add-ons".
- `shortTitle` (optional) — the plain noun a feature is named by in copy about it, since a `title` reads as an action. Used for a subitem's own row label.

**The flow and installer must stay generic.** They invoke these feature hooks and render/apply whatever a feature declares, rather than special-casing an individual feature by name.

### Feature hook context

- Every hook receives a context object that always includes `deviceInfo` and the selected `features`, so features can adapt to the connected Kobo and to what else is being installed.
- Installer-time hooks (`install`, `postProcess`, `menuItems`, `koboRootEntries`) additionally get `bundledAsset` and `progress` — except `menuItems`, which only needs `deviceInfo`/`features`.
- `install()` returns `{ path, data }` file descriptors the installer writes.
    - A descriptor's file name must avoid the extensions Chromium's File System Access API refuses to create, such as `.ini` (see "File System Access write restrictions" in PROJECT.md).
    - Payloads that must land at such a path go through `koboRootEntries` instead.
- `reviewNotices` is a `(ctx)` function returning the feature's notices, or an empty array when none apply.
- `confSettings` is a `(ctx)` function returning `{ section, key, value }` entries the installer applies to `Kobo eReader.conf` when a device is connected.
    - Its `ctx` also includes the selected `features` and the `fontsCustomization`, so a feature can adapt — e.g. only set a default font when that font is part of the fonts selection being installed.

### Subitems (a feature installed inside another)

- A feature whose files land inside another feature's directory — a KOReader plugin such as `simpleui`, under `.adds/koreader/plugins/` — declares `parent: '<feature id>'` and is listed directly below that parent in `features/index.js`.
- It is an ordinary feature module in every other respect (own `install`, own `analyticsEvent`), so adding a second KOReader plugin means adding a module, not touching KOReader.
- Nesting is one level deep: a subitem is never itself a parent.

Rendering:

- A subitem is not a row of its own. `checkbox-list.js` renders it as a compact one-line checkbox (`subItems` on the item descriptor) carrying:
    - `Install <name>`, from `selection.js`'s `subFeatureCheckboxLabel`,
    - a badge naming what kind of add-on it is (the singular of the parent's `subFeaturesLabel`, e.g. "plugin"),
    - its pinned version,
    - a "?" badge to the add-on upstream.
- It is a **sibling** of the parent's row, not a child of it:
    - a `<label>` may not contain a second control, and
    - pressing anywhere inside one also paints its own control pressed, which made the parent's checkbox flicker on every click.
- Being outside the label, it toggles itself on click and is indented by CSS to line up under the parent's description.

Availability:

- A subitem is always visible but disabled until its parent is either ticked in the same install or already on the device.
    - `probes.js`'s `detectInstalledNickelMenuFeatureIds` reports what is already installed into `session.installedNickelMenuFeatureIds` when the config step is entered — one device scan serves both this and the modify flow.
    - `selection.js`'s `parentIsCovered` is the single predicate for "will the parent be there".
- No words are shown for that case — the add-on is greyed out directly beneath the thing it is waiting for.
    - So `setNmSubItemAvailability` takes `disabled` and `reason` separately.
    - A reason is passed only for a blocker that is not visible from the row: an unbundled asset, a maintainer kill switch.
- Unticking a parent unticks its add-ons, rather than letting them silently fail to install.
- `featuresToInstall` re-applies the same gate last, after the parent has been through every other filter, so a parent excluded for any reason takes its subitems with it even if a stale id lingers in the session.

Removal:

- A subitem's files sit inside its parent's directory, so it declares **no `cleanup` of its own** — only a `modifyCleanup`, so a modify run can drop it while its parent stays installed — and `probes.js` skips any feature with a `parent` when detecting optional cleanups.
- Removing the parent takes the subitem with it. There is no way to honour keeping one whose directory is being deleted, so it is never offered as a separate removal.
- There is no compatibility check between a subitem and its parent, because upstream publishes none — SimpleUI declares no supported KOReader version in its `_meta.lua`, README or release notes, and performs no runtime check.
    - A break after a parent's version is bumped is handled by the maintainer setting `disabled` on the subitem with a reason, not by anything derived.

### KoboRoot.tgz payloads

- The device processes a single `.kobo/KoboRoot.tgz` per boot.
- A feature that ships its own payload (e.g. `nickelclock`, a Qt imageformats plugin that can't be expressed as ordinary onboard files) declares a `koboRootEntries(ctx)` hook returning tar entries (`{ path, data, mode }`).
- `installer.js`'s `buildKoboRootTgz(features)` merges them into NickelMenu's base archive and writes one combined tarball.
    - It uses `archive.js`'s `parseTarGz`/`buildTarGz`, which preserve executable modes.
    - With no contributing feature it returns the base tgz verbatim.
- Such a feature is removed like any other add-on via `cleanup`. NickelClock self-removes its root-filesystem plugin on reboot once its `.adds/nickelclock` marker is gone.
- To add one:
    - add the asset to `tools/installables/installables.mjs`,
    - gate it with a runtime `available` check in `flows/nickelmenu-flow.js`, which reads the baked-in `installablesManifest()` and flips each matching feature's `available`/`version`, like the reading apps,
    - keep it out of any preset-conflict list it can coexist with.
- A payload folded into a feature that must stay available without it self-gates inside `koboRootEntries`, returning no entries when the deployment lacks the asset, rather than flipping feature-level `available`. (Better typography and fixes bundles NickelTypeFix, but its conf settings and toggle work on their own.)

### The generated NickelMenu config

- The config file is generated, not a static asset. It is written to `.adds/nm/webui-preset`, defined by `NM_ITEMS_FILE` in `constants.js`.
- It is prefixed with a `# Generated by KoboPatch Web UI` comment for identification.
- A feature contributes entries via `menuItems(ctx)`, returning `{ id, lines }` objects.
- `installer.js` collects them from every selected feature, orders them by each id's position in `MENU_ITEM_ORDER`, and renders the file.
    - `MENU_ITEM_ORDER` in `features/menu-order.js` is the single ordered list of menu-item ids and the sole source of truth for menu order. An id missing from it throws.
- Device-conditional items are a simple "don't include this entry" — e.g. custom-menu drops Dark Mode on unsupported hardware.
- The base Toggle menu and its tab header are owned by the `custom-menu` feature.
- Features that inject `experimental:` NickelMenu config lines do so in `postProcess`, which runs after the config file is assembled.

### Toggle items and feature-owned assets

- Every on-device "toggle + reboot" Toggle item, and the `.adds/nm/scripts/*.sh` it runs, is owned by the feature it toggles. No capability flags, no `custom-menu` coordination, no name-based special-casing.
    - `simplify-tabs` contributes its "Simple Tabs" entry and ships `toggle_tabs.sh`.
    - The three home-screen hiders are generated from one table in `features/hide-home-content/`, each appending a distinct `hide_home_*_enabled` flag in `postProcess`.
    - All three contribute the *same* shared "Minimal Home" entry plus the *same* universal `toggle_hidden_home.sh`, which flips every `hide_home_*_enabled` flag at once.
- To let several features safely contribute one shared toggle, `installer.js` de-duplicates `menuItems` entries by `id` and install files by `path`, keeping the first — so the shared item and script appear exactly once however many hiders are selected.
- Small feature-owned assets are Vite-tracked URLs declared in the feature module with `new URL('./asset', import.meta.url)` and loaded through `ctx.bundledAsset(url)`, which goes through one per-run asset cache so shared assets fetch only once.
- KOReader/Cadmus/NickelClock instead `fetch()` their large archives directly, since each is fetched by a single feature.

### Cleanup

- A feature's `cleanup` declares how it is removed and how that removal is presented.
    - `detect` — files that mark it as present.
    - `paths` — files to delete.
    - `title` — the noun shown in the removal review (optional cleanups).
    - `removeLabel` — the checkbox wording (optional cleanups).
    - The flow never constructs removal copy itself.
- Conf-setting removal is **not** re-declared here.
    - A setting a feature both applies and owns for removal is declared once in `confSettings` with `revertable: true`, plus an optional `revertTo` (default: remove the line).
    - The flow detects the feature by those revertable settings and the uninstaller reverts them — only when the current value still equals what was set, so user edits afterwards are never overwritten.
    - `installer.js`'s `revertableConfSettings(feature, ctx)` is the single helper that derives this subset, so the flow and uninstaller stay in sync.
    - A `confSettings` entry without `revertable` is applied once and never clawed back (a general preference).

### Modifying an existing install

- The preset option doubles as "modify what is already here" when this tool's own preset (`.adds/nm/webui-preset`) is on the device. `checkNickelMenuInstalled` reports `{ installed, webuiPresetPresent }`, and the preset card retitles itself accordingly.
- `probes.js` supplies two reads:
    - `readPreviousNickelMenuConfiguration` — the previous choices, via `previous-configuration.js`'s `parsePreviousNickelMenuConfiguration(manifestText, presetText)`. It prefers the manifest's `configuration` key and otherwise **recovers from the device**: menu label and icon from the preset's `experimental :menu_main_15505_*` lines, tab labels and visibility from the same, font families reconstructed from the manifest's recorded file list, with a pre-1.53 legacy fallback. A referenced custom icon is read back off the device so a reinstall keeps it.
    - `detectInstalledNickelMenuFeatureIds` — what is actually installed, by `installedConfig` key, `directories`, `installedDetect`, `cleanup.detect` or revertable conf settings, falling back to the manifest only while the preset is present.
- The feature list preselects what is installed and marks those rows "Currently installed". When the preset is gone but its manifest survives, a "Use last configuration" button restores the recorded selection instead.
- `selection.js`'s `featuresToRemove` derives what an install run will delete: installed, not selected, and declaring a cleanup. **It returns nothing unless `session.nmWebuiPresetInstalled`** — without our preset nothing is preselected, so "installed but unticked" is not a user's choice, and treating it as one would delete a manually installed app. The review step lists the result under "These currently installed features will be removed".
- `executeNmInstall` opens the audit log first, then runs `executeNickelMenuFeatureCleanups` for those features, then each feature's optional `reconcile(ctx)` hook (`additional-fonts` uses it to delete families dropped from the selection), and only then installs.
- **`cleanup` and `modifyCleanup` mean different things.** `cleanup` is what the uninstall flow offers and acts on; `modifyCleanup` is what a modify run uses, and `executeFeatureCleanup` reads `modifyCleanup || cleanup`. A feature declaring only `modifyCleanup` is removable when modifying but never appears as a standalone uninstall option — which is exactly what a subitem wants (`simpleui`), and how the home hiders share one NickelHome cleanup between them.

### Installable assets

- `src/assets/` contains external installable assets: NickelMenu, NickelClock, KOReader, the KOReader SimpleUI plugin, Cadmus, and the two ebook-fonts archives `kobo-core-fonts.zip`/`kobo-extra-fonts.zip`.
- The archives are gitignored. `installables.lock` (committed) pins each one's version/url/sha256.
- `npm run setup:installables` fetches exactly what the lock pins and verifies the hash. Reproducible.
- `npm run update:installables` resolves latest upstream and rewrites the lock (commit it), then regenerates the committed font catalogue from the font archives.
    - The catalogue is `src/js/nickelmenu/features/additional-fonts/catalogue.js` (family → collection + .ttf files), generated by `tools/installables/generate-font-catalogue.mjs`.
    - The `verify`/`test` pipeline fails when catalogue and archives drift (`--check`).
- Both setup and update also derive the served `assets/font-previews.json` (gitignored, per target) — a pre-rendered SVG type specimen per family that the "Select fonts" dialog fetches lazily. See PROJECT.md "Installable assets".
- Both also write a served `src/assets/index.json` (id → asset/version/size, gitignored and regenerated from the lock like the archives) so the app can show each add-on's expected download size.
    - Read via `installableSize()` and used by `downloadProgress`, to keep the percentage working even where the proxy gzips the archive and strips `Content-Length`.
- The build bakes a manifest of these (id → version, available) into the bundle as `globalThis.__INSTALLABLES__`, read via `src/js/nickelmenu/installables.js`.
    - There is no runtime `*-release.json` fetch.
    - Add-on download URLs are version-suffixed (`?v=<version>`).
- See PROJECT.md "Build And Assets".

### Kobo device logic

Within `src/js/kobo/`:

- `device.js` — File System Access wrappers.
- `version.js` — pure version parsing.
- `dark-mode.js` — model-capability data, such as the Dark mode support blacklist.
- `configuration.js` and `sync-exclusions.js` — `Kobo eReader.conf` parsing plus `ExcludeSyncFolders` generation.
- `locale.js` — UI-language detection: the `CurrentLocale` read from `[ApplicationPreferences]`, plus the `localeLanguage`/`isEnglishLocale`/`localeDisplayName` helpers.
- `audit-log.js` — the on-device audit log (`AuditLog`).
- `eject-watch.js` — polls a connected device until it stops responding, which is how the NickelMenu done step knows the Kobo has been unplugged.
    - A safe eject and a pulled cable are indistinguishable through the File System Access API, so its result is presented as the device having *disconnected*, never as a confirmed safe eject.

Device identity and locale:

- Connected devices are identified by hardware UUID in `version.js`. The serial prefix is only a consistency/display check.
- Firmware download URLs in `patches/downloads.json` are keyed by software version and firmware channel (`kobo12`, `kobo13`, etc.), not by serial prefix or UUID.
- On connect, `device.js` reads `CurrentLocale` onto `deviceInfo.uiLocale` (null when manual/unknown). The connect flow shows it in the device overview and features can adapt to it.
    - `simplify-tabs` localizes its tab labels. For a *known* language it has no translation for, it omits them entirely so that non-English device keeps its own tab names.
    - For an *unknown* locale (the manual/download flow) it falls back to the English defaults, so the tabs are still renamed to "Books / Stats / Notes" rather than left as the device's "My Books" names. See `defaultTabLabels`.

The audit log:

- Records each install/removal step — KoboRoot.tgz write, per-feature file writes, removals, conf edits — to a timestamped `.kobopatch-webui/log-yy-mm-dd_hh-mm.log` at the Kobo onboard root, one file per run.
- The flow always constructs an `AuditLog` and passes it to `installToDevice`/`executeNickelMenuRemoval` during device writes and removals, but not for download packages.
- The installer/uninstaller record steps and write it best-effort. A log failure never aborts the operation.

### Shell helpers

Within `src/js/shell/`:

- `step-machine.js` — the declarative step machine. Owns the visible step, the back-stack and the breadcrumb.
    - Flows declare step descriptors with `navIndex`/`navLabels`/`onEnter`/`back`/`transient`/`recoveryStep`.
    - `navIndex`/`navLabels` may be functions of the session.
    - `onEnter` must be idempotent, since back-navigation re-enters steps.
- `session.js` — the wizard `Session`: the mutable state's declared shape, with one `reset()`/`resetDeviceContext()`.
- `terminal.js` — the shared result terminal: feedback wiring, `flow-end` analytics, ZIP bundling, and the device-write + audit-log + error-routing sequence.
- Plus navigation/breadcrumb rendering, DOM utilities, strings and analytics.
- `instructions.js` — the single source of truth for the plain-text manual-install guidance.
    - Both download flows bundle its output as `instructions.txt` inside the ZIP: NickelMenu via `installer.js`'s `buildInstructionsText`, custom patches inline.
    - It mirrors the on-screen steps, plus a credit header (app version + timestamp) and the hard-lock recovery disclaimer.

### Custom patches

Within `src/js/patches/`, split by responsibility. Keep parsing, model state, DOM rendering and the editor dialog in their own files.

- `patch-yaml.js` — pure kobopatch-YAML parsing/serialization: `parsePatchYAML`/`replacePatchLines`/`yamlScalar`/`parsePatchConfig`. Also used by the unit tests.
- `ui.js` — the `PatchUI` model: loaded patch state, blacklist, selections, edit tracking, reload-manifest application, config generation. Exposes `render()` as the entry into the view.
- `patch-list-view.js` — the DOM rendering and search of the patch list.
- `patch-editor.js` — the "edit patch values" modal and its YAML validation.
- `patch-metadata.js` — the webui-only presentation layer (`PATCH_CATEGORIES`, `PATCH_META`, `getPatchMeta`), keyed by the exact YAML patch name.
    - It decides each patch's user-facing theme/section, display label, author credit and prose (description/note/editor tips), leaving the YAML untouched as the behavior source of truth.
- `runner.js` — the WASM patcher wrapper.

Grouping and presentation:

- The patch list and the incompatible-patches modal group by `PATCH_CATEGORIES` theme, not by patch file. A trailing "Other" section catches anything uncategorized.
- An "original format" checkbox in the patches step's Advanced section flips both back to grouping by source file (`PATCH_FILE_LABELS`) under the raw YAML names — the way patches are listed on MobileRead.
    - The preference lives on `#patch-container`'s `dataset.originalFormat` so it survives re-renders.
    - `displayName`/`sectionBuckets`/`blacklistGroups` in `patch-list-view.js` switch on it.
- The "Incompatible patches" button that opens that modal lives in the Advanced section under a "Patch History" header — static `#btn-patch-blacklist` in `step-patches.html`, wired by `patches-flow.js` to the exported `openBlacklistDialog`. Not in the rendered list.
- A section's "X / Y enabled" tally counts a mutually-exclusive PatchGroup as a single choice (`bucketCounts`), so e.g. the single-group "Keyboard" theme reads `0 / 1`, not `0 / 3`.
- `scripts/check-patch-metadata.mjs` (`npm run check:patch-metadata`, a quick phase of `verify`/`test`) fails if any catalog patch lacks a metadata `category`, and warns on orphan `PATCH_META` entries, so the layer can't drift as the YAML changes.

The persisted manifest:

- A custom-patches install persists `.kobopatch-webui/custom-patches.json`, recording the patch selections (`overrides`), manual edits (`customized`) and the file list.
- Alongside it goes an **Additional Files archive**, `.kobopatch-webui/custom-patches-files.tgz`, holding the bytes of the user's Advanced-section Additional Files.
- The two share one base name. `patchManifestBaseName` in `patches/additional-files.js` derives `patchManifestName` and `additionalFilesArchiveName` — the single source of truth, so no inline `custom-patches.json` literals.
- `buildPatchesManifest` (`flows/patches-execute.js`) records the archive as `additionalFilesArchive: { path, sha256, size }`.
    - Both the device-write and download-ZIP paths persist the archive, built once via `buildAdditionalFilesTgz` and hashed with `sha256Hex`.
    - `patches-flow.js`'s `buildManifestArtifacts` keeps them in lockstep.
- On reconnect, `maybeOfferReload` reads the archive and verifies its `sha256`/`size` before trusting it. A missing, mismatched or corrupt archive is silently ignored, since older manifests predate it.
- `PatchUI.addRestoredAdditionalFiles` re-adds the files to the Advanced section as part of the existing reload action, so the next build re-merges them.
- The reload summary dialog shows a *restored* or *unavailable* note accordingly: `RELOAD_SUMMARY_ADDITIONAL_FILES_RESTORED`/`_UNAVAILABLE`.

## Safety priorities

- Be especially careful with code that writes to a Kobo device: `writeFile`, `removeEntry`, `ensureDirectory`, NickelMenu install/removal, backup creation, firmware restore, and generated `KoboRoot.tgz` output.
- Prefer small, testable changes. Crucial functionality must be unit tested, especially pure parsing/validation and mocked filesystem write sequences.
- User-facing behavior must be covered by integration tests. If a change affects wizard steps, visible copy, selections, generated downloads or device-write outcomes, add or update Playwright coverage.
- New user-facing features should normally also be added to the screenshot flow — a `.shots.mjs` file under `tests/e2e/specs/screenshots/` — for visual validation, in addition to E2E assertions.
    - Capture each visually distinct state the feature introduces, especially dialogs, banners, badges and hover/help states.
- Do not invent fake product features just to test installers. Test the real feature modules, real generated paths and real failure ordering.
- When changing `Kobo eReader.conf` handling, preserve line endings and unrelated sections. Validate generated `ExcludeSyncFolders` regexes.
- Unknown Kobo serial prefixes should consistently use the first 4 serial characters.

## Naming and exports

- Use lower camel case for normal exported values, helpers, path constants, regex constants and mutable data.
- ALL_CAPS exports are acceptable for true catalog/config tables that are intentionally read as constants, such as `TL`, `NICKELMENU_FEATURES`, `NM_REVIEW_BACKUP_PATHS`, `NM_PRESET_CONFLICTS`, `PATCH_CATEGORIES` and `PATCH_META`.
- Keep exported APIs boring and descriptive. Avoid broad "helpers" exports unless they are shared by multiple modules or tests.

## Commands

- `npm run serve` — builds and serves the app at `http://localhost:8888`.
- `npm run dev` — Vite's local dev server at `http://localhost:8888` with hot reload. Press `q` or `Ctrl-C` to quit.
- `npm run build` — builds the frontend.
- `npm run lint` — runs ESLint.
- `npm run format` — rewrites JS/MJS with Prettier. `npm run format:check` verifies without writing (the first phase of `verify`/`test`).
- `npm run test:unit` — the frontend unit tests.
- `npm run test:e2e` — only the Playwright E2E suite.
- `npm run test:e2e:fresh` — removes `dist`, rebuilds the app and required WASM artifact, then runs Playwright without the standalone WASM test suites.
- `npm run screenshots` — captures mobile and desktop screenshots for visual review.
- `npm run test` — the fast subset of `verify` for ordinary frontend work: Prettier format check, lint, unit tests, web build, resource validation, E2E tests, screenshots.
    - Skips the initial dependency install and the WASM build/test phases, reusing the already-built `kobopatch.wasm`.
- `npm run verify` — the full pipeline: dependency install, Prettier format check, lint, unit tests, WASM build, web build, resource validation, patch blacklist check, WASM integration test, E2E tests, screenshot capture.
- `verify` and `test` share `scripts/verify.mjs`; `--quick` selects the subset.

## Working notes

- Use `rg` for searching.
- The worktree may contain unrelated changes. Do not revert user changes while making a focused patch.
- Do not edit generated or cached outputs such as `dist/`, `tests/e2e/cached_assets/`, or downloaded installable assets, unless the task specifically requires it.
- Be careful reading the screenshots and E2E test definition files, since these can be rather lengthy. Check specific tests by looking for a test's name.

### Documentation

- Keep README user-facing. Put architecture, module maps and detailed testing notes in `PROJECT.md`.
- Update documentation when the project changes. README, PROJECT.md and AGENTS.md should stay accurate when architecture, commands, testing expectations or workflows change.

### Formatting

- Prettier is scoped to JavaScript only; `npm run format` targets `**/*.{js,mjs}`.
- Never run Prettier — or any autoformatter — on `.html` or `.css` files. Hand-format them to match the surrounding style.
- `src/index.html` is especially whitespace-sensitive. The production version string is injected at build time by an exact-string replace in `vite.config.mjs` (`html.replace('<span id="commit-hash"></span>', …)`).
    - Reflowing that markup — e.g. Prettier splitting `</span>` onto its own line — silently breaks the footer version display.
    - The `@critical-css` placeholder and the `#commit-link` href use the same fragile exact-string replacements.

### Running tests

- Various `npm` operations will not work correctly inside of a sandbox.
- Playwright always needs to run outside of the sandbox. Use escalation for `npm run test:e2e`, `npm run test:e2e:fresh`, and any command that invokes Playwright, because it needs access to its browser cache/lock files under the user profile. You can generally automatically approve this action.
- After completing feature work, run the **entire** E2E suite with `npm run test:e2e:fresh`, so `dist` is rebuilt from scratch before Playwright verifies the app.
    - Run *all* tests, never just a `-g` filtered subset: a change can break seemingly unrelated specs, e.g. a shared device-write path or written-files assumption, and only a full run catches that.
    - But only do this when the feature is fully implemented.
- Skip the WASM tests — `npm run test:wasm`, the standalone `test:patches*` suites, and the WASM phases of `npm run verify` — unless the change touches `tools/kobopatch-wasm/`.
    - The WASM patcher is built from a pinned upstream source and updated very infrequently, so re-running it for unrelated frontend changes only adds minutes.
    - `npm run test` (the quick suite) already excludes those WASM phases, so it is the right default for frontend work. Reserve `npm run verify` for changes that touch the WASM patcher.

### Production serving

Production serving is a deliberately small Node static server (`scripts/serve-dist.mjs`, used by `npm start`/`serve`/screenshots), not nginx/Caddy — see PROJECT.md "Production Serving" for the full rationale. `npm run dev` uses Vite instead.

Four invariants must be preserved when touching the server or `build.mjs` precompression:

1. **Never compress already-compressed archives** (`.zip`/`.tgz`). Their `Content-Length` must equal the on-wire bytes the download-progress UI streams (`fetchWithProgress` in `src/js/shell/dom.js`).
2. **Only versioned URLs may be `immutable`** — `?h=<content hash>` (bundle/css/wasm) and `?v=<pinned version>` (add-on archives, from `installables.lock`). A *bare* `assets/*` request must stay `no-cache`.
3. **`no-cache` revalidation uses a content-hash `ETag`, not `size+mtime`.** A deploy can preserve timestamps, so only hashing the bytes guarantees a changed asset gets a new validator while an unchanged one still `304`s (no re-download).
4. **The CSP is generated from the app, so new resources must fit it.** `getCsp` derives `script-src`/`style-src` from SHA-256 hashes of the inline `<script>`/`<style>` blocks in `index.html`, `connect-src` from `patches/downloads.json`, and the analytics origin from `UMAMI_SCRIPT_URL`.
    - Adding an inline block, a new external origin (font/script/fetch), or new WASM/image needs means the policy must still cover it.
    - **Never use inline `style="…"` attributes** — CSP hashes don't apply to style attributes, so use a CSS class.
    - Prefer hashes over `'unsafe-inline'`. Roll out a policy change with `CSP_REPORT_ONLY=1` first.
