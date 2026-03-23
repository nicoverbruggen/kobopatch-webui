/**
 * Capture screenshots of every step in the wizard.
 * Uses the same Playwright test infrastructure and dev server as the E2E tests.
 * Runs once per project (mobile + desktop) defined in screenshots.config.js.
 *
 * Run: ./run-screenshots.sh
 */
import { test, expect } from '@playwright/test';
import { injectMockDevice } from './helpers/mock-device.js';

const shot = async (page, name, testInfo) => {
  const project = testInfo.project.name;
  await page.waitForTimeout(200);
  await page.screenshot({ path: `screenshots/${project}/${name}.png`, fullPage: true });
};

test('capture all steps', async ({ page }, testInfo) => {
  // 1. Connect step
  await page.goto('/');
  await expect(page.locator('#step-connect')).not.toBeHidden();
  await injectMockDevice(page);
  await shot(page, '01-connect', testInfo);

  // 2. Connection instructions
  await page.click('#btn-connect');
  await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
  await shot(page, '02-connect-instructions', testInfo);

  // 2b. Connection instructions with disclaimer open
  await page.click('.disclaimer summary');
  await page.waitForTimeout(100);
  await shot(page, '03-connect-instructions-disclaimer', testInfo);

  // 3. Device detected
  await page.click('#btn-connect-ready');
  await expect(page.locator('#step-device')).not.toBeHidden();
  await shot(page, '04-device', testInfo);

  // 4. Mode selection
  await page.click('#btn-device-next');
  await expect(page.locator('#step-mode')).not.toBeHidden();
  await shot(page, '05-mode-selection', testInfo);

  // 5a. NickelMenu config
  await page.click('input[name="mode"][value="nickelmenu"]');
  await page.click('#btn-mode-next');
  await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
  await shot(page, '06-nickelmenu-config', testInfo);

  // 5b. NickelMenu features (preset)
  await page.click('input[value="preset"]');
  await page.click('#btn-nm-next');
  await expect(page.locator('#step-nm-features')).not.toBeHidden();
  await shot(page, '07-nickelmenu-features', testInfo);

  // 5c. NickelMenu review
  await page.click('#btn-nm-features-next');
  await expect(page.locator('#step-nm-review')).not.toBeHidden();
  await shot(page, '08-nickelmenu-review', testInfo);

  // Go back to mode and try patches path
  await page.click('#btn-nm-review-back');
  await page.click('#btn-nm-features-back');
  await page.click('#btn-nm-back');
  await expect(page.locator('#step-mode')).not.toBeHidden();
  await page.click('input[name="mode"][value="patches"]');
  await page.click('#btn-mode-next');
  await expect(page.locator('#step-patches')).not.toBeHidden();
  await shot(page, '09-patches-config', testInfo);

  // 6b. Expand a patch section and select a patch
  const section = page.locator('.patch-file-section').first();
  await section.locator('summary').click();
  const patchLabel = section.locator('label').filter({ has: page.locator('.patch-name:not(.patch-name-none)') }).first();
  await patchLabel.locator('input').check();
  await shot(page, '10-patches-selected', testInfo);
});

test('incompatible firmware', async ({ page }, testInfo) => {
  await page.goto('/');
  await injectMockDevice(page, { firmware: '5.0.0' });
  await page.click('#btn-connect');
  await page.click('#btn-connect-ready');
  await expect(page.locator('#step-device')).not.toBeHidden();
  await shot(page, '11-device-incompatible', testInfo);
});

test('unknown model', async ({ page }, testInfo) => {
  await page.goto('/');
  await injectMockDevice(page, { serial: 'X9990A0000000' });
  await page.click('#btn-connect');
  await page.click('#btn-connect-ready');
  await expect(page.locator('#step-device')).not.toBeHidden();
  await shot(page, '12-device-unknown', testInfo);
});

test('unsupported browser', async ({ page }, testInfo) => {
  await page.addInitScript(() => { delete window.showDirectoryPicker; });
  await page.goto('/');
  await expect(page.locator('#connect-unsupported-hint')).toBeVisible();
  await shot(page, '13-connect-unsupported', testInfo);
});

test('disclaimer dialog', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.click('#btn-how-it-works');
  await expect(page.locator('#how-it-works-dialog')).toBeVisible();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `screenshots/${testInfo.project.name}/14-disclaimer-dialog.png` });
});
