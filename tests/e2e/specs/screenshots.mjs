/**
 * Capture screenshots of every step in the wizard.
 * Uses the same Playwright test infrastructure and dev server as the E2E tests.
 * Runs once per project (mobile + desktop) defined in screenshots.config.js.
 * Every screen is captured in both light and dark mode.
 * Writes into screenshots/<project>/<theme>/{manual,connected,edge-cases}/...
 *
 * Run: ./run-screenshots.sh
 */
import { test, expect } from '@playwright/test';
import { injectMockDevice, overrideFirmwareURLs } from '../support/mock-device.js';
import { hasFirmwareZip } from '../support/assets.js';

const THEMES = ['light', 'dark'];

// Force a theme instantly (no transition), mirroring the app's own swap so the
// screenshot never catches a half-animated colour.
const setTheme = (page, theme) =>
    page.evaluate((t) => {
        const root = document.documentElement;
        root.classList.add('theme-no-transition');
        root.setAttribute('data-theme', t);
        void root.offsetWidth;
        root.classList.remove('theme-no-transition');
    }, theme);

const shot = async (page, folder, name, testInfo) => {
    const project = testInfo.project.name;
    await page.waitForTimeout(200);
    for (const theme of THEMES) {
        await setTheme(page, theme);
        await page.screenshot({ path: `screenshots/${project}/${theme}/${folder}/${name}.png`, fullPage: true });
    }
    // Leave the page on the default light theme so later steps start from a known state.
    await setTheme(page, 'light');
};

const SCREENSHOT_DIRS = {
    manualNickelMenu: 'manual/nickelmenu',
    manualPatches: 'manual/patches',
    connectedNickelMenu: 'connected/nickelmenu/install',
    connectedNickelMenuRemoval: 'connected/nickelmenu/removal',
    connectedNickelMenuFactory: 'connected/nickelmenu/factory-reset',
    connectedPatches: 'connected/patches',
    edgeConnection: 'edge-cases/connection',
    edgeDeviceWrite: 'edge-cases/device-write',
    edgeDownload: 'edge-cases/download',
    edgeCompatibility: 'edge-cases/compatibility',
    edgeAnalytics: 'edge-cases/analytics',
    edgeDialogs: 'edge-cases/dialogs',
    edgeNickelMenu: 'edge-cases/nickelmenu',
};

/** Dismiss the mobile warning modal if it's open. */
const dismissMobileModal = async (page) => {
    const dialog = page.locator('#mobile-dialog');
    if (await dialog.evaluate((el) => el.open).catch(() => false)) {
        await page.click('#btn-mobile-continue');
        await expect(dialog).not.toBeVisible();
    }
};

const makeKOReaderAvailable = async (_page) => {
    // No-op: add-on availability is now baked into the bundle from installables.lock
    // at build time (esbuild define), not probed at runtime, so it can't be forced via
    // a route. The screenshot/e2e build runs setup:installables, so KOReader is present
    // and marked available already.
};

const shotNickelMenuCustomizeModal = async (page, folder, name, testInfo) => {
    await page.getByRole('button', { name: 'Customize NickelMenu preset tab' }).click();
    const dialog = page.locator('#nm-customize-dialog');
    await expect(dialog).toBeVisible();
    await shot(page, folder, name, testInfo);
    await page.click('#btn-nm-customize-close');
    await expect(dialog).not.toBeVisible();
};

const selectManualPatchesModel = async (page) => {
    await page.selectOption('#manual-version', { index: 1 });
    await expect(page.locator('#manual-model')).not.toBeHidden();
    await page.selectOption('#manual-model', { index: 1 });
    await page.click('#btn-manual-confirm');
};

const capturePatchesBuildingScreen = async (page, folder, name, testInfo, hint) => {
    await page.evaluate((waitHint) => {
        for (const step of document.querySelectorAll('.step')) step.hidden = true;
        document.getElementById('step-building').hidden = false;
        document.getElementById('build-progress').textContent = 'Downloading firmware...';
        document.getElementById('build-wait-hint').textContent = waitHint;
        document.getElementById('build-log').textContent = 'Download started...\n';
    }, hint);
    await expect(page.locator('#step-building')).not.toBeHidden();
    await shot(page, folder, name, testInfo);
};

