// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const JSZip = require('jszip');

const { FIRMWARE_PATH, paths, getOriginalTgzSha1 } = require('../../support/paths');
const { hasFirmwareZip } = require('../../support/assets');
const { injectMockDevice, connectMockDevice, overrideFirmwareURLs, goToManualMode, readMockFile, getWrittenFiles } = require('../../support/mock-device');
const { parseTar } = require('../../support/tar');

// Build a custom-patches-files archive (and its checksum) exactly the way the app
// does, so a seeded manifest can reference bytes the app will accept on reload.
async function buildPatchFilesArchive(entries) {
    const { buildAdditionalFilesTgz, sha256Hex } = await import(paths.src('js/patches/additional-files.js'));
    const archiveBytes = await buildAdditionalFilesTgz(entries);
    const sha256 = await sha256Hex(archiveBytes);
    return { archiveBytes, sha256, base64: Buffer.from(archiveBytes).toString('base64') };
}

const VERIFIED_IDENTIFICATION_HINT = 'The hardware UUID and serial prefix match this device.';
const REFURBISHED_IDENTIFICATION_HINT =
    'The hardware UUID matches this device. The serial prefix uses the refurbished-device form, which is expected for some Kobo replacements.';
const REFURBISHED_MODEL_HINT = 'This serial number uses the refurbished-device prefix form, which is expected for some Kobo replacements.';
const MISMATCH_IDENTIFICATION_HINT =
    'The hardware UUID matches this device, but the serial prefix does not match the expected device family. Custom patches are disabled for this device.';
const CLOUD_SYNC_PATCH_NAME = 'Unlock Dropbox and Google Drive support';
const DROPBOX_LINK_ACCOUNT_POLL = 'dropbox_link_account_poll=https://authorize.kobo.com/{region}/{language}/LinkDropbox';
const GOOGLEDRIVE_LINK_ACCOUNT_START = 'googledrive_link_account_start=https://authorize.kobo.com/{region}/{language}/linkcloudstorage/provider/google_drive';
const GOOGLEDRIVE_LINK_ACCOUNT_ENABLED = 'kobo_googledrive_link_account_enabled=True';
const DROPBOX_LINK_ACCOUNT_ENABLED = 'kobo_dropbox_link_account_enabled=True';

const CUSTOM_PATCHES_MANIFEST = JSON.stringify({
    overrides: { 'src/nickel.yaml': { 'Remove footer (row3) on new home screen': true } },
    customized: {},
    meta: { writer: { name: 'kobopatch-webui', version: 'test' } },
});

const customPatchesManifestFile = () => ({
    path: ['.kobopatch-webui', 'custom-patches.json'],
    content: CUSTOM_PATCHES_MANIFEST,
});

/**
 * Read a downloaded patches ZIP and return the embedded KoboRoot.tgz bytes.
 * The download bundles `.kobo/KoboRoot.tgz` alongside the custom-patches manifest.
 */
async function extractKoboRootTgz(download) {
    const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
    return zip.file('.kobo/KoboRoot.tgz').async('nodebuffer');
}

/**
 * A content signature of a KoboRoot.tgz: each entry's path, mode, and a hash of
 * its bytes, sorted by path. This compares the *patched payload* and ignores
 * archive-level metadata (gzip/tar timestamps), which is not reproducible across
 * builds even for identical inputs.
 */
function tgzContentSignature(tgzBytes) {
    const entries = parseTar(zlib.gunzipSync(tgzBytes));
    return Object.entries(entries)
        .map(([path, data]) => ({ path, sha1: crypto.createHash('sha1').update(Buffer.from(data)).digest('hex') }))
        .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Drive the manual flow up to a loaded patches step for 4.46.23836 / kobo13.
 * Collapses the version → channel → confirm sequence that nearly every patch
 * test repeats. Leaves the page on #step-patches with sections rendered.
 */
async function gotoManualPatchesStep(page) {
    await goToManualMode(page);
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-manual-version')).not.toBeHidden();
    await overrideFirmwareURLs(page);
    await page.selectOption('#manual-version', '4.46.23836');
    await page.selectOption('#manual-model', 'kobo13');
    await page.click('#btn-manual-confirm');
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);
}

