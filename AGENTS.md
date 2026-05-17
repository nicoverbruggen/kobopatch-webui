# AGENTS.md

Guidance for agents working in this repository. For the full maintainer notes, see [PROJECT.md](PROJECT.md).

## Project shape

- This is a static web app for customising Kobo e-readers. It can write directly to a connected Kobo through the File System Access API, so changes around device writes should be treated as high risk.
- `src/js/app.js` is the orchestrator. It owns shared state, device connection, mode selection, error recovery, and dialogs.
- `src/js/flows/` contains the user journeys. Keep flow-specific behavior inside the relevant flow file.
- `src/js/nickelmenu/` contains NickelMenu domain logic. Installer code belongs in `installer.js`, removal code belongs in `uninstaller.js`, and feature modules belong in `features/`.
- `src/assets/` contains external installable assets such as NickelMenu, KOReader, and Readerly archives.
- `src/js/kobo/` contains Kobo device/version/firmware URL/configuration logic. Keep File System Access wrappers in `device.js`, pure version parsing in `version.js`, and `Kobo eReader.conf` parsing plus `ExcludeSyncFolders` generation in `configuration.js` and `sync-exclusions.js`.
- `src/js/shell/` contains app-shell helpers shared by flows, such as DOM utilities, navigation, strings, and analytics.
- `src/js/patches/` contains custom patch UI and runner code.
- `tests/e2e/` contains Playwright integration tests. `tests/unit/` contains Node unit tests for pure logic and mocked device-write behavior.
- `patches/` contains the patch catalog and patch source YAML files served by the app.
- `tools/` contains app-specific tooling such as installable asset setup and the kobopatch WASM wrapper.
- Keep JavaScript carefully organized by responsibility. Avoid letting flow logic, domain parsing, DOM rendering, and device-write orchestration bleed into one another.

## Safety priorities

- Be especially careful with code that writes to a Kobo device: `writeFile`, `removeEntry`, `ensureDirectory`, NickelMenu install/removal, backup creation, firmware restore, and generated `KoboRoot.tgz` output.
- Prefer small, testable changes. Crucial functionality must be unit tested, especially pure parsing/validation and mocked filesystem write sequences.
- User-facing behavior must be covered by integration tests. If a change affects wizard steps, visible copy, selections, generated downloads, or device-write outcomes, add or update Playwright coverage.
- Do not invent fake product features just to test installers. Test the real feature modules, real generated paths, and real failure ordering.
- When changing `Kobo eReader.conf` handling, preserve line endings and unrelated sections. Validate generated `ExcludeSyncFolders` regexes.
- Unknown Kobo serial prefixes should consistently use the first 4 serial characters.

## Naming and exports

- Use lower camel case for normal exported values, helpers, path constants, regex constants, and mutable data.
- ALL_CAPS exports are acceptable for true catalog/config tables that are intentionally read as constants, such as `TL`, `NICKELMENU_FEATURES`, `NM_REVIEW_BACKUP_PATHS`, `NM_PRESET_CONFLICTS`, and `PATCH_FILE_LABELS`.
- Keep exported APIs boring and descriptive. Avoid broad "helpers" exports unless they are shared by multiple modules or tests.

## Commands

- `npm run serve` builds and serves the app at `http://localhost:8888`.
- `npm run dev` starts the local dev server with watch mode.
- `npm run test:unit` runs the frontend unit tests.
- `npm run lint` runs ESLint.
- `npm run build` builds the frontend.
- `npm run test` runs lint, unit tests, build, WASM checks, patch blacklist checks, and E2E tests.
- `npm run test:e2e` runs only the Playwright E2E suite.
- `npm run test:e2e:fresh` removes `dist`, rebuilds the app and required WASM artifact, then runs Playwright without the standalone WASM test suites.
- `npm run screenshots` captures mobile and desktop screenshots for visual review.

## Working notes

- Use `rg` for searching.
- Keep README user-facing. Put architecture, module maps, and detailed testing notes in `PROJECT.md`.
- Update documentation when the project changes. README, PROJECT.md, and AGENTS.md should stay accurate when architecture, commands, testing expectations, or workflows change.
- Do not edit generated or cached outputs such as `dist/`, `tests/e2e/cached_assets/`, or downloaded installable assets unless the task specifically requires it.
- After completing feature work, run `npm run test:e2e:fresh` so `dist` is rebuilt from scratch before Playwright verifies the app. (Keep in mind this may not work in a sandbox.)
- The worktree may contain unrelated changes. Do not revert user changes while making a focused patch.
