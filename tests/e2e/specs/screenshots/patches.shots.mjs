import { test, expect } from '@playwright/test';
import {
    shot,
    SCREENSHOT_DIRS,
    dismissMobileModal,
    capturePatchesBuildingScreen,
    poseRestoreDoneScreen,
    injectMockDevice,
    overrideFirmwareURLs,
    mockPatchBlacklist,
    hasFirmwareZip,
    buildAdditionalFilesTgz,
    sha256Hex,
} from '../../support/screenshot-helpers.mjs';

test('patches building (busy indicator)', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.connectedPatches;

    await page.goto('/');
    await dismissMobileModal(page);
    await capturePatchesBuildingScreen(page, dir, '07a-patches-building', testInfo, 'Please wait while the patch is being applied...');
});

test('connected patches', async ({ page }, testInfo) => {
    test.skip(!hasFirmwareZip(), 'Firmware zip not available');

    const dir = SCREENSHOT_DIRS.connectedPatches;
    const isMobile = testInfo.project.name === 'mobile';

    await page.goto('/');
    await injectMockDevice(page);
    await page.waitForFunction(() => !!window.FIRMWARE_DOWNLOADS);
    await overrideFirmwareURLs(page);

    if (isMobile) {
        await page.click('#btn-mobile-continue');
        await expect(page.locator('#mobile-dialog')).not.toBeVisible();
    }

    await expect(page.locator('#step-connect')).not.toBeHidden();
    await shot(page, dir, '01-connect', testInfo);

    // Connection instructions
    await page.click('#btn-connect');
    await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
    await shot(page, dir, '02-connect-instructions', testInfo);

    // Device detected
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();
    await shot(page, dir, '03-device', testInfo);

    // Mode selection — select Patches, screenshot, then proceed
    await page.click('#btn-device-next');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="patches"]');
    await shot(page, dir, '04-mode-selection', testInfo);
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await shot(page, dir, '05-patches-config', testInfo);

    // Expand section and select a patch
    const section = page.locator('.patch-file-section').first();
    await section.locator('summary').click();
    const patchLabel = section
        .locator('label')
        .filter({ has: page.locator('.patch-name:not(.patch-name-none)') })
        .first();
    await patchLabel.locator('input').check();
    await shot(page, dir, '06-patches-selected', testInfo);

    // Review & build
    await page.click('#btn-patches-next');
    await expect(page.locator('#step-firmware')).not.toBeHidden();
    await shot(page, dir, '07-build', testInfo);

    // Build → done
    await page.click('#btn-build');
    const stepDone = page.locator('#step-done');
    await expect(stepDone).not.toBeHidden({ timeout: 60_000 });
    await shot(page, dir, '08-patches-done', testInfo);

    // Write to connected device.
    await page.click('#btn-write');
    await expect(stepDone.locator('#write-instructions')).toBeVisible();
    await shot(page, dir, '09-patches-done-written', testInfo);

    // Download
    await page.click('#btn-download');
    await expect(stepDone.locator('#download-instructions')).toBeVisible();
    await shot(page, dir, '10-patches-done-download', testInfo);
});

// Reload-from-device offer: a connected device carrying a custom-patches
// manifest. No firmware build is involved, so this runs without the zip.

test('connected patches reload', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.connectedPatches;

    const manifest = {
        overrides: { 'src/nickel.yaml': { 'Increase library cover size': true } },
        customized: {
            'src/nickel.yaml': {
                'Increase library cover size':
                    'Increase library cover size:\n  - Enabled: no\n  - FindReplaceString: {Find: "width: 60px;", Replace: "width: 99px;"}\n',
            },
        },
        meta: { writer: { name: 'kobopatch-webui', version: 'screenshot' } },
    };

    await page.goto('/');
    await dismissMobileModal(page);
    await injectMockDevice(page, {
        extraRootFiles: [{ path: ['.kobopatch-webui', 'custom-patches.json'], content: JSON.stringify(manifest) }],
    });

    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-patches')).not.toBeHidden();

    // The offer banner with the "Restore previous patches" button.
    await expect(page.locator('#patch-reload-banner')).not.toBeHidden();
    await shot(page, dir, '11-patches-reload-offer', testInfo);

    // Restoring opens a summary dialog (captured per-variant under edge-cases/restore);
    // dismiss it here so the connected flow shows the resulting success banner.
    await page.click('#btn-patch-reload');
    const reloadDialog = page.locator('#patch-reload-dialog');
    await expect(reloadDialog).toBeVisible();
    await page.click('#btn-patch-reload-dialog-close');
    await expect(reloadDialog).not.toBeVisible();
    await expect(page.locator('#patch-reload-banner')).toContainText('reloaded');
    await shot(page, dir, '12-patches-reload-applied', testInfo);
});