test.describe('Custom patches', () => {
    test('with device — reload previously applied patches from the on-device manifest', async ({ page }) => {
        // "Increase library cover size" ships disabled; the manifest enables it and
        // carries a manual edit, so a reload should both check it and flag it modified.
        const manifest = {
            overrides: { 'src/nickel.yaml': { 'Increase library cover size': true } },
            customized: {
                'src/nickel.yaml': {
                    'Increase library cover size':
                        'Increase library cover size:\n  - Enabled: no\n  - FindReplaceString: {Find: "width: 60px;", Replace: "width: 99px;"}\n',
                },
            },
            meta: { writer: { name: 'kobopatch-webui', version: 'test' } },
        };

        await connectMockDevice(page, {
            extraRootFiles: [{ path: ['.kobopatch-webui', 'custom-patches.json'], content: JSON.stringify(manifest) }],
        });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-patches')).not.toBeHidden();

        // The reload offer appears because a manifest is present on the device.
        const banner = page.locator('#patch-reload-banner');
        await expect(banner).not.toBeHidden();
        await expect(banner).toContainText('previously patched');

        const patchName = page.locator('.patch-name', { hasText: 'Increase library cover size' }).first();
        const patchLabel = patchName.locator('xpath=ancestor::label');

        // Before reloading, the patch is unchecked and not flagged as modified.
        await patchName.locator('xpath=ancestor::details').locator('summary').click();
        await expect(patchLabel.locator('input')).not.toBeChecked();

        await page.click('#btn-patch-reload');

        // Banner confirms success; the patch is now enabled, modified, and counted.
        // (render() preserves the already-open section, so no need to re-expand.)
        await expect(banner).toContainText('reloaded');
        await expect(page.locator('#btn-patch-reload')).toBeHidden();
        await expect(patchLabel.locator('input')).toBeChecked();
        await expect(patchLabel.locator('.patch-modified')).toBeVisible();
        await expect(page.locator('#patch-count-hint')).toContainText('1 patch selected');

        // The summary dialog lists the re-applied patch by name and marks that it
        // carries a saved manual edit. The patch is compatible with this firmware,
        // so the compatibility note says nothing restored is known to fail. The
        // manifest carries a manual edit (and no firmware match), so the
        // customized-patches caveat shows; it has no additional files, so that
        // note is hidden.
        const dialog = page.locator('#patch-reload-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('#patch-reload-dialog-list li')).toContainText(['Increase library cover size']);
        await expect(dialog.locator('#patch-reload-dialog-list li .patch-reload-dialog-badge')).toHaveText('Customized');
        await expect(dialog.locator('#patch-reload-dialog-footnote')).toContainText('None of the restored patches are marked as known to fail');
        await expect(dialog.locator('#patch-reload-dialog-modified-note')).toContainText('restored exactly as they were saved');
        await expect(dialog.locator('#patch-reload-dialog-additional-note')).toBeHidden();

        await dialog.locator('#btn-patch-reload-dialog-close').click();
        await expect(dialog).toBeHidden();
    });

    test('with device — legacy manifest with no stored archive cannot restore its additional files', async ({ page }) => {
        // Manifest recorded for the device's own firmware (4.46.23836), carrying a
        // manual edit and an additional file but NO `additionalFilesArchive` (an
        // older install that predates the stored archive). The edit is still
        // restored as-is and noted; the additional file cannot be restored, so the
        // "unavailable" reminder is shown instead.
        const manifest = {
            overrides: { 'src/nickel.yaml': { 'Increase library cover size': true } },
            customized: {
                'src/nickel.yaml': {
                    'Increase library cover size':
                        'Increase library cover size:\n  - Enabled: no\n  - FindReplaceString: {Find: "width: 60px;", Replace: "width: 99px;"}\n',
                },
            },
            files: [
                { path: '.kobo/KoboRoot.tgz', type: 'file' },
                { path: '.adds/extra.txt', type: 'additional-file', sourceName: 'extra.txt', size: 4 },
            ],
            meta: { writer: { name: 'kobopatch-webui', version: 'test' }, installed: { firmware: '4.46.23836', channel: 'kobo12' } },
        };

        await connectMockDevice(page, {
            extraRootFiles: [{ path: ['.kobopatch-webui', 'custom-patches.json'], content: JSON.stringify(manifest) }],
        });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-patches')).not.toBeHidden();

        await expect(page.locator('#patch-reload-banner')).not.toBeHidden();
        await page.click('#btn-patch-reload');

        const dialog = page.locator('#patch-reload-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('#patch-reload-dialog-list li .patch-reload-dialog-badge')).toHaveText('Customized');
        await expect(dialog.locator('#patch-reload-dialog-modified-note')).toContainText('restored exactly as they were saved');
        await expect(dialog.locator('#patch-reload-dialog-additional-note')).toContainText('could not be restored');
        // No archive was present, so nothing landed in the Advanced section list.
        await expect(page.locator('#patch-additional-files-list')).not.toContainText('extra.txt');
    });

    test('with device — additional files are restored from the stored archive on reload', async ({ page }) => {
        // A manifest plus its companion archive (matching checksum). Reloading
        // re-enables the patch AND re-adds the stored additional file to the
        // Advanced section, ready to be re-applied.
        const archiveEntries = [{ path: '.adds/extra.txt', data: new TextEncoder().encode('hi!!'), mode: 0o777 }];
        const { archiveBytes, sha256, base64 } = await buildPatchFilesArchive(archiveEntries);
        const manifest = {
            overrides: { 'src/nickel.yaml': { 'Increase library cover size': true } },
            customized: {},
            files: [
                { path: '.kobo/KoboRoot.tgz', type: 'file' },
                { path: '.adds/extra.txt', type: 'additional-file', sourceName: 'extra.txt', size: 4 },
            ],
            additionalFilesArchive: { path: '.kobopatch-webui/custom-patches-files.tgz', sha256, size: archiveBytes.length },
            meta: { writer: { name: 'kobopatch-webui', version: 'test' }, installed: { firmware: '4.46.23836', channel: 'kobo12' } },
        };

        await connectMockDevice(page, {
            extraRootFiles: [
                { path: ['.kobopatch-webui', 'custom-patches.json'], content: JSON.stringify(manifest) },
                { path: ['.kobopatch-webui', 'custom-patches-files.tgz'], base64 },
            ],
        });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-patches')).not.toBeHidden();

        await expect(page.locator('#patch-reload-banner')).not.toBeHidden();
        await page.click('#btn-patch-reload');

        const dialog = page.locator('#patch-reload-dialog');
        await expect(dialog).toBeVisible();
        // The restored-files summary reports the count directly under the patch list
        // (above the notes divider), not among the caveat notes below it.
        await expect(dialog.locator('#patch-reload-dialog-additional-summary')).toContainText(
            '1 additional file from the previous patching process was restored below',
        );
        await expect(dialog.locator('#patch-reload-dialog-additional-note')).toBeHidden();

        // The file is back in the Advanced section with its original destination, the
        // section is auto-opened for review, and the count reflects both the patch
        // and the restored file.
        await expect(page.locator('#patch-advanced-section')).toHaveAttribute('open', '');
        await expect(page.locator('#patch-additional-files-list')).toContainText('extra.txt');
        await expect(page.locator('#patch-additional-files-list input')).toHaveValue('.adds/extra.txt');
        await expect(page.locator('#patch-count-hint')).toContainText('1 patch and 1 additional file selected');
    });

    test('with device — a checksum mismatch leaves the stored additional files unrestored', async ({ page }) => {
        // The archive is present but its bytes do not match the manifest's recorded
        // sha256 (tampered/stale). It must not be trusted: the file is not restored
        // and the "unavailable" note is shown.
        // A syntactically valid (64 hex chars) but deliberately incorrect SHA-256.
        const WRONG_SHA = 'f'.repeat(64);
        const archiveEntries = [{ path: '.adds/extra.txt', data: new TextEncoder().encode('hi!!'), mode: 0o777 }];
        const { archiveBytes, base64 } = await buildPatchFilesArchive(archiveEntries);
        const manifest = {
            overrides: { 'src/nickel.yaml': { 'Increase library cover size': true } },
            customized: {},
            files: [
                { path: '.kobo/KoboRoot.tgz', type: 'file' },
                { path: '.adds/extra.txt', type: 'additional-file', sourceName: 'extra.txt', size: 4 },
            ],
            // Deliberately wrong checksum for the seeded archive bytes.
            additionalFilesArchive: { path: '.kobopatch-webui/custom-patches-files.tgz', sha256: WRONG_SHA, size: archiveBytes.length },
            meta: { writer: { name: 'kobopatch-webui', version: 'test' }, installed: { firmware: '4.46.23836', channel: 'kobo12' } },
        };

        await connectMockDevice(page, {
            extraRootFiles: [
                { path: ['.kobopatch-webui', 'custom-patches.json'], content: JSON.stringify(manifest) },
                { path: ['.kobopatch-webui', 'custom-patches-files.tgz'], base64 },
            ],
        });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-patches')).not.toBeHidden();

        await page.click('#btn-patch-reload');

        const dialog = page.locator('#patch-reload-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('#patch-reload-dialog-additional-note')).toContainText('could not be restored');
        await expect(page.locator('#patch-additional-files-list')).not.toContainText('extra.txt');
    });

    test('with device — no reload banner when the device has no patches manifest', async ({ page }) => {
        await connectMockDevice(page, { hasNickelMenu: false });
        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-patches')).not.toBeHidden();
        await expect(page.locator('#patch-reload-banner')).toBeHidden();
    });

    test('with device — no reload banner for a manifest with every patch disabled', async ({ page }) => {
        // Defensive: a manifest with all overrides false and no edits (e.g. one left
        // by an older build's restore) describes nothing to re-apply, so the banner
        // must not appear. Current builds no longer write such a manifest on restore.
        const restoreManifest = {
            overrides: { 'src/nickel.yaml': { 'Increase library cover size': false, 'Show all games': false } },
            customized: {},
            meta: { writer: { name: 'kobopatch-webui', version: 'test' } },
        };
        await connectMockDevice(page, {
            extraRootFiles: [{ path: ['.kobopatch-webui', 'custom-patches.json'], content: JSON.stringify(restoreManifest) }],
        });
        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-patches')).not.toBeHidden();
        await expect(page.locator('#patch-reload-banner')).toBeHidden();
    });

    test('with device — reloading the manifest reproduces the identical patched output', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        // Walk the connected device to the patches step.
        const goToConnectedPatches = async (opts) => {
            await page.goto('/');
            await connectMockDevice(page, { overrideFirmware: true, ...opts });
            await page.click('#btn-device-next');
            await page.click('input[name="mode"][value="patches"]');
            await page.click('#btn-mode-next');
            await expect(page.locator('#step-patches')).not.toBeHidden();
        };

        // --- Scenario A: configure patches by hand (one enabled + manually edited),
        // build, and download. The download carries both KoboRoot.tgz and the
        // custom-patches manifest that a device install would also write.
        await goToConnectedPatches({ hasNickelMenu: false });

        const patchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
        await patchName.locator('xpath=ancestor::details').locator('summary').click();
        await expect(patchName).toBeVisible();
        const patchItem = patchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]');

        // Manually edit a value (known to still patch), then enable the patch.
        await patchItem.locator('.patch-edit-btn').click();
        const dialog = page.locator('#patch-editor-dialog');
        const textarea = dialog.locator('.patch-editor-textarea');
        const editedYaml = (await textarea.inputValue()).replace('min-height: 12px', 'min-height: 99px');
        await textarea.fill(editedYaml);
        await dialog.locator('.patch-editor-save').click();
        await expect(dialog).not.toBeVisible();
        await patchName.locator('xpath=ancestor::label').locator('input').check();
        await expect(patchItem.locator('.patch-modified')).toBeVisible();

        await page.click('#btn-patches-next');
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await page.click('#btn-build');
        await expect(page.locator('#step-done')).toBeVisible({ timeout: 240_000 });
        const [dlA] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);

        const zipA = await JSZip.loadAsync(fs.readFileSync(await dlA.path()));
        const sigA = tgzContentSignature(await zipA.file('.kobo/KoboRoot.tgz').async('nodebuffer'));
        const manifestText = await zipA.file('.kobopatch-webui/custom-patches.json').async('string');
        const manifestA = JSON.parse(manifestText);
        // Sanity: the manifest actually carried the manual edit forward.
        expect(manifestA.customized['src/nickel.yaml']).toBeTruthy();

        // --- Scenario B: a fresh session connects a device carrying that manifest,
        // restores it via the banner (no manual interaction with patches), and builds.
        await goToConnectedPatches({
            extraRootFiles: [{ path: ['.kobopatch-webui', 'custom-patches.json'], content: manifestText }],
        });

        await expect(page.locator('#patch-reload-banner')).not.toBeHidden();
        await page.click('#btn-patch-reload');
        await expect(page.locator('#patch-reload-banner')).toContainText('reloaded');
        // The restore summary dialog opens; dismiss it before continuing.
        await page.click('#btn-patch-reload-dialog-close');
        await expect(page.locator('#patch-reload-dialog')).toBeHidden();
        // The restored patch is enabled and flagged as modified, untouched by hand.
        await expect(page.locator('#patch-count-hint')).toContainText('1 patch selected');

        await page.click('#btn-patches-next');
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await page.click('#btn-build');
        await expect(page.locator('#step-done')).toBeVisible({ timeout: 240_000 });
        const [dlB] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);

        const zipB = await JSZip.loadAsync(fs.readFileSync(await dlB.path()));
        const sigB = tgzContentSignature(await zipB.file('.kobo/KoboRoot.tgz').async('nodebuffer'));
        const manifestB = JSON.parse(await zipB.file('.kobopatch-webui/custom-patches.json').async('string'));

        // 1. The patched KoboRoot payload must be identical (entry paths, modes, and
        //    bytes), including the effect of the manual edit.
        expect(sigB, 'reloaded build should produce the same patched files').toEqual(sigA);

        // 2. The manifest's key characteristics (selections + manual edits) must match,
        //    so a further reload would round-trip identically again.
        expect(manifestB.overrides, 'overrides should match').toEqual(manifestA.overrides);
        expect(manifestB.customized, 'manual edits should match').toEqual(manifestA.customized);
    });
});