const connectToDeviceScreen = async (page, device = {}) => {
    await page.goto('/');
    await dismissMobileModal(page);
    await injectMockDevice(page, device);
    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();
};

const poseRestoreDoneScreen = async (page, { manual = false, written = false, downloaded = false } = {}) => {
    await page.evaluate(
        ({ isManual, isWritten, isDownloaded }) => {
            for (const step of document.querySelectorAll('.step')) step.hidden = true;
            document.getElementById('step-done').hidden = false;
            const nav = document.getElementById('step-nav');
            nav.hidden = false;
            nav.querySelectorAll('li').forEach((li, index) => {
                const stepNum = index + 1;
                li.classList.toggle('done', stepNum < 5);
                li.classList.toggle('active', stepNum === 5);
                if (stepNum === 5) {
                    li.setAttribute('aria-current', 'step');
                } else {
                    li.removeAttribute('aria-current');
                }
            });
            document.getElementById('build-status').innerHTML =
                'Software extracted. <strong>KoboRoot.tgz</strong> (1.2 MB) is ready. ' +
                'This will restore the original unpatched software. ' +
                (isManual ? 'Download the file and copy it to your Kobo.' : 'Write it directly to your connected Kobo, or download for manual installation.');
            document.getElementById('done-log').textContent = [
                'Download complete: 150.0 MB',
                'Extracting original KoboRoot.tgz from firmware...',
                'Extracted KoboRoot.tgz: 1.2 MB',
            ].join('\n');

            const writeButton = document.getElementById('btn-write');
            writeButton.hidden = isManual;
            writeButton.disabled = false;
            writeButton.className = isWritten ? 'btn-success' : 'primary';
            writeButton.textContent = isWritten ? 'Written' : 'Write to Kobo';

            const downloadButton = document.getElementById('btn-download');
            downloadButton.disabled = false;
            document.getElementById('write-instructions').hidden = !isWritten;
            document.getElementById('download-instructions').hidden = !isDownloaded;
            document.getElementById('download-device-name').textContent = 'Kobo Libra Colour';
            document.getElementById('existing-tgz-warning').hidden = true;
        },
        { isManual: manual, isWritten: written, isDownloaded: downloaded },
    );
    await expect(page.locator('#step-done')).not.toBeHidden();
};

// ============================================================
// 1. Manual NickelMenu flow
// ============================================================

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
    await page.selectOption('#manual-version', { index: 1 });
    await expect(page.locator('#manual-model')).not.toBeHidden();
    await page.selectOption('#manual-model', { index: 1 });
    await shot(page, dir, '02a-version-channel-selected', testInfo);
    await page.click('#btn-manual-confirm');

    // Patches config
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await shot(page, dir, '03-patches-config', testInfo);

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
    // Edit a different patch than the one selected above (the first, near the top
    // of the list) so the selection count carries through and the badge is
    // prominently visible in the modified-indicator shot.
    const editTarget = section
        .locator('.patch-item')
        .filter({ has: page.locator('.patch-edit-btn') })
        .first();
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

// ============================================================
// 4. Connected NickelMenu flow
// ============================================================

test('connected nickelmenu', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.connectedNickelMenu;
    const isMobile = testInfo.project.name === 'mobile';

    await page.goto('/');
    if (isMobile) {
        await expect(page.locator('#mobile-dialog')).toBeVisible();
        await shot(page, dir, '00-mobile-warning', testInfo);
        await page.click('#btn-mobile-continue');
    }
    await expect(page.locator('#step-connect')).not.toBeHidden();
    await injectMockDevice(page);
    await shot(page, dir, '01-connect', testInfo);

    // Connection instructions
    await page.click('#btn-connect');
    await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
    await shot(page, dir, '02-connect-instructions', testInfo);

    // Device detected
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();
    await shot(page, dir, '03-device', testInfo);

    // Mode selection — select NickelMenu, screenshot, then proceed
    await page.click('#btn-device-next');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="nickelmenu"]');
    await shot(page, dir, '04-mode-selection', testInfo);
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await shot(page, dir, '05-nickelmenu-config', testInfo);

    // Preset → features
    await page.click('input[value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await shot(page, dir, '06-nickelmenu-features', testInfo);
    await shotNickelMenuCustomizeModal(page, dir, '06a-nickelmenu-customize-modal', testInfo);

    // Features → backup → review
    await page.click('#btn-nm-features-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await shot(page, dir, '07-nickelmenu-backup', testInfo);
    await page.click('#btn-nm-backup-next');
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await shot(page, dir, '08-nickelmenu-review', testInfo);

    // Write to device → done
    await page.click('#btn-nm-write');
    const nmDone = page.locator('#step-nm-done');
    await expect(nmDone).not.toBeHidden();
    await shot(page, dir, '09-nickelmenu-done', testInfo);
});