// The "Restore previous patches" summary dialog always reports compatibility,
// and has additional conditional notices for incompatible patches, customized
// patches, and the Additional Files reminder. Capture
// each variant of the dialog.
const RESTORE_EDIT = 'Increase library cover size:\n  - Enabled: no\n  - FindReplaceString: {Find: "width: 60px;", Replace: "width: 99px;"}\n';
const restoreMeta = (firmware) => ({ writer: { name: 'kobopatch-webui', version: 'screenshot' }, installed: { firmware, channel: 'kobo12' } });

const openRestoreSummary = async (page, manifest, extraFiles = []) => {
    await page.goto('/');
    await dismissMobileModal(page);
    await injectMockDevice(page, {
        extraRootFiles: [{ path: ['.kobopatch-webui', 'custom-patches.json'], content: JSON.stringify(manifest) }, ...extraFiles],
    });
    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await expect(page.locator('#patch-reload-banner')).not.toBeHidden();
    await page.click('#btn-patch-reload');
    await expect(page.locator('#patch-reload-dialog')).toBeVisible();
};

// Variant 1: compatible patch, no edits, no additional files.

test('restore summary — compatible patch', async ({ page }, testInfo) => {
    await openRestoreSummary(page, {
        overrides: { 'src/nickel.yaml': { 'Increase library cover size': true } },
        customized: {},
        files: [{ path: '.kobo/KoboRoot.tgz', type: 'file' }],
        meta: restoreMeta('4.45.23646'),
    });
    await shot(page, SCREENSHOT_DIRS.edgeRestore, '01-no-notices', testInfo);
});

// Variant 2: a patch blacklisted for this firmware is re-applied.

test('restore summary — incompatible patch', async ({ page }, testInfo) => {
    await mockPatchBlacklist(page);
    await openRestoreSummary(page, {
        overrides: { 'src/libnickel.so.1.0.0.yaml': { 'Hide browser from beta features': true } },
        customized: {},
        files: [{ path: '.kobo/KoboRoot.tgz', type: 'file' }],
        meta: restoreMeta('4.45.23646'),
    });
    await expect(page.locator('#patch-reload-dialog-footnote')).toBeVisible();
    await expect(page.locator('#patch-reload-dialog-footnote')).toContainText('marked as known to fail');
    await shot(page, SCREENSHOT_DIRS.edgeRestore, '02-incompatible', testInfo);
});

// Variant 3: edited patch restored from the manifest.

test('restore summary — customized patch', async ({ page }, testInfo) => {
    await openRestoreSummary(page, {
        overrides: { 'src/nickel.yaml': { 'Increase library cover size': true } },
        customized: { 'src/nickel.yaml': { 'Increase library cover size': RESTORE_EDIT } },
        files: [{ path: '.kobo/KoboRoot.tgz', type: 'file' }],
        meta: restoreMeta('4.38.23648'),
    });
    await expect(page.locator('.patch-reload-dialog-badge', { hasText: 'Customized' })).toBeVisible();
    await expect(page.locator('#patch-reload-dialog-modified-note')).toBeVisible();
    await shot(page, SCREENSHOT_DIRS.edgeRestore, '03-modified-patches', testInfo);
});

// Variant 4: a legacy manifest recorded additional files but stored no archive →
// the "could not be restored" reminder.

test('restore summary — additional files unavailable', async ({ page }, testInfo) => {
    await openRestoreSummary(page, {
        overrides: { 'src/nickel.yaml': { 'Increase library cover size': true } },
        customized: {},
        files: [
            { path: '.kobo/KoboRoot.tgz', type: 'file' },
            { path: '.adds/extra.txt', type: 'additional-file', sourceName: 'extra.txt', size: 4 },
        ],
        meta: restoreMeta('4.45.23646'),
    });
    await expect(page.locator('#patch-reload-dialog-additional-note')).toContainText('could not be restored');
    await shot(page, SCREENSHOT_DIRS.edgeRestore, '04-additional-files-unavailable', testInfo);
});

