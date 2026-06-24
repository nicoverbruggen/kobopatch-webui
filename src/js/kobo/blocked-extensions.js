/**
 * blocked-extensions.js — file extensions the File System Access API refuses to
 * create on the device.
 *
 * THE PROBLEM
 * -----------
 * Chromium rejects `FileSystemDirectoryHandle.getFileHandle(name, {create:true})`
 * when `name`'s extension is on its "dangerous / shell-integrated" list — the
 * same filter `showSaveFilePicker()` has always enforced, later extended to
 * `getFileHandle(create:true)` to close a gap. The call throws:
 *
 *     TypeError: Failed to execute 'getFileHandle' on
 *     'FileSystemDirectoryHandle': Name is not allowed.
 *
 * There is no permission prompt and no override — the page simply cannot create
 * such a file. The block is by extension, regardless of the file's contents or
 * whether it already exists, and it rolled out gradually across browser
 * versions, so the same install works on an older browser and fails on a newer
 * one. That is exactly the "writing to your device didn't work" pattern users
 * reported intermittently.
 *
 * For our installs the affected payload is NickelClock's
 * `.adds/nickelclock/settings.ini`. (Extensionless files like `.adds/nm/items`,
 * and `.sh` / `.png` / `.ttf` files, are NOT blocked, so they still write
 * directly. `Kobo eReader.conf` is `.conf` and writes fine in the field, so
 * `.conf` is deliberately NOT on the list below.)
 *
 * THE WORKAROUND
 * --------------
 * A blocked onboard file is delivered inside `KoboRoot.tgz` instead of being
 * written directly. The device extracts `KoboRoot.tgz` over `/` on the next
 * boot, and onboard storage is mounted at `/mnt/onboard`, so a tar entry at
 * `mnt/onboard/.adds/…` lands on onboard exactly where a direct write would have
 * put it — never touching the File System Access API. See
 * `nickelmenu/installer.js` `installToDevice`, which routes any collected file
 * whose name `isFsaBlockedName()` into the combined archive.
 *
 * References:
 *   - https://issues.chromium.org/issues/380857453 (".cfg" / "Name is not allowed")
 *   - https://groups.google.com/a/chromium.org/g/blink-dev/c/bFUbINgQNgk
 *     (Intent to ship: limiting characters/extensions in FSA file pickers)
 */

// Lower-cased, dot stripped. Drawn from Chromium's documented restrictions; only
// `ini` currently appears in our payloads, the rest are defensive against future
// onboard files a feature might add.
const FSA_BLOCKED_EXTENSIONS = new Set(['ini', 'cfg', 'dll', 'grp', 'local', 'lnk', 'url', 'scf']);

/**
 * Whether the File System Access API would refuse to create a file with this
 * name. Accepts a bare name or a full device path (only the last segment's
 * extension matters). Dotfiles with no further extension (e.g. `.cog`) and
 * extensionless names are allowed.
 */
function isFsaBlockedName(name) {
    const base = String(name).split('/').pop();
    const dot = base.lastIndexOf('.');
    if (dot <= 0) return false; // no extension, or a leading-dot-only name
    return FSA_BLOCKED_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

export { FSA_BLOCKED_EXTENSIONS, isFsaBlockedName };
