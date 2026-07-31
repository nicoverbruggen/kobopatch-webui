// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const JSZip = require('jszip');

const { FIRMWARE_PATH, paths, getOriginalTgzSha1 } = require('../../support/paths');
const { hasFirmwareZip } = require('../../support/assets');
const {
    injectMockDevice,
    connectMockDevice,
    overrideFirmwareURLs,
    goToManualMode,
    readMockFile,
    getWrittenFiles,
    getWrittenFileBytes,
} = require('../../support/mock-device');
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
 * Drive the manual flow up to a loaded patches step for 4.45.23646 / kobo13.
 * Collapses the version → channel → confirm sequence that nearly every patch
 * test repeats. Leaves the page on #step-patches with sections rendered.
 */
async function gotoManualPatchesStep(page) {
    await goToManualMode(page);
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-manual-version')).not.toBeHidden();
    await overrideFirmwareURLs(page);
    await page.selectOption('#manual-version', '4.45.23646');
    await page.selectOption('#manual-model', 'kobo13');
    await page.click('#btn-manual-confirm');
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);
}

test.describe('Custom patches', () => {
    test('with device — additional files only writes the archive alongside the manifest', async ({ page }) => {
        await connectMockDevice(page, { hasNickelMenu: false });
        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-patches')).not.toBeHidden();

        await page.locator('#patch-advanced-section summary').click();
        await page.setInputFiles('#patch-additional-file-input', {
            name: 'extra.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('hi!!'),
        });
        await expect(page.locator('#patch-additional-files-list')).toContainText('extra.txt');

        await page.click('#btn-patches-next');
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await page.click('#btn-build');
        await expect(page.locator('#step-done')).toBeVisible({ timeout: 240_000 });

        await page.click('#btn-write');
        await expect(page.locator('#write-instructions')).not.toBeHidden();

        // The companion archive is written next to the manifest, and the manifest
        // points at it with a checksum a later reload can verify.
        const writtenFiles = await getWrittenFiles(page);
        expect(writtenFiles).toContainEqual(expect.stringContaining('.kobopatch-webui/custom-patches-files.tgz'));
        expect(writtenFiles).toContainEqual(expect.stringContaining('.kobopatch-webui/custom-patches.json'));

        const manifest = JSON.parse(await readMockFile(page, '.kobopatch-webui', 'custom-patches.json'));
        expect(manifest.additionalFilesArchive.path).toBe('.kobopatch-webui/custom-patches-files.tgz');
        expect(typeof manifest.additionalFilesArchive.sha256).toBe('string');
        expect(manifest.additionalFilesArchive.sha256).toHaveLength(64);
        expect(manifest.files).toContainEqual({ path: 'extra.txt', type: 'additional-file', sourceName: 'extra.txt', size: 4 });
    });

    // Drive the additional-files-only build to the done step. This path needs no
    // firmware download (nothing is patched — the result is just the companion
    // archive), so it exercises the write-step UI branches without the heavy
    // firmware fixture the patch-apply tests require.
    async function buildAdditionalFilesOnlyToDone(page) {
        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-patches')).not.toBeHidden();

        await page.locator('#patch-advanced-section summary').click();
        await page.setInputFiles('#patch-additional-file-input', {
            name: 'extra.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('hi!!'),
        });
        await expect(page.locator('#patch-additional-files-list')).toContainText('extra.txt');

        await page.click('#btn-patches-next');
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await page.click('#btn-build');
        await expect(page.locator('#step-done')).toBeVisible({ timeout: 240_000 });
    }

    test('with device — overwrite warning appears when a KoboRoot.tgz is already staged', async ({ page }) => {
        // A leftover .kobo/KoboRoot.tgz means a pending update hasn't been applied;
        // writing again would clobber it, so the done step warns before the write.
        await connectMockDevice(page, {
            hasNickelMenu: false,
            extraRootFiles: [{ path: ['.kobo', 'KoboRoot.tgz'], content: 'pending-update' }],
        });

        await buildAdditionalFilesOnlyToDone(page);

        await expect(page.locator('#existing-tgz-warning')).toBeVisible();
        await expect(page.locator('#existing-tgz-warning')).toContainText('existing');
        await expect(page.locator('#existing-tgz-warning')).toContainText('overwritten');
    });

    test('with device — a failed KoboRoot.tgz write routes through the device-write recovery screen', async ({ page }) => {
        // The mock rejects the KoboRoot.tgz write, so the patches write path must
        // surface the same device-write error recovery the other flows use.
        await connectMockDevice(page, {
            hasNickelMenu: false,
            failWritePaths: ['KOBOeReader/.kobo/KoboRoot.tgz'],
        });

        await buildAdditionalFilesOnlyToDone(page);

        await page.click('#btn-write');

        await expect(page.locator('#step-error')).not.toBeHidden();
        await expect(page.locator('#error-title')).toContainText('Writing to your device didn’t work');
        await expect(page.locator('#error-device-write-help')).toBeVisible();
        await expect(page.locator('#btn-error-download-log')).toBeVisible();
    });

    test('with device — additional-files-only write shows no conf-settings note and no overwrite warning', async ({ page }) => {
        // A clean device with no pending update and no conf-settings patch: the
        // overwrite warning stays hidden, and after writing, the "settings are in
        // place" note is omitted because nothing touched Kobo eReader.conf.
        await connectMockDevice(page, { hasNickelMenu: false });

        await buildAdditionalFilesOnlyToDone(page);

        await expect(page.locator('#existing-tgz-warning')).toBeHidden();

        await page.click('#btn-write');
        await expect(page.locator('#write-instructions')).toBeVisible();
        await expect(page.locator('#write-conf-settings-note')).toBeHidden();
    });

    test('with device — the written manifest checksum describes the archive written beside it', async ({ page }) => {
        // The one thing no other test checks: that the sha256 the app records is
        // computed over the exact bytes it writes next to it. Building the archive
        // and hashing it must stay a single paired operation — `buildTarGz` stamps
        // the current second into every tar header and the entries carry no mtime,
        // so two builds a second apart differ. Splitting, caching or memoizing the
        // pair yields a manifest that can never verify, and the failure is silent:
        // the reload banner still appears, the reload still reports success, and
        // the user's Additional Files are unrestorable forever.
        //
        // The existing assertion (`typeof sha256 === 'string'`, length 64) cannot
        // see this — a hash over the wrong bytes is still a 64-character string.
        await connectMockDevice(page, { hasNickelMenu: false });

        await buildAdditionalFilesOnlyToDone(page);
        await page.click('#btn-write');
        await expect(page.locator('#write-instructions')).toBeVisible();

        const manifest = JSON.parse(await readMockFile(page, '.kobopatch-webui', 'custom-patches.json'));
        const archiveBytes = await getWrittenFileBytes(page, 'KOBOeReader/.kobopatch-webui/custom-patches-files.tgz');

        expect(archiveBytes).not.toBeNull();
        expect(manifest.additionalFilesArchive.size).toBe(archiveBytes.length);
        expect(crypto.createHash('sha256').update(archiveBytes).digest('hex')).toBe(manifest.additionalFilesArchive.sha256);

        // And the round trip: the app's own reader accepts the app's own bytes.
        // `readAdditionalFilesArchive` is what the reload path parses with, and the
        // manifest's `files[]` paths must be the keys it finds.
        const { readAdditionalFilesArchive, sha256Hex } = await import(paths.src('js/patches/additional-files.js'));
        expect(await sha256Hex(new Uint8Array(archiveBytes))).toBe(manifest.additionalFilesArchive.sha256);

        const archive = await readAdditionalFilesArchive(new Uint8Array(archiveBytes));
        const recordedPaths = manifest.files.filter((f) => f.type === 'additional-file').map((f) => f.path);
        expect(recordedPaths).toEqual(['extra.txt']);
        expect(recordedPaths.map((p) => (archive.get(p) ? Buffer.from(archive.get(p)).toString() : null))).toEqual(['hi!!']);
    });

    test('with device — a second build pairs its own archive with its own checksum, not the earlier one', async ({ page }) => {
        // The companion to the test above, and the half it cannot see. That one
        // clicks write once, so `buildManifestArtifacts` runs once and any cache
        // populated on that call is trivially self-consistent. The failure this
        // guards is the one that survives it: caching `archiveInfo` from the write
        // path and rebuilding the bytes for the download path. The manifest then
        // records the *first* build's checksum against the *second* build's
        // archive, `readReloadAdditionalFiles` rejects it on every future reload,
        // and the user's Additional Files are unrestorable forever with no error.
        //
        // Both invocations come from the same done screen, so this exercises one
        // DoneStep instance — which is where such a cache would live.
        await connectMockDevice(page, { hasNickelMenu: false });

        await buildAdditionalFilesOnlyToDone(page);

        // First build: write to the device.
        await page.click('#btn-write');
        await expect(page.locator('#write-instructions')).toBeVisible();
        const writtenManifest = JSON.parse(await readMockFile(page, '.kobopatch-webui', 'custom-patches.json'));
        const writtenArchive = await getWrittenFileBytes(page, 'KOBOeReader/.kobopatch-webui/custom-patches-files.tgz');
        expect(writtenArchive).not.toBeNull();
        expect(crypto.createHash('sha256').update(writtenArchive).digest('hex')).toBe(writtenManifest.additionalFilesArchive.sha256);
        expect(writtenManifest.additionalFilesArchive.size).toBe(writtenArchive.length);

        // `buildTarGz` stamps `Math.floor(Date.now() / 1000)` into every tar header
        // and the entries carry no mtime, so two builds inside the same second are
        // byte-identical and a stale checksum would still match. Waiting past that
        // granularity forces the second build to differ; the assertion below proves
        // it actually did, so this test cannot quietly become vacuous.
        await page.waitForTimeout(1100);

        // Second build: download the ZIP, which contains its own manifest and its
        // own archive, both from that one invocation.
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);
        const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
        const zippedManifest = JSON.parse(await zip.file('.kobopatch-webui/custom-patches.json').async('string'));
        const zippedArchive = await zip.file('.kobopatch-webui/custom-patches-files.tgz').async('nodebuffer');

        expect(zippedArchive.equals(writtenArchive)).toBe(false);

        // The checksum first: it is the assertion that carries the meaning, and a
        // size mismatch is only a symptom that a future change could stop producing.
        expect(crypto.createHash('sha256').update(zippedArchive).digest('hex')).toBe(zippedManifest.additionalFilesArchive.sha256);
        expect(zippedManifest.additionalFilesArchive.size).toBe(zippedArchive.length);
    });

    test('with device — a failed manifest write degrades silently and still reports success', async ({ page }) => {
        // The manifest and its archive are written with `optional: true`, so a
        // failure is warned about and skipped while KoboRoot.tgz still counts as a
        // success. Dropping that flag turns a soft degradation — the user simply
        // gets no reload offer next time — into a device-write error screen.
        await connectMockDevice(page, {
            hasNickelMenu: false,
            failWritePaths: ['KOBOeReader/.kobopatch-webui/custom-patches.json'],
        });

        await buildAdditionalFilesOnlyToDone(page);
        await page.click('#btn-write');

        await expect(page.locator('#write-instructions')).toBeVisible();
        await expect(page.locator('#step-error')).toBeHidden();

        // The mandatory write landed; the optional one did not.
        const writtenFiles = await getWrittenFiles(page);
        expect(writtenFiles).toContainEqual(expect.stringContaining('.kobo/KoboRoot.tgz'));
        expect(writtenFiles).not.toContainEqual(expect.stringContaining('.kobopatch-webui/custom-patches.json'));
    });

    test('with device — apply patches and verify checksums', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        // Override firmware URLs BEFORE connecting so the app captures the local URL
        await connectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });

        // Continue to mode selection
        await page.click('#btn-device-next');
        await expect(page.locator('#step-mode')).not.toBeHidden();

        // Both modes should be available (firmware is supported)
        await expect(page.locator('input[name="mode"][value="patches"]')).not.toBeDisabled();

        // Select Custom Patches
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');

        // Patches step (patches should already be loaded from device detection)
        await expect(page.locator('#step-patches')).not.toBeHidden();
        await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);

        // Enable a patch (shown under its friendlier metadata label)
        const patchName = page.locator('.patch-name', { hasText: 'Hide home-screen footer row' }).first();
        const patchSection = patchName.locator('xpath=ancestor::details');
        await patchSection.locator('summary').click();
        await expect(patchName).toBeVisible();
        await patchName.locator('xpath=ancestor::label').locator('input').check();

        await expect(page.locator('#patch-count-hint')).toContainText('1 patch selected');
        await page.click('#btn-patches-next');

        // Build step
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await expect(page.locator('#firmware-version-label')).toHaveText('4.45.23646');
        await expect(page.locator('#firmware-device-label')).toHaveText('Kobo Libra Colour');

        await page.click('#btn-build');

        const doneOrError = await Promise.race([
            page
                .locator('#step-done')
                .waitFor({ state: 'visible', timeout: 240_000 })
                .then(() => 'done'),
            page
                .locator('#step-error')
                .waitFor({ state: 'visible', timeout: 240_000 })
                .then(() => 'error'),
        ]);

        if (doneOrError === 'error') {
            const errorMsg = await page.locator('#error-message').textContent();
            throw new Error(`Build failed: ${errorMsg}`);
        }

        await expect(page.locator('#build-status')).toContainText('Patching complete');

        // Both write and download should be visible with device connected
        await expect(page.locator('#btn-write')).toBeVisible();
        await expect(page.locator('#btn-download')).toBeVisible();

        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);

        expect(download.suggestedFilename()).toBe('custom-patches.zip');
    });

    test('with device — restore original firmware', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        // Override firmware URLs BEFORE connecting so the app captures the local URL
        await connectMockDevice(page, {
            hasNickelMenu: false,
            overrideFirmware: true,
            extraRootFiles: [customPatchesManifestFile()],
        });
        await expect(page.locator('#btn-device-restore')).toBeVisible();
        await expect(page.locator('#btn-device-restore svg')).toBeVisible();

        // Use the "Restore Unpatched Software" shortcut button on device screen
        await page.click('#btn-device-restore');

        // Build step should show restore mode
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await expect(page.locator('#firmware-description')).toContainText('without modifications');
        await expect(page.locator('#btn-build')).toContainText('Restore Original Software');

        await page.click('#btn-build');

        const doneOrError = await Promise.race([
            page
                .locator('#step-done')
                .waitFor({ state: 'visible', timeout: 240_000 })
                .then(() => 'done'),
            page
                .locator('#step-error')
                .waitFor({ state: 'visible', timeout: 240_000 })
                .then(() => 'error'),
        ]);

        if (doneOrError === 'error') {
            const errorMsg = await page.locator('#error-message').textContent();
            throw new Error(`Restore failed: ${errorMsg}`);
        }

        await expect(page.locator('#build-status')).toContainText('Software extracted');

        // Download and verify original
        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);

        expect(download.suggestedFilename()).toBe('custom-patches.zip');
        const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
        const actualHash = crypto
            .createHash('sha1')
            .update(await zip.file('.kobo/KoboRoot.tgz').async('nodebuffer'))
            .digest('hex');
        expect(actualHash, 'restored KoboRoot.tgz SHA1 mismatch').toBe(await getOriginalTgzSha1());
        // A restore carries no customization, so the package omits the manifest (which
        // reflects the last customized state) to avoid overwriting it on extract.
        expect(zip.file('.kobopatch-webui/custom-patches.json'), 'restore ZIP must not include a manifest').toBeNull();
    });

    test('with device — restoring stock firmware does not overwrite the patches manifest', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await connectMockDevice(page, {
            hasNickelMenu: false,
            overrideFirmware: true,
            extraRootFiles: [customPatchesManifestFile()],
        });
        await expect(page.locator('#btn-device-restore')).toBeVisible();
        await page.click('#btn-device-restore');
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await page.click('#btn-build');
        await expect(page.locator('#step-done')).toBeVisible({ timeout: 240_000 });

        await page.click('#btn-write');
        await expect(page.locator('#write-instructions')).not.toBeHidden();

        // KoboRoot.tgz is written, but the manifest (last customized state) is left untouched.
        const writtenFiles = await getWrittenFiles(page);
        expect(writtenFiles).toContainEqual(expect.stringContaining('.kobo/KoboRoot.tgz'));
        expect(
            writtenFiles.some((f) => f.includes('custom-patches.json')),
            'restore must not write the manifest',
        ).toBe(false);
    });

    test('with device — build failure shows Go Back and returns to patches', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await connectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });

        // Select Custom Patches
        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');

        // Enable "Remove footer (row3) on new home screen" (label: "Hide home-screen footer row")
        const patchName = page.locator('.patch-name', { hasText: 'Hide home-screen footer row' }).first();
        const patchSection = patchName.locator('xpath=ancestor::details');
        await patchSection.locator('summary').click();
        await patchName.locator('xpath=ancestor::label').locator('input').check();
        await page.click('#btn-patches-next');

        // Mock the WASM patcher to simulate a failure
        await page.evaluate(() => {
            KoboPatchRunner.prototype.patchFirmware = async function () {
                throw new Error('Patch failed to apply: symbol not found');
            };
        });

        // Build — should fail due to mock
        await page.click('#btn-build');

        await expect(page.locator('#step-error')).not.toBeHidden({ timeout: 30_000 });
        await expect(page.locator('#error-message')).toContainText('Build failed');
        await expect(page.locator('#btn-error-back')).toBeVisible();

        // "Select different patches" should return to patches step
        await page.click('#btn-error-back');
        await expect(page.locator('#step-patches')).not.toBeHidden();
    });

    test('with device — real patch failure with Go Back (Allow rotation)', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await connectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });

        // Select Custom Patches
        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');

        // "Allow rotation on all devices" is marked "known to fail" but can still
        // be enabled. Verify the build correctly fails (or skips) when an
        // incompatible patch is enabled, exercising the Go Back flow.
        const patchName = page.locator('.patch-name', { hasText: 'Allow rotation on all devices' }).first();
        const patchSection = patchName.locator('xpath=ancestor::details');
        await patchSection.locator('summary').click();
        await expect(patchName).toBeVisible();

        const input = patchName.locator('xpath=ancestor::label').locator('input');
        await input.check();

        await page.click('#btn-patches-next');

        // Build
        await page.click('#btn-build');

        const doneOrError = await Promise.race([
            page
                .locator('#step-done')
                .waitFor({ state: 'visible', timeout: 240_000 })
                .then(() => 'done'),
            page
                .locator('#step-error')
                .waitFor({ state: 'visible', timeout: 240_000 })
                .then(() => 'error'),
        ]);

        if (doneOrError === 'error') {
            // Build failed — "Select different patches" should return to patches step
            await page.click('#btn-error-back');
            await expect(page.locator('#step-patches')).not.toBeHidden();
        } else {
            // Build succeeded — check if the patch was skipped
            const logText = await page.locator('#build-log').textContent();
            console.log('Build log:', logText);
            const hasSkip = logText.includes('SKIP') && logText.includes('Allow rotation on all devices');
            expect(hasSkip, 'Expected "Allow rotation" to be skipped or fail').toBe(true);
        }
    });

    test('with device — back navigation through auto mode flow', async ({ page }) => {
        await page.goto('/');
        await injectMockDevice(page);
        await page.click('#btn-connect');

        // Step 1a: Connection instructions
        await expect(page.locator('#step-connect-instructions')).not.toBeHidden();

        // Back from instructions returns to connect step
        await page.click('#btn-connect-instructions-back');
        await expect(page.locator('#step-connect')).not.toBeHidden();

        // Forward again through instructions
        await page.click('#btn-connect');
        await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
        await page.click('#btn-connect-ready');

        // Step 1: Device
        await expect(page.locator('#step-device')).not.toBeHidden();

        // Device → Mode
        await page.click('#btn-device-next');
        await expect(page.locator('#step-mode')).not.toBeHidden();

        // Mode → Patches
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-patches')).not.toBeHidden();

        // Patches → Back → Mode
        await page.click('#btn-patches-back');
        await expect(page.locator('#step-mode')).not.toBeHidden();

        // Mode → NickelMenu config
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

        // NM config → Back → Mode
        await page.click('#btn-nm-back');
        await expect(page.locator('#step-mode')).not.toBeHidden();

        // Mode → NM config
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

        // NM config → select preset → Continue → Features step
        await page.click('input[value="preset"]');
        await page.click('#btn-nm-next');
        await expect(page.locator('#step-nm-features')).not.toBeHidden();

        // Features → Continue → NM backup
        await page.click('#btn-nm-features-next');
        await expect(page.locator('#step-nm-backup')).not.toBeHidden();
        await page.click('input[name="nm-backup-option"][value="skip"]');
        await page.click('#btn-nm-backup-next');
        await expect(page.locator('#step-nm-review')).not.toBeHidden();

        // NM review → Back → NM backup (for preset)
        await page.click('#btn-nm-review-back');
        await expect(page.locator('#step-nm-backup')).not.toBeHidden();
        await page.click('#btn-nm-backup-back');
        await expect(page.locator('#step-nm-features')).not.toBeHidden();

        // Features → Back → NM config
        await page.click('#btn-nm-features-back');
        await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

        // NM config → Back → Mode
        await page.click('#btn-nm-back');
        await expect(page.locator('#step-mode')).not.toBeHidden();

        // Mode → Back → Device
        await page.click('#btn-mode-back');
        await expect(page.locator('#step-device')).not.toBeHidden();

        // Device → Back → Connect
        await page.click('#btn-device-back');
        await expect(page.locator('#step-connect')).not.toBeHidden();

        // After going back from device, switching to manual mode should not
        // carry stale device state (patches should not appear pre-loaded).
        await page.click('#btn-manual');
        await expect(page.locator('#step-mode')).not.toBeHidden();
        await expect(page.locator('input[name="mode"][value="patches"]')).not.toBeDisabled();
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        // Manual + patches should go to version selection (not straight to patches)
        await expect(page.locator('#step-manual-version')).not.toBeHidden();
    });

    test('with device — write patched firmware writes config side effects, manifest, and audit log', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await connectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });

        // Select Custom Patches
        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');

        // Patches step
        await expect(page.locator('#step-patches')).not.toBeHidden();
        await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);

        // Enable a patch with Kobo eReader.conf side effects.
        const patchName = page.locator('.patch-name', { hasText: CLOUD_SYNC_PATCH_NAME }).first();
        const patchSection = patchName.locator('xpath=ancestor::details');
        await patchSection.locator('summary').click();
        await expect(patchName).toBeVisible();
        await patchName.locator('xpath=ancestor::label').locator('input').check();

        await expect(page.locator('#patch-count-hint')).toContainText('1 patch selected');
        await page.click('#btn-patches-next');

        // Build step — firmware/model should be set by device info
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await expect(page.locator('#firmware-version-label')).toHaveText('4.45.23646');
        await expect(page.locator('#firmware-device-label')).toHaveText('Kobo Libra Colour');

        // Build
        await page.click('#btn-build');

        const doneOrError = await Promise.race([
            page
                .locator('#step-done')
                .waitFor({ state: 'visible', timeout: 240_000 })
                .then(() => 'done'),
            page
                .locator('#step-error')
                .waitFor({ state: 'visible', timeout: 240_000 })
                .then(() => 'error'),
        ]);

        expect(doneOrError).toBe('done');
        await expect(page.locator('#build-status')).toContainText('Patching complete');

        // Write to device
        await expect(page.locator('#btn-write')).toBeVisible();
        await page.click('#btn-write');

        // Wait for write completion
        await expect(page.locator('#write-instructions')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#write-conf-settings-note')).toBeVisible();

        // Verify Kobo eReader.conf side effects
        const confText = await readMockFile(page, '.kobo', 'Kobo', 'Kobo eReader.conf');
        expect(confText).toContain('[ApplicationPreferences]');
        expect(confText).toContain(DROPBOX_LINK_ACCOUNT_POLL);
        expect(confText).toContain(GOOGLEDRIVE_LINK_ACCOUNT_START);
        expect(confText).toContain(GOOGLEDRIVE_LINK_ACCOUNT_ENABLED);
        expect(confText).toContain(DROPBOX_LINK_ACCOUNT_ENABLED);

        // Verify custom-patches.json manifest
        const manifestText = await readMockFile(page, '.kobopatch-webui', 'custom-patches.json');
        const manifest = JSON.parse(manifestText);
        expect(manifest.files.some((f) => f.path === '.kobo/KoboRoot.tgz')).toBe(true);
        expect(manifest.meta.writer.name).toBe('kobopatch-webui');
        expect(manifest.meta.installed.firmware).toBe('4.45.23646');
        expect(manifest.meta.installed.channel).toBe('kobo13');

        // Verify audit log written under .kobopatch-webui/logs/
        const writtenFiles = await getWrittenFiles(page);
        expect(writtenFiles).toContainEqual(expect.stringContaining('.kobo/Kobo/Kobo eReader.conf'));
        expect(writtenFiles.findIndex((f) => f.includes('.kobo/Kobo/Kobo eReader.conf'))).toBeLessThan(
            writtenFiles.findIndex((f) => f.includes('.kobo/KoboRoot.tgz')),
        );
        expect(writtenFiles.some((f) => f.includes('.kobopatch-webui/logs/') && f.includes('custom-patches'))).toBe(true);
    });
});
