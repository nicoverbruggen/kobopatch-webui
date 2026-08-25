import { test, expect } from '@playwright/test';
import {
    shot,
    SCREENSHOT_DIRS,
    dismissMobileModal,
    makeKOReaderAvailable,
    shotNickelMenuCustomizeModal,
    shotNickelMenuTabsModal,
    shotNickelMenuFontsModal,
    openNmFeatureSection,
    selectManualPatchesModel,
    capturePatchesBuildingScreen,
    poseRestoreDoneScreen,
    injectMockDevice,
    overrideFirmwareURLs,
    hasFirmwareZip,
} from '../../support/screenshot-helpers.mjs';

test('manual nickelmenu', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.manualNickelMenu;
    const isMobile = testInfo.project.name === 'mobile';

    await page.goto('/');
    if (isMobile) {
        await page.click('#btn-mobile-continue');
        await expect(page.locator('#mobile-dialog')).not.toBeVisible();
    }

    // Click "Build downloadable archive" to enter manual mode
    await page.click('#btn-manual');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Select NickelMenu, screenshot, then proceed
    await page.click('input[name="mode"][value="nickelmenu"]');
    await shot(page, dir, '01-mode-selection', testInfo);
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await shot(page, dir, '02-nickelmenu-config', testInfo);

    // Preset → features
    await page.click('input[value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await shot(page, dir, '03-nickelmenu-features', testInfo);
    await shotNickelMenuCustomizeModal(page, dir, '03a-nickelmenu-customize-modal', testInfo);
    await shotNickelMenuTabsModal(page, dir, '03b-nickelmenu-tabs-modal', testInfo);
    await shotNickelMenuFontsModal(page, dir, '03c-nickelmenu-fonts-modal', testInfo);

    // The "Alternative reading apps" section (collapsed by default) holds KOReader
    // and Cadmus.
    await openNmFeatureSection(page, 'Alternative reading apps');
    await shot(page, dir, '03c-nickelmenu-features-reading-apps', testInfo);

    // A KOReader plugin is a checkbox under KOReader, disabled until KOReader
    // itself is ticked. Capture that second state too, then untick so the rest
    // of the flow is unaffected.
    await page.check('input[name="nm-cfg-koreader"]');
    await shot(page, dir, '03c-nickelmenu-features-reading-apps-plugins', testInfo);
    await page.uncheck('input[name="nm-cfg-koreader"]');

    // The Advanced section (collapsed by default) holds the power-user mods —
    // Sideload Mode and NickelCoverFix (experimental; currently temporarily
    // hidden via its maintainer kill switch).
    await openNmFeatureSection(page, 'Advanced');
    await shot(page, dir, '03d-nickelmenu-features-advanced', testInfo);

    // Features → backup → review (only download button in manual mode)
    await page.click('#btn-nm-features-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await shot(page, dir, '04-nickelmenu-backup', testInfo);
    await page.click('#btn-nm-backup-next');
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await shot(page, dir, '05-nickelmenu-review', testInfo);

    // Download → done
    await page.click('#btn-nm-download');
    const nmDone = page.locator('#step-nm-done');
    await expect(nmDone).not.toBeHidden();
    await shot(page, dir, '06-nickelmenu-done', testInfo);
});

// ============================================================
// 2. Manual NickelMenu removal instructions
// ============================================================

test('manual nickelmenu remove', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.manualNickelMenu;
    const isMobile = testInfo.project.name === 'mobile';

    await page.goto('/');
    if (isMobile) {
        await page.click('#btn-mobile-continue');
        await expect(page.locator('#mobile-dialog')).not.toBeVisible();
    }

    await page.click('#btn-manual');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[name="nm-option"][value="remove"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-manual-remove')).not.toBeHidden();
    await shot(page, dir, '02a-nickelmenu-manual-remove', testInfo);
});

test('manual nickelmenu review notices', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.manualNickelMenu;

    await makeKOReaderAvailable(page);
    await page.goto('/');
    await dismissMobileModal(page);

    await page.click('#btn-manual');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[value="preset"]');
    await page.click('#btn-nm-next');

    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await openNmFeatureSection(page, 'Alternative reading apps');
    await page.check('input[name="nm-cfg-koreader"]');
    await page.click('#btn-nm-features-next');

    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await page.click('#btn-nm-backup-next');
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-notices')).toContainText('Known issue with KOReader');
    await shot(page, dir, '05a-nickelmenu-review-notices', testInfo);
});

// ============================================================
// 3. Manual Patches flow
// ============================================================