// ============================================================
// 5. Connected NickelMenu preset conflict
// ============================================================

test('connected nickelmenu preset conflict', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.connectedNickelMenu;
    const isMobile = testInfo.project.name === 'mobile';

    await page.goto('/');
    if (isMobile) {
        await page.click('#btn-mobile-continue');
        await expect(page.locator('#mobile-dialog')).not.toBeVisible();
    }

    await injectMockDevice(page, {
        hasNickelDbus: true,
        hasNickelSeries: true,
        hasNickelClock: true,
    });

    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();

    await page.click('#btn-device-next');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();

    await page.click('input[value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-preset-conflict')).not.toBeHidden();
    await shot(page, dir, '06a-nickelmenu-preset-conflict', testInfo);
});

// ============================================================
// 5b. Connected NickelMenu — older device + KOReader (two review warnings)
// ============================================================

test('connected nickelmenu review notices — older device + KOReader', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.connectedNickelMenu;

    await makeKOReaderAvailable(page);
    await page.goto('/');
    await dismissMobileModal(page);

    // Kobo Aura HD (N204) is an older model with no Dark mode support, so the
    // preset drops the Dark Mode item and warns about it. Combined with KOReader's
    // known-issue notice, the review step shows two warnings.
    await injectMockDevice(page, {
        serial: 'N204E0000000000',
        hardwareId: '00000000-0000-0000-0000-000000000350',
    });

    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();

    await page.click('#btn-device-next');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[value="preset"]');
    await page.click('#btn-nm-next');

    // Enable KOReader so a second warning joins the Dark Mode one at review.
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await page.check('input[name="nm-cfg-koreader"]');
    await page.click('#btn-nm-features-next');

    // Backup → review
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    if (await page.locator('#nm-backup-options').isVisible()) {
        await page.click('input[name="nm-backup-option"][value="skip"]');
    }
    await page.click('#btn-nm-backup-next');

    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-notices')).toContainText('Dark Mode is not supported');
    await expect(page.locator('#nm-review-notices')).toContainText('Known issue with KOReader');
    await shot(page, dir, '08b-nickelmenu-review-two-warnings', testInfo);
});

// ============================================================
// 5c. Connected NickelMenu removal flow
//
// Removal is its own path with phases that don't exist in the install flow:
// the removal options (which optional features to uninstall alongside
// NickelMenu), the removal-styled review, and a "removing on reboot" done
// screen. Captured here as a standalone flow rather than mixed into the
// install screenshots above.
// ============================================================

test('connected nickelmenu removal', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.connectedNickelMenuRemoval;
    const isMobile = testInfo.project.name === 'mobile';

    await page.goto('/');
    if (isMobile) {
        await page.click('#btn-mobile-continue');
        await expect(page.locator('#mobile-dialog')).not.toBeVisible();
    }

    // NickelMenu already installed, plus optional features that can be removed
    // alongside it, so the removal options and review list more than one entry.
    await injectMockDevice(page, {
        hasNickelMenu: true,
        hasKOReader: true,
        hasAdditionalFonts: true,
    });

    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();

    await page.click('#btn-device-next');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    // Removal options — selecting "remove" reveals the optional-feature cleanup
    // checkboxes (pre-checked for each detected feature).
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[name="nm-option"][value="remove"]');
    await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();
    await shot(page, dir, '01-removal-options', testInfo);

    // Uncheck the additional fonts so the review shows them under the "kept" card.
    await page.uncheck('input[name="nm-uninstall-additional-fonts"]');
    await page.click('#btn-nm-next');

    // Connected remove goes through backup → review (no manual-remove step).
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    if (await page.locator('#nm-backup-options').isVisible()) {
        await page.click('input[name="nm-backup-option"][value="skip"]');
    }
    await page.click('#btn-nm-backup-next');

    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await shot(page, dir, '02-removal-review', testInfo);

    // Write to device → done (NickelMenu removed on next reboot).
    await page.click('#btn-nm-write');
    const nmDone = page.locator('#step-nm-done');
    await expect(nmDone).not.toBeHidden();
    await expect(page.locator('#nm-reboot-instructions')).not.toBeHidden();
    await shot(page, dir, '03-removal-done', testInfo);
});

