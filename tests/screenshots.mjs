/**
 * Capture screenshots of every step in the wizard.
 * Uses the same Playwright test infrastructure and dev server as the E2E tests.
 * Runs once per project (mobile + desktop) defined in screenshots.config.js.
 *
 * Run: ./run-screenshots.sh
 */
import { test, expect } from '@playwright/test';
import { injectMockDevice, overrideFirmwareURLs } from './helpers/mock-device.js';
import { hasFirmwareZip } from './helpers/assets.js';

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
// 2. Manual Patches flow
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

  // Expand section and select a patch
  const section = page.locator('.patch-file-section').first();
  await section.locator('summary').click();
  const patchLabel = section.locator('label').filter({ has: page.locator('.patch-name:not(.patch-name-none)') }).first();
  await patchLabel.locator('input').check();
  await shot(page, dir, '04-patches-selected', testInfo);

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
// 3. Connected NickelMenu flow
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
// 4. Connected Patches flow
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
// 5. Edge cases
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