test('manual patches', async ({ page }, testInfo) => {
    test.skip(!hasFirmwareZip(), 'Firmware zip not available');

    const dir = SCREENSHOT_DIRS.manualPatches;
    const isMobile = testInfo.project.name === 'mobile';

    await page.goto('/');
    await injectMockDevice(page);
    await page.waitForFunction(() => !!window.FIRMWARE_DOWNLOADS);
    await overrideFirmwareURLs(page);

    if (isMobile) {
        await page.click('#btn-mobile-continue');
        await expect(page.locator('#mobile-dialog')).not.toBeVisible();
    }

    // Click "Build downloadable archive" to enter manual mode
    await page.click('#btn-manual');
    await expect(page.locator('#step-mode')).not.toBeHidden();

    // Select Patches, then screenshot mode selection before proceeding
    await page.click('input[name="mode"][value="patches"]');
    await shot(page, dir, '01-mode-selection', testInfo);
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-manual-version')).not.toBeHidden();
    await shot(page, dir, '02-version-selection', testInfo);

    // Select firmware version and channel
    await page.selectOption('#manual-version', '4.46.23836');
    await expect(page.locator('#manual-model')).not.toBeHidden();
    await page.selectOption('#manual-model', 'kobo13');
    await shot(page, dir, '02a-version-channel-selected', testInfo);
    await page.click('#btn-manual-confirm');

    // Patches config
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await shot(page, dir, '03-patches-config', testInfo);
    // The compatibility report lives under the Customize Patch List section.
    await page.locator('#patch-about-patches-section > summary').click();
    await page.locator('.patch-blacklist-button').click();
    const blacklistDialog = page.locator('#patch-blacklist-dialog');
    await expect(blacklistDialog).toBeVisible();
    await shot(page, dir, '03a-patch-blacklist-dialog', testInfo);
    await blacklistDialog.locator('#btn-patch-blacklist-close').click();
    await expect(blacklistDialog).not.toBeVisible();
    await page.locator('#patch-about-patches-section > summary').click(); // collapse Customize Patch List again

    // Expand section and select a standalone (checkbox) patch.
    const section = page.locator('.patch-file-section').first();
    await section.locator('summary').click();
    const patchLabel = section
        .locator('label')
        .filter({ has: page.locator('input[type="checkbox"]') })
        .first();
    await patchLabel.locator('input').check();
    await shot(page, dir, '04-patches-selected', testInfo);

    // Patch editor — open, validate an edit, and show the "modified" indicator.
    // Edit a different patch than the one selected above (a CSS patch that uses
    // only ops the validator recognises, so the edit validates cleanly) so the
    // selection count carries through and the badge is prominent in the shot.
    const editPatchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
    await editPatchName.locator('xpath=ancestor::details').locator('summary').click();
    const editTarget = editPatchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]');
    await editTarget.locator('.patch-edit-btn').click();
    const editorDialog = page.locator('#patch-editor-dialog');
    await expect(editorDialog).toBeVisible();
    await shot(page, dir, '04a-patch-editor', testInfo);

    const editorTextarea = editorDialog.locator('.patch-editor-textarea');
    const originalYaml = await editorTextarea.inputValue();
    await editorTextarea.fill(originalYaml.replace(/\n*$/, '') + '\n  # customized via kobopatch-webui\n');
    await editorDialog.locator('.patch-editor-validate').click();
    await expect(editorDialog.locator('.patch-editor-status--ok')).toBeVisible();
    await shot(page, dir, '04b-patch-editor-validated', testInfo);

    await editorDialog.locator('.patch-editor-save').click();
    await expect(editorDialog).not.toBeVisible();
    await expect(page.locator('.patch-modified').first()).toBeVisible();
    await shot(page, dir, '04c-patch-modified', testInfo);

    // Reveal a patch's notes (description, author credit) surfaced from metadata.
    const notesToggle = section.locator('.patch-desc-toggle').first();
    await notesToggle.click();
    await expect(section.locator('.patch-notes').first()).toBeVisible();
    await shot(page, dir, '04d-patch-notes', testInfo);
    await notesToggle.click();

    // Advanced toggle: switch to the original file-based names/sections, capture, revert.
    await page.locator('#patch-about-patches-section > summary').click();
    await page.locator('#patch-original-format').check();
    await expect(page.locator('.patch-file-name', { hasText: 'Nickel (UI patches)' }).first()).toBeVisible();
    await shot(page, dir, '04e-patches-original-format', testInfo);
    await page.locator('#patch-original-format').uncheck();
    await page.locator('#patch-about-patches-section > summary').click();

    // Review & build
    await page.click('#btn-patches-next');
    await expect(page.locator('#step-firmware')).not.toBeHidden();
    await shot(page, dir, '05-build', testInfo);

    // Build
    await page.click('#btn-build');
    const stepDone = page.locator('#step-done');
    await expect(stepDone).not.toBeHidden({ timeout: 60_000 });
    await shot(page, dir, '06-patches-done', testInfo);

    // Download
    await page.click('#btn-download');
    await expect(stepDone.locator('#download-instructions')).toBeVisible();
    await shot(page, dir, '07-patches-done-download', testInfo);
});