// Variant: every cleanup checkbox left checked, so the review has no "kept" card.
test('connected nickelmenu removal (no kept features)', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.connectedNickelMenuRemoval;
    const isMobile = testInfo.project.name === 'mobile';

    await page.goto('/');
    if (isMobile) {
        await page.click('#btn-mobile-continue');
        await expect(page.locator('#mobile-dialog')).not.toBeVisible();
    }

    await injectMockDevice(page, {
        hasNickelMenu: true,
        hasKOReader: true,
        hasAdditionalFonts: true,
    });

    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();

    await page.click('#btn-device-next');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[name="nm-option"][value="remove"]');
    // Leave every cleanup checkbox checked so nothing is kept.
    await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();
    await page.click('#btn-nm-next');

    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    if (await page.locator('#nm-backup-options').isVisible()) {
        await page.click('input[name="nm-backup-option"][value="skip"]');
    }
    await page.click('#btn-nm-backup-next');

    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-kept')).toBeHidden();
    await shot(page, dir, '02a-removal-review-no-kept', testInfo);
});

// ============================================================
// 5d. Busy indicator (install in progress)
// ============================================================

test('connected nickelmenu installing (busy indicator)', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.connectedNickelMenu;

    await page.goto('/');
    await dismissMobileModal(page);

    // The install step is transient, so force it visible with a representative
    // progress message to capture the busy-indicator styling on its own.
    await page.evaluate(() => {
        for (const step of document.querySelectorAll('.step')) step.hidden = true;
        document.getElementById('step-nm-installing').hidden = false;
        document.getElementById('nm-progress').textContent = 'Writing files to Kobo (3 of 12)...';
    });

    await expect(page.locator('#step-nm-installing .busy-indicator')).toBeVisible();
    await shot(page, dir, '09a-nickelmenu-installing', testInfo);
});

// Individual asset download (e.g. KOReader): the file being downloaded stays on
// the status line, with the byte/percent progress and its bar on the line below.
test('connected nickelmenu downloading asset (progress detail)', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.connectedNickelMenu;

    await page.goto('/');
    await dismissMobileModal(page);

    await page.evaluate(() => {
        for (const step of document.querySelectorAll('.step')) step.hidden = true;
        document.getElementById('step-nm-installing').hidden = false;
        document.getElementById('nm-progress').textContent = 'Downloading KOReader 2024.04...';
        const detail = document.getElementById('nm-progress-detail');
        detail.hidden = false;
        detail.querySelector('.busy-progress-text').textContent = '6.4 MB / 18.2 MB (35%)';
        detail.querySelector('.busy-progress-fill').style.width = '35%';
    });

    await expect(page.locator('#step-nm-installing #nm-progress-detail')).toBeVisible();
    await shot(page, dir, '09b-nickelmenu-downloading-asset', testInfo);
});

test('connected nickelmenu failed write error', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeDeviceWrite;

    await page.goto('/');
    await dismissMobileModal(page);
    await injectMockDevice(page, {
        failWritePaths: ['KOBOeReader/.kobo/KoboRoot.tgz'],
    });

    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();

    await page.click('#btn-device-next');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');

    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[value="preset"]');
    await page.click('#btn-nm-next');

    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await page.click('#btn-nm-features-next');

    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    if (await page.locator('#nm-backup-options').isVisible()) {
        await page.click('input[name="nm-backup-option"][value="skip"]');
    }
    await page.click('#btn-nm-backup-next');

    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await page.click('#btn-nm-write');

    await expect(page.locator('#step-error')).not.toBeHidden();
    await expect(page.locator('#error-title')).toContainText('Writing to your device didn’t work');
    await expect(page.locator('#error-message')).toContainText('partly applied');
    // Connection tips are shown inline, no longer behind a disclosure panel.
    await expect(page.locator('#error-device-write-help')).toBeVisible();
    await expect(page.locator('#error-device-write-help ol li')).toHaveCount(3);
    await expect(page.locator('#btn-error-download-log')).toBeVisible();
    await shot(page, dir, 'failed-write', testInfo);
});

