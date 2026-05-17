# AGENTS.md

Guidance for agents working in this repository. For the full maintainer notes, see [PROJECT.md](PROJECT.md).

## Project shape

- This is a static web app for customising Kobo e-readers. It can write directly to a connected Kobo through the File System Access API, so changes around device writes should be treated as high risk.
- `web/src/js/app.js` is the orchestrator. It owns shared state, device connection, mode selection, error recovery, and dialogs.
- `web/src/js/flows/` contains the user journeys. Keep flow-specific behavior inside the relevant flow file.
- `web/src/nickelmenu/` contains NickelMenu domain logic. Installer code belongs in `installer.js`, removal code belongs in `uninstaller.js`, and `Kobo eReader.conf` sync-exclusion logic belongs in `sync-exclusions.js`.
- `web/src/js/domain/` is for small pure domain modules that can be unit tested without DOM or filesystem mocks.
- `tests/` contains Playwright integration tests. `web/tests/unit/` contains Node unit tests for pure logic and mocked device-write behavior.
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

- `make serve` builds and serves the app at `http://localhost:8888`.
- `make dev` starts the local dev server with watch mode.
- `make test-unit` runs the frontend unit tests.
- `npm --prefix web run lint` runs ESLint.
- `npm --prefix web run build` builds the frontend.
- `make test` runs lint, unit tests, build, WASM checks, patch blacklist checks, and E2E tests.
- `make test-e2e` runs only the Playwright E2E suite.
- `make screenshots` captures mobile and desktop screenshots for visual review.

## Working notes

- Use `rg` for searching.
- Keep README user-facing. Put architecture, module maps, and detailed testing notes in `PROJECT.md`.
- Update documentation when the project changes. README, PROJECT.md, and AGENTS.md should stay accurate when architecture, commands, testing expectations, or workflows change.
- Do not edit generated or cached outputs such as `web/dist/`, `tests/cached_assets/`, or downloaded installable assets unless the task specifically requires it.
- The worktree may contain unrelated changes. Do not revert user changes while making a focused patch.
