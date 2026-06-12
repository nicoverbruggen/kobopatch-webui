/**
 * Capture screenshots of every step in the wizard.
 * Uses the same Playwright test infrastructure and dev server as the E2E tests.
 * Runs once per project (mobile + desktop) defined in screenshots.config.js.
 *
 * Run: ./run-screenshots.sh
 */
import { test, expect } from '@playwright/test';
import { injectMockDevice, overrideFirmwareURLs } from '../support/mock-device.js';
import { hasFirmwareZip } from '../support/assets.js';

const shot = async (page, folder, name, testInfo) => {
  const project = testInfo.project.name;
  await page.waitForTimeout(200);
  await page.screenshot({ path: `screenshots/${project}/${folder}/${name}.png`, fullPage: true });
};

/** Dismiss the mobile warning modal if it's open. */
const dismissMobileModal = async (page) => {
  const dialog = page.locator('#mobile-dialog');
  if (await dialog.evaluate(el => el.open).catch(() => false)) {
    await page.click('#btn-mobile-continue');
    await expect(dialog).not.toBeVisible();
  }
};

const makeKOReaderAvailable = async (page) => {
  await page.route('**/assets/koreader-release.json', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 'v2026.03' }),
    });
  });
};

// ============================================================
// 1. Manual NickelMenu flow
// ============================================================

test('manual nickelmenu', async ({ page }, testInfo) => {
  const dir = 'manual-nickelmenu';
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
  const dir = 'manual-nickelmenu';
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
  const dir = 'manual-nickelmenu';

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

  const dir = 'manual-patches';
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

  // Select firmware version and model
  await page.selectOption('#manual-version', { index: 1 });
  await expect(page.locator('#manual-model')).not.toBeHidden();
  await page.selectOption('#manual-model', { index: 1 });
  await page.click('#btn-manual-confirm');

  // Patches config
  await expect(page.locator('#step-patches')).not.toBeHidden();
  await shot(page, dir, '03-patches-config', testInfo);

  // Expand section and select a standalone (checkbox) patch.
  const section = page.locator('.patch-file-section').first();
  await section.locator('summary').click();
  const patchLabel = section.locator('label').filter({ has: page.locator('input[type="checkbox"]') }).first();
  await patchLabel.locator('input').check();
  await shot(page, dir, '04-patches-selected', testInfo);

  // Patch editor — open, validate an edit, and show the "modified" indicator.
  // Edit a different patch than the one selected above (the first, near the top
  // of the list) so the selection count carries through and the badge is
  // prominently visible in the modified-indicator shot.
  const editTarget = section.locator('.patch-item').filter({ has: page.locator('.patch-edit-btn') }).first();
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

// ============================================================
// 4. Connected NickelMenu flow
// ============================================================

test('connected nickelmenu', async ({ page }, testInfo) => {
  const dir = 'connected-nickelmenu';
  const isMobile = testInfo.project.name === 'mobile';

  await page.goto('/');
  if (isMobile) {
    await expect(page.locator('#mobile-dialog')).toBeVisible();
    await page.screenshot({ path: `screenshots/mobile/${dir}/00-mobile-warning.png` });
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
  const dir = 'connected-nickelmenu';
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
  const dir = 'connected-nickelmenu';

  await makeKOReaderAvailable(page);
  await page.goto('/');
  await dismissMobileModal(page);

  // Kobo Aura HD (N204) is an older model with no Dark mode support, so the
  // preset drops the Dark Mode item and warns about it. Combined with KOReader's
  // known-issue notice, the review step shows two warnings.
  await injectMockDevice(page, { serial: 'N204E0000000000' });

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
  const dir = 'connected-nickelmenu-removal';
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
  const dir = 'connected-nickelmenu-removal';
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
  const dir = 'connected-nickelmenu';

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

// ============================================================
// 6. Connected Patches flow
// ============================================================

test('connected patches', async ({ page }, testInfo) => {
  test.skip(!hasFirmwareZip(), 'Firmware zip not available');

  const dir = 'connected-patches';
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
  const patchLabel = section.locator('label').filter({ has: page.locator('.patch-name:not(.patch-name-none)') }).first();
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

  // Download
  await page.click('#btn-download');
  await expect(stepDone.locator('#download-instructions')).toBeVisible();
  await shot(page, dir, '09-patches-done-download', testInfo);
});

// ============================================================
// 7. Edge cases
// ============================================================

test('unsupported browser', async ({ page }, testInfo) => {
  const dir = 'edge-cases';
  await page.addInitScript(() => { delete window.showDirectoryPicker; });
  await page.goto('/');
  await dismissMobileModal(page);
  await expect(page.locator('#connect-unsupported-hint')).toBeVisible();
  await shot(page, dir, 'unsupported-browser', testInfo);
});

test('incompatible firmware', async ({ page }, testInfo) => {
  const dir = 'edge-cases';
  await page.goto('/');
  await dismissMobileModal(page);
  await injectMockDevice(page, { firmware: '5.0.0' });
  await page.click('#btn-connect');
  await page.click('#btn-connect-ready');
  await expect(page.locator('#step-device')).not.toBeHidden();
  await shot(page, dir, 'incompatible-firmware', testInfo);
});

test('unknown model', async ({ page }, testInfo) => {
  const dir = 'edge-cases';
  await page.goto('/');
  await dismissMobileModal(page);
  await injectMockDevice(page, { serial: 'X9990A0000000' });
  await page.click('#btn-connect');
  await page.click('#btn-connect-ready');
  await expect(page.locator('#step-device')).not.toBeHidden();
  await shot(page, dir, 'unknown-model', testInfo);
});

test('disclaimer dialog', async ({ page }, testInfo) => {
  const dir = 'edge-cases';
  await page.goto('/');
  await dismissMobileModal(page);
  await page.click('#btn-how-it-works');
  await expect(page.locator('#how-it-works-dialog')).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `screenshots/${testInfo.project.name}/${dir}/disclaimer-dialog.png` });
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
  const dir = 'edge-cases';
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
  const dir = 'edge-cases';
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
// recommendation, choosing Sideload mode, the review summary with its warning,
// and the done screen.
test('connected nickelmenu factory reset sideload', async ({ page }, testInfo) => {
  const dir = 'connected-nickelmenu-factory';
  await page.goto('/');
  await dismissMobileModal(page);
  await injectMockDevice(page, { signedIn: false });
  await goToNmFeaturesForShot(page);

  // Recommendation banner, with the Advanced section auto-expanded so the
  // Sideload mode option is visible.
  await expect(page.locator('#nm-sideloaded-banner')).toBeVisible();
  await shot(page, dir, '01-recommendation', testInfo);

  // Choose Sideload mode.
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

// Edge case: Kobo software older than Sideload mode's 4.31 minimum. The option
// is shown disabled with a red explanation; no recommendation banner.
test('Sideload mode too old os', async ({ page }, testInfo) => {
  const dir = 'edge-cases';
  await page.goto('/');
  await dismissMobileModal(page);
  await injectMockDevice(page, { firmware: '4.28.17820', signedIn: false });
  await goToNmFeaturesForShot(page);
  // Open the (collapsed) Advanced section so the disabled option is visible.
  await page.locator('summary.nm-config-section-heading').filter({ hasText: 'Advanced' }).click();
  await expect(page.locator('.nm-config-disabled-reason')).toBeVisible();
  await shot(page, dir, 'sideloaded-mode-too-old-os', testInfo);
});