test('connected nickelmenu preflight read error', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeDeviceWrite;

    await page.goto('/');
    await dismissMobileModal(page);
    await injectMockDevice(page, {
        failReadPaths: ['.kobo/Kobo/Kobo eReader.conf'],
    });

    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();

    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    await page.click('#btn-nm-features-next');

    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    if (await page.locator('#nm-backup-options').isVisible()) {
        await page.click('input[name="nm-backup-option"][value="skip"]');
    }
    await page.click('#btn-nm-backup-next');

    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await page.click('#btn-nm-write');

    await expect(page.locator('#step-error')).not.toBeHidden();
    await expect(page.locator('#error-message')).toContainText('An important configuration file could not be read');
    await expect(page.locator('#error-device-write-help')).toBeVisible();
    await expect(page.locator('#error-device-write-help ol li')).toHaveCount(3);
    await shot(page, dir, 'preflight-read-failed-no-changes', testInfo);
});

test('connected device failed write probe', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeDeviceWrite;

    await page.goto('/');
    await dismissMobileModal(page);
    // The connect-time write probe writes (and removes) a small file in the
    // device root. Failing that write means a direct install isn't safe, so the
    // flow stops at connect with the device-write recovery guidance.
    await injectMockDevice(page, {
        failWritePaths: ['KOBOeReader/.kobopatch-webui-probe'],
    });

    await page.click('#btn-connect');
    await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
    await page.click('#btn-connect-ready');

    await expect(page.locator('#step-error')).not.toBeHidden();
    await expect(page.locator('#error-title')).toContainText('Connection to device failed');
    await expect(page.locator('#error-message')).toContainText('A small test file to verify your device can be written to');
    await expect(page.locator('#error-device-write-help')).not.toBeHidden();
    await shot(page, dir, 'failed-write-probe', testInfo);
});

test('connect blocked permission', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeConnection;

    // Simulate the browser denying read/write access to the picked folder.
    await page.addInitScript(() => {
        window.showDirectoryPicker = async () => {
            const err = new Error('Permission denied');
            err.name = 'NotAllowedError';
            throw err;
        };
    });
    await page.goto('/');
    await dismissMobileModal(page);

    await page.click('#btn-connect');
    await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
    await page.click('#btn-connect-ready');

    await expect(page.locator('#step-error')).not.toBeHidden();
    await expect(page.locator('#error-title')).toContainText('Access to your device was blocked');
    await shot(page, dir, 'connect-permission-denied', testInfo);
});

test('unexpected error safety net', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeConnection;

    await page.goto('/');
    await dismissMobileModal(page);
    // An exception escaping every explicit handler still surfaces a screen.
    await page.evaluate(() => {
        window.dispatchEvent(
            new ErrorEvent('error', {
                error: new Error('Something exploded'),
                message: 'Something exploded',
            }),
        );
    });

    await expect(page.locator('#step-error')).not.toBeHidden();
    await expect(page.locator('#error-title')).toContainText('Something went wrong');
    await shot(page, dir, 'unexpected-error', testInfo);
});

test('download archive failure', async ({ page }, testInfo) => {
    test.skip(!hasFirmwareZip(), 'Firmware zip not available');
    const dir = SCREENSHOT_DIRS.edgeDownload;

    await page.goto('/');
    await injectMockDevice(page);
    await page.waitForFunction(() => !!window.FIRMWARE_DOWNLOADS);
    await overrideFirmwareURLs(page);
    await dismissMobileModal(page);

    await page.click('#btn-manual');
    await expect(page.locator('#step-mode')).not.toBeHidden();
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');

    await expect(page.locator('#step-manual-version')).not.toBeHidden();
    await page.selectOption('#manual-version', { index: 1 });
    await expect(page.locator('#manual-model')).not.toBeHidden();
    await page.selectOption('#manual-model', { index: 1 });
    await page.click('#btn-manual-confirm');

    await expect(page.locator('#step-patches')).not.toBeHidden();
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
    await expect(page.locator('#step-done')).toBeVisible({ timeout: 60_000 });

    // Force archive creation to fail, then attempt the download.
    await page.evaluate(() => {
        URL.createObjectURL = () => {
            throw new Error('forced download failure');
        };
    });
    await page.click('#btn-download');

    await expect(page.locator('#step-error')).not.toBeHidden();
    await expect(page.locator('#error-title')).toContainText('Preparing the download didn’t work');
    await shot(page, dir, 'download-failure', testInfo);
});