test('manual patches restore original', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.manualPatches;
    const isMobile = testInfo.project.name === 'mobile';

    await page.goto('/');
    if (isMobile) {
        await page.click('#btn-mobile-continue');
        await expect(page.locator('#mobile-dialog')).not.toBeVisible();
    }

    await page.click('#btn-manual');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');

    await expect(page.locator('#step-manual-version')).not.toBeHidden();
    await selectManualPatchesModel(page);

    await expect(page.locator('#step-patches')).not.toBeHidden();
    await expect(page.locator('#patch-count-hint')).toContainText('restore the original');
    await page.click('#btn-patches-next');

    await expect(page.locator('#step-firmware')).not.toBeHidden();
    await expect(page.locator('#firmware-description')).toContainText('without modifications');
    await shot(page, dir, '08-restore-build', testInfo);

    await capturePatchesBuildingScreen(
        page,
        dir,
        '08a-restore-building',
        testInfo,
        'Please wait while the original software is being downloaded and extracted...',
    );

    await poseRestoreDoneScreen(page, { manual: true });
    await shot(page, dir, '09-restore-done', testInfo);

    await poseRestoreDoneScreen(page, { manual: true, downloaded: true });
    await shot(page, dir, '10-restore-done-download', testInfo);
});

// Additional files only (no patches selected): the firmware is never downloaded
// or patched — KoboRoot.tgz is built from the added files alone. This flow needs
// no firmware zip, so the build runs for real all the way to the done screen.

test('manual patches additional files only', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.manualPatches;
    const isMobile = testInfo.project.name === 'mobile';

    await page.goto('/');
    if (isMobile) {
        await page.click('#btn-mobile-continue');
        await expect(page.locator('#mobile-dialog')).not.toBeVisible();
    }

    await page.click('#btn-manual');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');

    await expect(page.locator('#step-manual-version')).not.toBeHidden();
    await selectManualPatchesModel(page);

    // Open the Advanced section and add a file without enabling any patch.
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await page.locator('#patch-advanced-section summary').click();
    await page.setInputFiles('#patch-additional-file-input', {
        name: 'Georgia.ttf',
        mimeType: 'font/ttf',
        buffer: Buffer.from('font-bytes'),
    });
    await expect(page.locator('#patch-additional-files-list')).toContainText('Georgia.ttf');
    await expect(page.locator('#patch-count-hint')).toContainText('1 additional file selected');
    await shot(page, dir, '11-additional-files-config', testInfo);

    // Build step — no firmware download, just packaging the added files.
    await page.click('#btn-patches-next');
    await expect(page.locator('#step-firmware')).not.toBeHidden();
    await expect(page.locator('#firmware-description')).toContainText('no patches are selected');
    await shot(page, dir, '12-additional-files-build', testInfo);

    // Done — the KoboRoot.tgz is built for real from the added file alone.
    await page.click('#btn-build');
    const stepDone = page.locator('#step-done');
    await expect(stepDone).not.toBeHidden({ timeout: 60_000 });
    await shot(page, dir, '13-additional-files-done', testInfo);

    await page.click('#btn-download');
    await expect(stepDone.locator('#download-instructions')).toBeVisible();
    await shot(page, dir, '14-additional-files-done-download', testInfo);
});

test('manual patches blacklist matching firmware tooltip', async ({ page }, testInfo) => {
    test.skip(!hasFirmwareZip(), 'Firmware zip not available');

    const dir = SCREENSHOT_DIRS.manualPatches;
    const isMobile = testInfo.project.name === 'mobile';

    await page.goto('/');
    await injectMockDevice(page);
    await page.waitForFunction(() => !!window.FIRMWARE_DOWNLOADS);
    await overrideFirmwareURLs(page);

    if (isMobile) {
        await page.click('#btn-mobile-continue');
        await expect(page.locator('#mobile-dialog')).not.toBeVisible();
    }

    await page.click('#btn-manual');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-manual-version')).not.toBeHidden();
    await page.selectOption('#manual-version', '4.45.23697');
    await expect(page.locator('#manual-model')).not.toBeHidden();
    await page.selectOption('#manual-model', 'kobo13');
    await page.click('#btn-manual-confirm');

    await expect(page.locator('#step-patches')).not.toBeHidden();
    await page.locator('#patch-about-patches-section > summary').click();
    await page.locator('.patch-blacklist-button').click();
    const blacklistDialog = page.locator('#patch-blacklist-dialog');
    await expect(blacklistDialog).toBeVisible();
    await blacklistDialog.locator('.device-identification-badge--verified').hover();
    await expect(blacklistDialog.locator('#patch-blacklist-version-tooltip')).toBeVisible();
    await shot(page, dir, '03b-patch-blacklist-match-tooltip', testInfo);
});

// ============================================================
// 4. Connected NickelMenu flow
// ============================================================