// Variant 4b: the manifest stored a checksummed archive → the additional files are
// restored to the Advanced section and the dialog confirms it.

test('restore summary — additional files restored', async ({ page }, testInfo) => {
    const archiveBytes = await buildAdditionalFilesTgz([{ path: '.adds/extra.txt', data: new TextEncoder().encode('hi!!'), mode: 0o777 }]);
    const base64 = Buffer.from(archiveBytes).toString('base64');
    await openRestoreSummary(
        page,
        {
            overrides: { 'src/nickel.yaml': { 'Increase library cover size': true } },
            customized: {},
            files: [
                { path: '.kobo/KoboRoot.tgz', type: 'file' },
                { path: '.adds/extra.txt', type: 'additional-file', sourceName: 'extra.txt', size: 4 },
            ],
            additionalFilesArchive: { path: '.kobopatch-webui/custom-patches-files.tgz', sha256: await sha256Hex(archiveBytes), size: archiveBytes.length },
            meta: restoreMeta('4.45.23646'),
        },
        [{ path: ['.kobopatch-webui', 'custom-patches-files.tgz'], base64 }],
    );
    await expect(page.locator('#patch-reload-dialog-additional-summary')).toContainText('was restored below');
    await shot(page, SCREENSHOT_DIRS.edgeRestore, '04b-additional-files-restored', testInfo);
});

// Variant 5: all three notices at once — an incompatible patch, an edited patch from
// a different firmware, and recorded additional files.

test('restore summary — all notices', async ({ page }, testInfo) => {
    await mockPatchBlacklist(page);
    await openRestoreSummary(page, {
        overrides: {
            'src/libnickel.so.1.0.0.yaml': { 'Hide browser from beta features': true },
            'src/nickel.yaml': { 'Increase library cover size': true },
        },
        customized: { 'src/nickel.yaml': { 'Increase library cover size': RESTORE_EDIT } },
        files: [
            { path: '.kobo/KoboRoot.tgz', type: 'file' },
            { path: '.adds/extra.txt', type: 'additional-file', sourceName: 'extra.txt', size: 4 },
        ],
        meta: restoreMeta('4.38.23648'),
    });
    await expect(page.locator('#patch-reload-dialog-footnote')).toBeVisible();
    await expect(page.locator('#patch-reload-dialog-modified-note')).toBeVisible();
    await expect(page.locator('#patch-reload-dialog-additional-note')).toBeVisible();
    await shot(page, SCREENSHOT_DIRS.edgeRestore, '05-all-notices', testInfo);
});

test('connected patches restore original shortcut', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.connectedPatches;
    const manifest = {
        overrides: { 'src/nickel.yaml': { 'Remove footer (row3) on new home screen': true } },
        customized: {},
        meta: { writer: { name: 'kobopatch-webui', version: 'screenshot' } },
    };

    await page.goto('/');
    await injectMockDevice(page, {
        extraRootFiles: [{ path: ['.kobopatch-webui', 'custom-patches.json'], content: JSON.stringify(manifest) }],
    });
    await dismissMobileModal(page);

    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();
    await expect(page.locator('#btn-device-restore')).toBeVisible();

    await page.click('#btn-device-restore');
    await expect(page.locator('#step-firmware')).not.toBeHidden();
    await expect(page.locator('#firmware-description')).toContainText('without modifications');
    await shot(page, dir, '13-restore-build-shortcut', testInfo);

    await capturePatchesBuildingScreen(
        page,
        dir,
        '13a-restore-building',
        testInfo,
        'Please wait while the original software is being downloaded and extracted...',
    );

    await poseRestoreDoneScreen(page);
    await shot(page, dir, '14-restore-done', testInfo);

    await poseRestoreDoneScreen(page, { written: true });
    await shot(page, dir, '15-restore-done-written', testInfo);

    await poseRestoreDoneScreen(page, { downloaded: true });
    await shot(page, dir, '16-restore-done-download', testInfo);
});

// ============================================================
// 7. Edge cases
// ============================================================