// ============================================================
// 6. Connected Patches flow
// ============================================================

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

    // After restoring, the banner confirms success.
    await page.click('#btn-patch-reload');
    await expect(page.locator('#patch-reload-banner')).toContainText('reloaded');
    await shot(page, dir, '12-patches-reload-applied', testInfo);
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

test('unsupported browser', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeConnection;
    await page.addInitScript(() => {
        delete window.showDirectoryPicker;
    });
    await page.goto('/');
    await dismissMobileModal(page);
    await expect(page.locator('#connect-unsupported-hint')).toBeVisible();
    await shot(page, dir, 'unsupported-browser', testInfo);
});

test('incompatible firmware', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeCompatibility;
    await connectToDeviceScreen(page, { firmware: '5.0.0' });
    await shot(page, dir, 'incompatible-firmware', testInfo);
});

test('device verified by UUID and serial prefix', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeCompatibility;
    await connectToDeviceScreen(page);
    await shot(page, dir, 'device-verified', testInfo);

    await page.locator('#device-model .device-identification-badge--verified').hover();
    await shot(page, dir, 'device-verified-hint', testInfo);
});

test('device serial prefix mismatch', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeCompatibility;
    await connectToDeviceScreen(page, {
        serial: 'X9990A0000000',
        firmware: '4.38.23648',
        hardwareId: '00000000-0000-0000-0000-000000000388',
    });
    await shot(page, dir, 'serial-prefix-mismatch', testInfo);

    await page.locator('#device-model .device-identification-badge--mismatch').hover();
    await shot(page, dir, 'serial-prefix-mismatch-hint', testInfo);
});

test('refurbished device verified by UUID', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeCompatibility;
    await connectToDeviceScreen(page, {
        serial: 'R4180A0000000',
        firmware: '4.38.23648',
        hardwareId: '00000000-0000-0000-0000-000000000388',
    });
    await shot(page, dir, 'refurbished-device-verified', testInfo);

    await page.locator('#device-model .device-refurbished-marker').hover();
    await shot(page, dir, 'refurbished-device-marker-hint', testInfo);

    await page.locator('#device-model .device-identification-badge--refurbished').hover();
    await shot(page, dir, 'refurbished-device-verified-hint', testInfo);
});

test('unknown model', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeCompatibility;
    await connectToDeviceScreen(page, {
        serial: 'X9990A0000000',
        hardwareId: '00000000-0000-0000-0000-999999999999',
    });
    await shot(page, dir, 'unknown-model', testInfo);
});

test('disclaimer dialog', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeDialogs;
    await page.goto('/');
    await dismissMobileModal(page);
    await page.click('#btn-how-it-works');
    await expect(page.locator('#how-it-works-dialog')).toBeVisible();
    await shot(page, dir, 'disclaimer-dialog', testInfo);
});

test('analytics feedback thumbs', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeAnalytics;
    await page.addInitScript(() => {
        window.__ANALYTICS_ENABLED = true;
        window.umami = { track: () => {} };
    });
    await page.goto('/');
    await dismissMobileModal(page);
    await page.evaluate(() => {
        for (const step of document.querySelectorAll('.step')) step.hidden = true;
        document.getElementById('step-done').hidden = false;
        document.getElementById('step-nav').hidden = false;
        document.getElementById('build-status').innerHTML =
            'Patching complete. <strong>KoboRoot.tgz</strong> (1.2 MB) is ready. Download the file and copy it to your Kobo.';
        document.getElementById('done-log').textContent = 'Dummy analytics screenshot instance.';

        const feedback = document.querySelector('#step-done .feedback');
        feedback.hidden = false;
        feedback.querySelector('.feedback-text').hidden = false;
        feedback.querySelector('.feedback-thanks').hidden = true;
        feedback.querySelectorAll('.feedback-btn').forEach((button) => {
            button.hidden = false;
            button.disabled = false;
        });
    });

    await page.locator('#step-done .feedback-btn--up').hover();
    await shot(page, dir, 'feedback-thumbs-up', testInfo);

    await page.locator('#step-done .feedback-btn--down').hover();
    await shot(page, dir, 'feedback-thumbs-down', testInfo);
});

