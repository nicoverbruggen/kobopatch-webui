// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const JSZip = require('jszip');

const { FIRMWARE_PATH, getOriginalTgzSha1 } = require('../../support/paths');
const { hasFirmwareZip } = require('../../support/assets');
const { injectMockDevice, connectMockDevice, overrideFirmwareURLs, goToManualMode, readMockFile, getWrittenFiles } = require('../../support/mock-device');
const { parseTar } = require('../../support/tar');

// Build a custom-patches-files archive (and its checksum) exactly the way the app
// does, so a seeded manifest can reference bytes the app will accept on reload.
async function buildPatchFilesArchive(entries) {
    const { buildAdditionalFilesTgz, sha256Hex } = await import('../../../../src/js/patches/additional-files.js');
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
    test('no device — full manual mode patching pipeline', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await goToManualMode(page);

        // Select "Custom Patches" mode
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');

        // Manual version/model selection
        await expect(page.locator('#step-manual-version')).not.toBeHidden();

        await overrideFirmwareURLs(page);

        // Select firmware version
        await page.selectOption('#manual-version', '4.45.23646');
        await expect(page.locator('#manual-model')).not.toBeHidden();

        // Select Kobo Libra Colour (kobo13)
        await page.selectOption('#manual-model', 'kobo13');
        await expect(page.locator('#btn-manual-confirm')).toBeEnabled();
        await page.click('#btn-manual-confirm');

        // Wait for patches to load
        await expect(page.locator('#step-patches')).not.toBeHidden();
        await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);

        // Enable a patch with Kobo eReader.conf side effects.
        const patchName = page.locator('.patch-name', { hasText: CLOUD_SYNC_PATCH_NAME }).first();
        const patchSection = patchName.locator('xpath=ancestor::details');
        await patchSection.locator('summary').click();
        await expect(patchName).toBeVisible();
        await patchName.locator('xpath=ancestor::label').locator('input').check();

        // Verify patch count
        await expect(page.locator('#patch-count-hint')).toContainText('1 patch selected');
        await expect(page.locator('#btn-patches-next')).toBeEnabled();

        // Continue to build step
        await page.click('#btn-patches-next');
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await expect(page.locator('#firmware-version-label')).toHaveText('4.45.23646');
        await expect(page.locator('#firmware-device-label')).toHaveText('kobo13: Kobo Libra Colour (N428)');

        // Build and wait for completion
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
        await expect(page.locator('#build-status')).toContainText('kobo13: Kobo Libra Colour (N428)');

        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);

        expect(download.suggestedFilename()).toBe('custom-patches.zip');
        await expect(page.locator('#download-device-name')).toHaveText('kobo13: Kobo Libra Colour (N428)');
        // The screen points users at the bundled instructions.txt file.
        await expect(page.locator('#download-instructions')).toContainText('instructions.txt');

        // The ZIP bundles plain-text instructions naming the selected device, with
        // the credit header and the hard-lock disclaimer.
        const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
        expect(Object.keys(zip.files)).toContain('instructions.txt');
        const instructions = await zip.file('instructions.txt').async('string');
        expect(instructions).toContain('Generated by KoboPatch Web UI');
        expect(instructions).toContain('Connect your kobo13: Kobo Libra Colour (N428) via USB');
        expect(instructions).toContain('Open .kobo/Kobo/Kobo eReader.conf in a text editor');
        expect(instructions).toContain('[ApplicationPreferences]');
        expect(instructions).toContain(DROPBOX_LINK_ACCOUNT_POLL);
        expect(instructions).toContain(GOOGLEDRIVE_LINK_ACCOUNT_START);
        expect(instructions).toContain(GOOGLEDRIVE_LINK_ACCOUNT_ENABLED);
        expect(instructions).toContain(DROPBOX_LINK_ACCOUNT_ENABLED);
        expect(instructions).toContain('https://help.kobo.com/hc/en-us/articles/360017605314');
        expect(instructions).toContain('apply the patches automatically.');
    });

    test('no device — restore original firmware', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await goToManualMode(page);

        // Select "Custom Patches" mode
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');

        // Manual version/model selection
        await expect(page.locator('#step-manual-version')).not.toBeHidden();

        await overrideFirmwareURLs(page);

        await page.selectOption('#manual-version', '4.45.23646');
        await page.selectOption('#manual-model', 'kobo13');
        await page.click('#btn-manual-confirm');

        // Wait for patches to load, then continue with zero patches
        await expect(page.locator('#step-patches')).not.toBeHidden();
        await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);
        await expect(page.locator('#patch-count-hint')).toContainText('restore the original');
        await page.click('#btn-patches-next');

        // Verify build step shows restore text
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await expect(page.locator('#firmware-description')).toContainText('without modifications');
        await expect(page.locator('#btn-build')).toContainText('Restore Original Software');

        // Build and wait for completion
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

        // Download the ZIP and verify the embedded KoboRoot.tgz matches the original
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

    // With no patches enabled, the firmware is never downloaded or run through the
    // patcher: KoboRoot.tgz is built from the additional files alone (no lib files).

    test('no device — additional files only build a KoboRoot.tgz without lib files', async ({ page }) => {
        await gotoManualPatchesStep(page);
        await expect(page.locator('#patch-advanced-section')).not.toHaveAttribute('open', '');
        await page.locator('#patch-advanced-section summary').click();
        await expect(page.locator('.patch-additional-files')).toContainText('Only add files when you know the exact destination path');

        await page.setInputFiles('#patch-additional-file-input', {
            name: 'Georgia.ttf',
            mimeType: 'font/ttf',
            buffer: Buffer.from('font-bytes'),
        });

        await expect(page.locator('#patch-additional-files-list')).toContainText('Georgia.ttf');
        await expect(page.locator('#patch-additional-files-list input')).toHaveValue('usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf');
        await expect(page.locator('#patch-count-hint')).toContainText('1 additional file selected');

        await page.click('#btn-patches-next');
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await expect(page.locator('#selected-additional-files-list')).toContainText(
            'Georgia.ttf -> usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf',
        );
        await expect(page.locator('#firmware-description')).toContainText('no patches are selected');
        await expect(page.locator('#firmware-download-details')).toBeHidden();
        await expect(page.locator('#btn-build')).toHaveText('Build KoboRoot.tgz');

        await page.click('#btn-build');
        await expect(page.locator('#step-done')).toBeVisible({ timeout: 240_000 });

        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);
        const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
        const tgzEntries = parseTar(zlib.gunzipSync(await zip.file('.kobo/KoboRoot.tgz').async('nodebuffer')));
        expect(Buffer.from(tgzEntries['usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf']).toString('utf8')).toBe('font-bytes');
        // Only the additional file is packaged — no patched library files.
        expect(Object.keys(tgzEntries)).toEqual(['usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf']);

        const manifest = JSON.parse(await zip.file('.kobopatch-webui/custom-patches.json').async('string'));
        expect(manifest.files).toContainEqual({
            path: 'usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf',
            type: 'additional-file',
            sourceName: 'Georgia.ttf',
            size: 10,
        });

        // The download bundle also persists the companion archive, referenced by the
        // manifest with a checksum, so a later restore can re-add the file.
        const archiveBuf = await zip.file('.kobopatch-webui/custom-patches-files.tgz').async('nodebuffer');
        const archiveEntries = parseTar(zlib.gunzipSync(archiveBuf));
        expect(Buffer.from(archiveEntries['usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf']).toString('utf8')).toBe('font-bytes');
        expect(manifest.additionalFilesArchive).toEqual({
            path: '.kobopatch-webui/custom-patches-files.tgz',
            sha256: crypto.createHash('sha256').update(archiveBuf).digest('hex'),
            size: archiveBuf.length,
        });
    });

    test('no device — additional file destinations are validated before build', async ({ page }) => {
        await gotoManualPatchesStep(page);
        await page.locator('#patch-advanced-section summary').click();

        await page.setInputFiles('#patch-additional-file-input', {
            name: 'Georgia.ttf',
            mimeType: 'font/ttf',
            buffer: Buffer.from('font-bytes'),
        });

        const destination = page.locator('#patch-additional-files-list input');
        await destination.fill('/usr/local/Trolltech/QtEmbedded-4.6.2-arm/lib/fonts/Georgia.ttf');
        await destination.blur();

        await expect(destination).toHaveAttribute('aria-invalid', 'true');
        await expect(page.locator('#patch-additional-files-error')).toContainText('Destination paths must not start with /');
        await expect(page.locator('.patch-additional-file-error')).toContainText('Destination paths must not start with /');
        await expect(page.locator('#btn-patches-next')).toBeDisabled();
    });

    test('no device — download archive failure shows an error screen', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await goToManualMode(page);
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-manual-version')).not.toBeHidden();
        await overrideFirmwareURLs(page);
        await page.selectOption('#manual-version', '4.45.23646');
        await expect(page.locator('#manual-model')).not.toBeHidden();
        await page.selectOption('#manual-model', 'kobo13');
        await page.click('#btn-manual-confirm');

        await expect(page.locator('#step-patches')).not.toBeHidden();
        await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);
        const section = page.locator('.patch-file-section').first();
        await section.locator('summary').click();
        await section
            .locator('label')
            .filter({ has: page.locator('input[type="checkbox"]') })
            .first()
            .locator('input')
            .check();

        await page.click('#btn-patches-next');
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await page.click('#btn-build');
        await expect(page.locator('#step-done')).toBeVisible({ timeout: 240_000 });

        // Force archive creation to fail, then attempt the download.
        await page.evaluate(() => {
            URL.createObjectURL = () => {
                throw new Error('forced download failure');
            };
        });
        await page.click('#btn-download');

        await expect(page.locator('#step-error')).not.toBeHidden();
        await expect(page.locator('#error-title')).toContainText('Preparing the download didn’t work');
        await expect(page.locator('#error-message')).toContainText('creating the archive to download');
    });

    test('no device — both modes available in manual mode', async ({ page }) => {
        await page.goto('/');

        await page.click('#btn-manual');
        await expect(page.locator('#step-mode')).not.toBeHidden();
        await expect(page.locator('#step-mode .selection-card-title').first()).toHaveText('Tweak my device with NickelMenu');
        await expect(page.locator('#step-mode .selection-card-note')).toHaveText([
            'For everyone',
            'Offers uninstallation option',
            'Optionally install KOReader & NickelClock',
            'For advanced users',
            'Requires reinstall after updates',
        ]);
        await expect(page.locator('#step-mode .selection-card-desc').nth(1)).toContainText('restore the original software');

        // Both modes should be available in manual mode
        await expect(page.locator('input[name="mode"][value="patches"]')).not.toBeDisabled();
        await expect(page.locator('input[name="mode"][value="nickelmenu"]')).not.toBeDisabled();
    });

    test('switching from manual to connect resets manual state', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await page.goto('/');
        await expect(page.locator('h1')).toContainText('KoboPatch');

        // Start in manual mode, select patches, reach version picker
        await page.click('#btn-manual');
        await expect(page.locator('#step-mode')).not.toBeHidden();
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-manual-version')).not.toBeHidden();

        // Confirm version/model (sets patchesLoaded = true), then back out
        await overrideFirmwareURLs(page);
        await page.selectOption('#manual-version', '4.45.23646');
        await expect(page.locator('#manual-model')).not.toBeHidden();
        await page.selectOption('#manual-model', 'kobo13');
        await page.click('#btn-manual-confirm');
        await expect(page.locator('#step-patches')).not.toBeHidden();

        // Go back all the way to the connect step
        await page.click('#btn-patches-back');
        await expect(page.locator('#step-manual-version')).not.toBeHidden();
        await page.click('#btn-manual-version-back');
        await expect(page.locator('#step-mode')).not.toBeHidden();
        await page.click('#btn-mode-back');
        await expect(page.locator('#step-connect')).not.toBeHidden();

        // Change mind: click "Connect to Kobo" — manualMode and patchesLoaded must be reset
        await injectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });
        await page.click('#btn-connect');
        await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
        await page.click('#btn-connect-ready');
        await expect(page.locator('#step-device')).not.toBeHidden();

        // Continue to mode selection, pick patches
        await page.click('#btn-device-next');
        await expect(page.locator('#step-mode')).not.toBeHidden();
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');

        // Should go to the device-aware patches step, NOT the manual version picker
        await expect(page.locator('#step-patches')).not.toBeHidden();
        await expect(page.locator('#step-manual-version')).toBeHidden();

        // Back from patches should return to mode selection, not manual version
        await page.click('#btn-patches-back');
        await expect(page.locator('#step-mode')).not.toBeHidden();
        await expect(page.locator('#step-manual-version')).toBeHidden();
    });

    test('no device — back navigation through manual mode flow', async ({ page }) => {
        await page.goto('/');
        await goToManualMode(page);

        // Step 1: Mode
        await expect(page.locator('#step-mode')).not.toBeHidden();

        // Mode → Patches → Version selection
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-manual-version')).not.toBeHidden();

        // Version → Back → Mode
        await page.click('#btn-manual-version-back');
        await expect(page.locator('#step-mode')).not.toBeHidden();

        // Mode → NickelMenu config
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

        // NM config → Back → Mode
        await page.click('#btn-nm-back');
        await expect(page.locator('#step-mode')).not.toBeHidden();

        // Mode → Patches → Version selection
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-manual-version')).not.toBeHidden();

        // Select version and model, confirm
        await page.selectOption('#manual-version', '4.45.23646');
        await page.locator('#manual-model').waitFor({ state: 'visible' });
        await page.selectOption('#manual-model', 'kobo13');
        await page.click('#btn-manual-confirm');
        await expect(page.locator('#step-patches')).not.toBeHidden();

        // Patches → Back → Version
        await page.click('#btn-patches-back');
        await expect(page.locator('#step-manual-version')).not.toBeHidden();

        // Version → Back → Mode
        await page.click('#btn-manual-version-back');
        await expect(page.locator('#step-mode')).not.toBeHidden();

        // Mode → Back → Connect
        await page.click('#btn-mode-back');
        await expect(page.locator('#step-connect')).not.toBeHidden();
    });
});
