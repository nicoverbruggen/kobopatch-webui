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
    test('with device — incompatible version 5.x shows error', async ({ page }) => {
        await page.goto('/');
        await injectMockDevice(page, { firmware: '5.0.0' });
        await page.click('#btn-connect');
        await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
        await page.click('#btn-connect-ready');

        // Device info should be displayed
        await expect(page.locator('#step-device')).not.toBeHidden();
        await expect(page.locator('#device-model')).toHaveText('Kobo Libra Colour');
        await expect(page.locator('#device-model .device-identification-badge--verified')).toHaveAttribute('data-tooltip', VERIFIED_IDENTIFICATION_HINT);
        await expect(page.locator('#device-firmware')).toHaveText('5.0.0');
        await expect(page.locator('#device-hardware-id')).toHaveText('00000000-0000-0000-0000-000000000390');

        // Status message should show incompatibility warning
        await expect(page.locator('#device-status')).toContainText('incompatible');
        await expect(page.locator('#device-status')).toContainText('Kobo software 4.23 or newer is required for NickelMenu');
        await expect(page.locator('#device-status')).toHaveClass(/error/);

        // Continue and restore buttons should be hidden, but Back should be visible
        await expect(page.locator('#btn-device-next')).toBeHidden();
        await expect(page.locator('#btn-device-restore')).toBeHidden();
        await expect(page.locator('#btn-device-back')).toBeVisible();

        // Back should return to connect step
        await page.click('#btn-device-back');
        await expect(page.locator('#step-connect')).not.toBeHidden();
    });

    test('with device — firmware below 4.23 shows error', async ({ page }) => {
        await page.goto('/');
        await injectMockDevice(page, { firmware: '4.22.99999' });
        await page.click('#btn-connect');
        await page.click('#btn-connect-ready');

        await expect(page.locator('#step-device')).not.toBeHidden();
        await expect(page.locator('#device-firmware')).toHaveText('4.22.99999');
        await expect(page.locator('#device-status')).toContainText('Kobo software 4.23 or newer is required for NickelMenu');
        await expect(page.locator('#device-status')).toHaveClass(/error/);
        await expect(page.locator('#btn-device-next')).toBeHidden();
        await expect(page.locator('#btn-device-restore')).toBeHidden();
    });

    test('Android mobile disables direct Kobo connection even when folder picker is available', async ({ browser }) => {
        const context = await browser.newContext({
            baseURL: 'http://localhost:8889',
            viewport: { width: 393, height: 852 },
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true,
            userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        });
        const page = await context.newPage();
        await page.addInitScript(() => {
            window.showDirectoryPicker = async () => ({});
        });

        try {
            await page.goto('/');
            await expect(page.locator('#mobile-dialog')).toBeVisible();
            await page.click('#btn-mobile-continue');

            await expect(page.locator('#btn-connect')).toBeDisabled();
            await expect(page.locator('#connect-unsupported-hint')).toBeVisible();
            await expect(page.locator('#connect-unsupported-text')).toContainText('not available on Android');
            await expect(page.locator('#connect-unsupported-text')).toContainText('manual download');
        } finally {
            await context.close();
        }
    });

    test('with device — write probe failure shows direct-write recovery guidance', async ({ page }) => {
        await page.goto('/');
        await injectMockDevice(page, {
            failWritePaths: ['KOBOeReader/.kobopatch-webui-probe'],
        });
        await page.click('#btn-connect');
        await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
        await page.click('#btn-connect-ready');

        await expect(page.locator('#step-error')).not.toBeHidden();
        await expect(page.locator('#error-title')).toContainText('Connection to device failed');
        await expect(page.locator('#error-message')).toContainText('A small test file to verify your device can be written to');
        await expect(page.locator('#error-device-write-help')).toBeVisible();
        // Connection tips are shown inline now, not behind a disclosure panel.
        await expect(page.locator('#error-device-write-help')).toContainText('Copy the files yourself');
    });

    test('connect — blocked drive permission shows a friendly error screen', async ({ page }) => {
        // Simulate the browser denying read/write access to the picked folder.
        await page.addInitScript(() => {
            window.showDirectoryPicker = async () => {
                const err = new Error('Permission denied');
                err.name = 'NotAllowedError';
                throw err;
            };
        });
        await page.goto('/');
        await page.click('#btn-connect');
        await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
        await page.click('#btn-connect-ready');

        await expect(page.locator('#step-error')).not.toBeHidden();
        await expect(page.locator('#error-title')).toContainText('Access to your device was blocked');
        await expect(page.locator('#error-message')).toContainText('did not get permission');
        // Not a device-write failure, so the write-recovery steps stay hidden.
        await expect(page.locator('#error-device-write-help')).toBeHidden();
    });

    test('unexpected errors are caught by the global safety net', async ({ page }) => {
        await page.goto('/');
        // An exception escaping every explicit handler should still surface a screen
        // rather than leaving the UI stranded.
        await page.evaluate(() => {
            window.dispatchEvent(
                new ErrorEvent('error', {
                    error: new Error('boom'),
                    message: 'boom',
                }),
            );
        });

        await expect(page.locator('#step-error')).not.toBeHidden();
        await expect(page.locator('#error-title')).toContainText('Something went wrong');
        await expect(page.locator('#error-message')).toContainText('unexpected error occurred');
        // The thrown detail is shown in the log area for reporting.
        await expect(page.locator('#error-log')).toContainText('boom');
    });

    test('with device — serial number is masked until revealed', async ({ page }) => {
        await page.goto('/');
        await injectMockDevice(page, {}); // default serial N4280A0000000
        await page.click('#btn-connect');
        await page.click('#btn-connect-ready');
        await expect(page.locator('#step-device')).not.toBeHidden();

        const serial = page.locator('#device-serial');
        // Masked by default: the model prefix shows, the rest is hidden behind dots.
        await expect(serial).toContainText('N428');
        await expect(serial).not.toContainText('N4280A0000000');
        await expect(serial).toContainText('•');

        // Reveal shows the full serial and flips the toggle to "Hide".
        const toggle = page.locator('.serial-reveal');
        await expect(toggle).toHaveText('Reveal');
        await toggle.click();
        await expect(serial).toContainText('N4280A0000000');
        await expect(serial).not.toContainText('•');
        await expect(toggle).toHaveText('Hide');

        // Hiding masks it again.
        await toggle.click();
        await expect(serial).not.toContainText('N4280A0000000');
        await expect(serial).toContainText('•');
        await expect(toggle).toHaveText('Reveal');
    });

    test('with device — restore shortcut is hidden when no custom-patches manifest exists', async ({ page }) => {
        await page.goto('/');
        await injectMockDevice(page);
        await page.click('#btn-connect');
        await page.click('#btn-connect-ready');

        await expect(page.locator('#step-device')).not.toBeHidden();
        await expect(page.locator('#device-status')).toContainText('recognized');
        await expect(page.locator('#btn-device-restore')).toBeHidden();
    });

    test('with device — restore shortcut appears when a custom-patches manifest exists', async ({ page }) => {
        await page.goto('/');
        await injectMockDevice(page, {
            extraRootFiles: [customPatchesManifestFile()],
        });
        await page.click('#btn-connect');
        await page.click('#btn-connect-ready');

        await expect(page.locator('#step-device')).not.toBeHidden();
        await expect(page.locator('#device-status')).toContainText('recognized');
        await expect(page.locator('#btn-device-restore')).toBeVisible();
        await expect(page.locator('#btn-device-restore svg')).toBeVisible();
        await expect(page.locator('#btn-device-restore')).toContainText('Restore Software');
    });

    test('with device — refurbished serial is verified and marked next to the model label', async ({ page }) => {
        await page.goto('/');
        await injectMockDevice(page, {
            serial: 'R4180A0000000',
            firmware: '4.38.23648',
            hardwareId: '00000000-0000-0000-0000-000000000388',
        });
        await page.click('#btn-connect');
        await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
        await page.click('#btn-connect-ready');

        await expect(page.locator('#step-device')).not.toBeHidden();
        await expect(page.locator('#device-model')).toContainText('Kobo Libra 2');
        await expect(page.locator('#device-model .device-refurbished-marker')).toHaveText('(refurb.)');
        await expect(page.locator('#device-model .device-refurbished-marker')).toHaveAttribute('data-tooltip', REFURBISHED_MODEL_HINT);
        await expect(page.locator('#device-model .device-identification-badge--refurbished')).toHaveAttribute('data-tooltip', REFURBISHED_IDENTIFICATION_HINT);
        await expect(page.locator('#device-firmware')).toHaveText('4.38.23648');
        await expect(page.locator('#device-hardware-id')).toHaveText('00000000-0000-0000-0000-000000000388');
        await expect(page.locator('#device-serial')).toContainText('R418');
        await expect(page.locator('#device-status')).toContainText('recognized');
        await expect(page.locator('#device-unknown-warning')).toBeHidden();
        await expect(page.locator('#btn-device-restore')).toBeHidden();
    });

    test('with device — known hardware UUID identifies unknown serial prefix', async ({ page }) => {
        await page.goto('/');
        await injectMockDevice(page, {
            serial: 'X9990A0000000',
            firmware: '4.38.23648',
            hardwareId: '00000000-0000-0000-0000-000000000388',
        });
        await page.click('#btn-connect');
        await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
        await page.click('#btn-connect-ready');

        await expect(page.locator('#step-device')).not.toBeHidden();
        await expect(page.locator('#device-model')).toHaveText('Kobo Libra 2');
        await expect(page.locator('#device-model .device-identification-badge--mismatch')).toHaveAttribute('data-tooltip', MISMATCH_IDENTIFICATION_HINT);
        await expect(page.locator('#device-firmware')).toHaveText('4.38.23648');
        await expect(page.locator('#device-hardware-id')).toHaveText('00000000-0000-0000-0000-000000000388');
        await expect(page.locator('#device-serial')).toContainText('X999');
        await expect(page.locator('#device-status')).toContainText('disabled');
        await expect(page.locator('#device-status')).toContainText('Please file an issue');
        await expect(page.locator('#device-status a')).toHaveAttribute('href', 'https://github.com/nicoverbruggen/kobopatch-webui/issues/new');
        await expect(page.locator('#device-unknown-warning')).toBeHidden();
        await expect(page.locator('#btn-device-restore')).toBeHidden();
    });

    test('with device — unknown hardware UUID no longer falls back to serial number', async ({ page }) => {
        await page.goto('/');
        await injectMockDevice(page, {
            serial: 'N4180A0000000',
            firmware: '4.38.23648',
            hardwareId: '00000000-0000-0000-0000-999999999999',
        });
        await page.click('#btn-connect');
        await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
        await page.click('#btn-connect-ready');

        await expect(page.locator('#step-device')).not.toBeHidden();
        await expect(page.locator('#device-model')).toHaveText('Unknown Kobo (N418)');
        await expect(page.locator('#device-model .device-identification-badge')).toHaveCount(0);
        await expect(page.locator('#device-unknown-warning')).not.toBeHidden();
    });

    test('with device — unknown model shows warning and requires checkbox', async ({ page }) => {
        await page.goto('/');
        await injectMockDevice(page, {
            serial: 'X9990A0000000',
            hardwareId: '00000000-0000-0000-0000-999999999999',
        });
        await page.click('#btn-connect');
        await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
        await page.click('#btn-connect-ready');

        // Device info should be displayed with unknown model
        await expect(page.locator('#step-device')).not.toBeHidden();
        await expect(page.locator('#device-model')).toContainText('Unknown');
        await expect(page.locator('#device-model .device-identification-badge')).toHaveCount(0);
        await expect(page.locator('#device-firmware')).toHaveText('4.45.23646');

        // Warning should be visible with GitHub link
        await expect(page.locator('#device-unknown-warning')).not.toBeHidden();
        await expect(page.locator('#device-unknown-warning')).toContainText('file an issue on GitHub');
        await expect(page.locator('#device-unknown-warning a')).toHaveAttribute('href', 'https://github.com/nicoverbruggen/kobopatch-webui/issues/new');

        // Checkbox should be visible, Continue should be disabled
        await expect(page.locator('#device-unknown-ack')).not.toBeHidden();
        await expect(page.locator('#btn-device-next')).toBeVisible();
        await expect(page.locator('#btn-device-next')).toBeDisabled();

        // Restore Software should be hidden (no firmware URL for unknown model)
        await expect(page.locator('#btn-device-restore')).toBeHidden();

        // Checking the checkbox enables Continue
        await page.check('#device-unknown-checkbox');
        await expect(page.locator('#btn-device-next')).toBeEnabled();

        // Custom patches should be disabled in mode selection (no firmware URL)
        await page.click('#btn-device-next');
        await expect(page.locator('#step-mode')).not.toBeHidden();
        await expect(page.locator('input[name="mode"][value="patches"]')).toBeDisabled();
    });
});