// Walk a connected device to the preset feature-selection step.
const goToNmFeaturesForShot = async (page) => {
    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
};

// ============================================================
// 6a. Backup step with legacy config detected as previously
//     generated by KoboPatch Web UI (checkbox unchecked).
// ============================================================

test('connected nickelmenu legacy config detected as ours', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeNickelMenu;
    await page.goto('/');
    await dismissMobileModal(page);
    await injectMockDevice(page, { hasNickelMenu: true });

    // Replace the default items content with one that contains our heuristic
    // string ("Toggle Typography") so the flow detects it as ours.
    await page.evaluate(() => {
        window.__mockFS['.adds']['nm']['items'] = {
            _type: 'file',
            content: [
                'experimental :menu_main_15505_label :Toggle',
                'experimental :menu_main_15505_icon :/mnt/onboard/.adds/nm/.cog.png',
                'menu_item :main :Toggle Typography :cmd_output :7000 :/mnt/onboard/.adds/scripts/toggle_typography.sh',
            ].join('\n'),
        };
    });

    await goToNmFeaturesForShot(page);

    // Features → backup (show the keep-config checkbox, unchecked by default)
    await page.click('#btn-nm-features-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await expect(page.locator('#nm-keep-config-option')).toBeVisible();
    await expect(page.locator('#nm-keep-items')).not.toBeChecked();
    await shot(page, dir, 'legacy-config-ours', testInfo);
});

// ============================================================
// 6b. Backup step with legacy config detected as NOT generated
//     by KoboPatch Web UI (checkbox checked).
// ============================================================

test('connected nickelmenu legacy config detected as manual', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeNickelMenu;
    await page.goto('/');
    await dismissMobileModal(page);
    // Default items content ("menu_item:main:test:skip:") does not contain
    // any heuristic strings, so the flow treats it as a manual config.
    await injectMockDevice(page, { hasNickelMenu: true });
    await goToNmFeaturesForShot(page);

    // Features → backup (show the keep-config checkbox, checked by default)
    await page.click('#btn-nm-features-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await expect(page.locator('#nm-keep-config-option')).toBeVisible();
    await expect(page.locator('#nm-keep-items')).toBeChecked();
    await shot(page, dir, 'legacy-config-manual', testInfo);
});

// Full journey for a factory-reset Kobo that was never signed in: the
// recommendation, choosing Sideload Mode, the review summary with its warning,
// and the done screen.
test('connected nickelmenu factory reset sideload', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.connectedNickelMenuFactory;
    await page.goto('/');
    await dismissMobileModal(page);
    await injectMockDevice(page, { signedIn: false });
    await goToNmFeaturesForShot(page);

    // Recommendation banner, with the Advanced section auto-expanded so the
    // Sideload Mode option is visible.
    await expect(page.locator('#nm-sideloaded-banner')).toBeVisible();
    await shot(page, dir, '01-recommendation', testInfo);

    // Choose Sideload Mode.
    await page.check('input[name="nm-cfg-sideloaded-mode"]');
    await shot(page, dir, '02-sideload-selected', testInfo);

    // Backup → review: the summary lists the selection and warns what it does.
    await page.click('#btn-nm-features-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await page.click('#btn-nm-backup-next');
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    await expect(page.locator('#nm-review-notices')).toContainText('Home tab is hidden');
    await shot(page, dir, '03-review', testInfo);

    // Write to device → done.
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).not.toBeHidden();
    await shot(page, dir, '04-done', testInfo);
});

// Edge case: Kobo software older than Sideload Mode's 4.31 minimum. The option
// is shown disabled with a red explanation; no recommendation banner.
test('Sideload Mode too old os', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeNickelMenu;
    await page.goto('/');
    await dismissMobileModal(page);
    await injectMockDevice(page, { firmware: '4.28.17820', signedIn: false });
    await goToNmFeaturesForShot(page);
    // Open the (collapsed) Advanced section so the disabled option is visible.
    await page.locator('summary.nm-config-section-heading').filter({ hasText: 'Advanced' }).click();
    await expect(page.locator('.nm-config-disabled-reason')).toBeVisible();
    await shot(page, dir, 'sideloaded-mode-too-old-os', testInfo);
});
