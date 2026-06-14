// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const JSZip = require('jszip');

const { FIRMWARE_PATH, getOriginalTgzSha1 } = require('../support/paths');
const { hasFirmwareZip } = require('../support/assets');
const { injectMockDevice, connectMockDevice, overrideFirmwareURLs, goToManualMode, readMockFile, getWrittenFiles } = require('../support/mock-device');
const { parseTar } = require('../support/tar');

/**
 * Read a downloaded patches ZIP and return the embedded KoboRoot.tgz bytes.
 * The download bundles `.kobo/KoboRoot.tgz` alongside the custom-patches manifest.
 */
async function extractKoboRootTgz(download) {
  const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
  return zip.file('.kobo/KoboRoot.tgz').async('nodebuffer');
}

/**
 * Drive the manual flow up to a loaded patches step for 4.45.23646 / N428.
 * Collapses the version → model → confirm sequence that nearly every patch
 * test repeats. Leaves the page on #step-patches with sections rendered.
 */
async function gotoManualPatchesStep(page) {
  await goToManualMode(page);
  await page.click('input[name="mode"][value="patches"]');
  await page.click('#btn-mode-next');
  await expect(page.locator('#step-manual-version')).not.toBeHidden();
  await overrideFirmwareURLs(page);
  await page.selectOption('#manual-version', '4.45.23646');
  await page.selectOption('#manual-model', 'N428');
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

    // Select Kobo Libra Colour (N428)
    await page.selectOption('#manual-model', 'N428');
    await expect(page.locator('#btn-manual-confirm')).toBeEnabled();
    await page.click('#btn-manual-confirm');

    // Wait for patches to load
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);

    // Enable "Remove footer (row3) on new home screen"
    const patchName = page.locator('.patch-name', { hasText: 'Remove footer (row3) on new home screen' }).first();
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
    await expect(page.locator('#firmware-device-label')).toHaveText('Kobo Libra Colour');

    // Build and wait for completion
    await page.click('#btn-build');

    const doneOrError = await Promise.race([
      page.locator('#step-done').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'done'),
      page.locator('#step-error').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'error'),
    ]);

    if (doneOrError === 'error') {
      const errorMsg = await page.locator('#error-message').textContent();
      throw new Error(`Build failed: ${errorMsg}`);
    }

    await expect(page.locator('#build-status')).toContainText('Patching complete');
    await expect(page.locator('#build-status')).toContainText('Kobo Libra Colour');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-download'),
    ]);

    expect(download.suggestedFilename()).toBe('custom-patches.zip');
    await expect(page.locator('#download-device-name')).toHaveText('Kobo Libra Colour');
    // The screen points users at the bundled instructions.txt file.
    await expect(page.locator('#download-instructions')).toContainText('instructions.txt');

    // The ZIP bundles plain-text instructions naming the selected device, with
    // the credit header and the hard-lock disclaimer.
    const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
    expect(Object.keys(zip.files)).toContain('instructions.txt');
    const instructions = await zip.file('instructions.txt').async('string');
    expect(instructions).toContain('Generated by KoboPatch Web UI');
    expect(instructions).toContain('Connect your Kobo Libra Colour via USB');
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
    await page.selectOption('#manual-model', 'N428');
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
      page.locator('#step-done').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'done'),
      page.locator('#step-error').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'error'),
    ]);

    if (doneOrError === 'error') {
      const errorMsg = await page.locator('#error-message').textContent();
      throw new Error(`Restore failed: ${errorMsg}`);
    }

    await expect(page.locator('#build-status')).toContainText('Software extracted');

    // Download the ZIP and verify the embedded KoboRoot.tgz matches the original
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-download'),
    ]);

    expect(download.suggestedFilename()).toBe('custom-patches.zip');
    const tgzData = await extractKoboRootTgz(download);
    const actualHash = crypto.createHash('sha1').update(tgzData).digest('hex');
    expect(actualHash, 'restored KoboRoot.tgz SHA1 mismatch').toBe(await getOriginalTgzSha1());
  });


  test('with device — incompatible version 5.x shows error', async ({ page }) => {
    await page.goto('/');
    await injectMockDevice(page, { firmware: '5.0.0' });
    await page.click('#btn-connect');
    await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
    await page.click('#btn-connect-ready');

    // Device info should be displayed
    await expect(page.locator('#step-device')).not.toBeHidden();
    await expect(page.locator('#device-model')).toHaveText('Kobo Libra Colour');
    await expect(page.locator('#device-firmware')).toHaveText('5.0.0');

    // Status message should show incompatibility warning
    await expect(page.locator('#device-status')).toContainText('incompatible');
    await expect(page.locator('#device-status')).toContainText('NickelMenu does not support it');
    await expect(page.locator('#device-status')).toHaveClass(/error/);

    // Continue and restore buttons should be hidden, but Back should be visible
    await expect(page.locator('#btn-device-next')).toBeHidden();
    await expect(page.locator('#btn-device-restore')).toBeHidden();
    await expect(page.locator('#btn-device-back')).toBeVisible();

    // Back should return to connect step
    await page.click('#btn-device-back');
    await expect(page.locator('#step-connect')).not.toBeHidden();
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


  test('with device — unknown model shows warning and requires checkbox', async ({ page }) => {
    await page.goto('/');
    await injectMockDevice(page, { serial: 'X9990A0000000' });
    await page.click('#btn-connect');
    await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
    await page.click('#btn-connect-ready');

    // Device info should be displayed with unknown model
    await expect(page.locator('#step-device')).not.toBeHidden();
    await expect(page.locator('#device-model')).toContainText('Unknown');
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

    // Enable a patch
    const patchName = page.locator('.patch-name', { hasText: 'Remove footer (row3) on new home screen' }).first();
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
      page.locator('#step-done').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'done'),
      page.locator('#step-error').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'error'),
    ]);

    if (doneOrError === 'error') {
      const errorMsg = await page.locator('#error-message').textContent();
      throw new Error(`Build failed: ${errorMsg}`);
    }

    await expect(page.locator('#build-status')).toContainText('Patching complete');

    // Both write and download should be visible with device connected
    await expect(page.locator('#btn-write')).toBeVisible();
    await expect(page.locator('#btn-download')).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-download'),
    ]);

    expect(download.suggestedFilename()).toBe('custom-patches.zip');
  });


  test('with device — restore original firmware', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);


    // Override firmware URLs BEFORE connecting so the app captures the local URL
    await connectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });

    // Use the "Restore Unpatched Software" shortcut button on device screen
    await page.click('#btn-device-restore');

    // Build step should show restore mode
    await expect(page.locator('#step-firmware')).not.toBeHidden();
    await expect(page.locator('#firmware-description')).toContainText('without modifications');
    await expect(page.locator('#btn-build')).toContainText('Restore Original Software');

    await page.click('#btn-build');

    const doneOrError = await Promise.race([
      page.locator('#step-done').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'done'),
      page.locator('#step-error').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'error'),
    ]);

    if (doneOrError === 'error') {
      const errorMsg = await page.locator('#error-message').textContent();
      throw new Error(`Restore failed: ${errorMsg}`);
    }

    await expect(page.locator('#build-status')).toContainText('Software extracted');

    // Download and verify original
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-download'),
    ]);

    expect(download.suggestedFilename()).toBe('custom-patches.zip');
    const tgzData = await extractKoboRootTgz(download);
    const actualHash = crypto.createHash('sha1').update(tgzData).digest('hex');
    expect(actualHash, 'restored KoboRoot.tgz SHA1 mismatch').toBe(await getOriginalTgzSha1());
  });


  test('with device — build failure shows Go Back and returns to patches', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);


    await connectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });

    // Select Custom Patches
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');

    // Enable "Remove footer (row3) on new home screen"
    const patchName = page.locator('.patch-name', { hasText: 'Remove footer (row3) on new home screen' }).first();
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


  test('patch search filters by name and clears', async ({ page }) => {
    await connectMockDevice(page, { hasNickelMenu: false });

    // Navigate to Custom Patches
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');

    // Wait for patches to load
    await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);

    // Open all sections so items are present in the DOM
    const sections = page.locator('.patch-file-section');
    const sectionCount = await sections.count();
    for (let i = 0; i < sectionCount; i++) {
      await sections.nth(i).locator('summary').click();
    }

    const searchInput = page.locator('.patch-search');

    // Type a search query
    await searchInput.fill('home screen');

    // Matching patches remain visible
    await expect(page.locator('.patch-name', { hasText: 'Remove footer (row3) on new home screen' }).first()).toBeVisible();

    // Non-matching patches are hidden
    await expect(page.locator('.patch-item-hidden')).not.toHaveCount(0);

    // Clear button appears and is clickable
    await expect(page.locator('.patch-search-clear')).toBeVisible();
    await page.locator('.patch-search-clear').click();

    // All patches restored
    await expect(page.locator('.patch-item-hidden')).toHaveCount(0);
  });


  test('blacklisted patches are marked "known to fail" but remain enableable', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

    const blacklist = JSON.parse(fs.readFileSync(
      require('path').join(__dirname, '..', '..', '..', 'patches', 'blacklist.json'), 'utf-8'
    ));
    const version45 = blacklist['4.45'];
    test.skip(!version45, 'No 4.45 blacklist entries found');

    await connectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });

    // Navigate to Custom Patches
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');

    // Wait for patches to load
    await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);

    // Open all patch file sections
    const sections = page.locator('.patch-file-section');
    const sectionCount = await sections.count();
    for (let i = 0; i < sectionCount; i++) {
      await sections.nth(i).locator('summary').click();
    }

    // Verify each blacklisted patch shows the "known to fail" badge but
    // remains interactive (users can override the warning and try anyway).
    for (const [filename, patchNames] of Object.entries(version45)) {
      for (const name of patchNames) {
        const patchName = page.locator('.patch-name', { hasText: name }).first();
        await expect(patchName).toBeVisible();

        const label = patchName.locator('xpath=ancestor::label');
        const input = label.locator('input');
        await expect(input).toBeEnabled();

        const badge = label.locator('.patch-incompatible');
        await expect(badge).toBeVisible();
        await expect(badge).toHaveText('known to fail');
      }
    }
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
      page.locator('#step-done').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'done'),
      page.locator('#step-error').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'error'),
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

    // Mode → NM config → Continue (nickelmenu-only) → NM review
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
    await page.click('input[value="nickelmenu-only"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await page.click('input[name="nm-backup-option"][value="skip"]');
    await page.click('#btn-nm-backup-next');
    await expect(page.locator('#step-nm-review')).not.toBeHidden();

    // NM review → Back → NM backup for nickelmenu-only
    await page.click('#btn-nm-review-back');
    await expect(page.locator('#step-nm-backup')).not.toBeHidden();
    await page.click('#btn-nm-backup-back');
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
    await page.selectOption('#manual-model', 'N428');
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
    await page.selectOption('#manual-model', 'N428');
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


  test('with device — write patched firmware writes manifest and audit log', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

    await connectMockDevice(page, { hasNickelMenu: false, overrideFirmware: true });

    // Select Custom Patches
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');

    // Patches step
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);

    // Enable a patch
    const patchName = page.locator('.patch-name', { hasText: 'Remove footer (row3) on new home screen' }).first();
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
      page.locator('#step-done').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'done'),
      page.locator('#step-error').waitFor({ state: 'visible', timeout: 240_000 }).then(() => 'error'),
    ]);

    expect(doneOrError).toBe('done');
    await expect(page.locator('#build-status')).toContainText('Patching complete');

    // Write to device
    await expect(page.locator('#btn-write')).toBeVisible();
    await page.click('#btn-write');

    // Wait for write completion
    await expect(page.locator('#write-instructions')).toBeVisible({ timeout: 30_000 });

    // Verify custom-patches.json manifest
    const manifestText = await readMockFile(page, '.kobopatch-webui', 'custom-patches.json');
    const manifest = JSON.parse(manifestText);
    expect(manifest.files.some(f => f.path === '.kobo/KoboRoot.tgz')).toBe(true);
    expect(manifest.meta.writer.name).toBe('kobopatch-webui');
    expect(manifest.meta.installed.firmware).toBe('4.45.23646');
    expect(manifest.meta.installed.model).toBe('N428');

    // Verify audit log written under .kobopatch-webui/logs/
    const writtenFiles = await getWrittenFiles(page);
    expect(writtenFiles.some(f => f.includes('.kobopatch-webui/logs/') && f.includes('custom-patches'))).toBe(true);
  });


  test('patch edit button opens editor dialog with patch YAML', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

    await gotoManualPatchesStep(page);

    // Open the first section (Nickel UI patches)
    const section = page.locator('.patch-file-section').first();
    await section.locator('summary').click();

    // Find a known patch and click its edit button
    const patchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
    await expect(patchName).toBeVisible();
    const patchItem = patchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]');
    const editBtn = patchItem.locator('.patch-edit-btn');
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    // Dialog should be open with the patch YAML
    const dialog = page.locator('#patch-editor-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.patch-editor-title')).toContainText('Reduce top/bottom page spacer');

    // Textarea should contain the patch YAML
    const textarea = dialog.locator('.patch-editor-textarea');
    await expect(textarea).toBeVisible();
    const initialYaml = await textarea.inputValue();
    expect(initialYaml).toContain('Reduce top/bottom page spacer');
    expect(initialYaml).toContain('min-height: 12px');

    // Validate button should report valid YAML
    await dialog.locator('.patch-editor-validate').click();
    await expect(dialog.locator('.patch-editor-status--ok')).toBeVisible();

    // Modify a value in the YAML
    const editedYaml = initialYaml.replace('min-height: 12px', 'min-height: 99px');
    await textarea.fill(editedYaml);

    // Validate the edited YAML
    await dialog.locator('.patch-editor-validate').click();
    await expect(dialog.locator('.patch-editor-status--ok')).toBeVisible();

    // Save and close
    await dialog.locator('.patch-editor-save').click();
    await expect(dialog).not.toBeVisible();

    // Re-open the editor to verify persistence. The section stays expanded across
    // the post-save re-render, so re-query the patch directly without toggling it.
    const reOpenedPatchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
    await expect(reOpenedPatchName).toBeVisible();
    const reOpenedEditBtn = reOpenedPatchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]').locator('.patch-edit-btn');
    await reOpenedEditBtn.click();
    await expect(dialog).toBeVisible();
    const savedYaml = await textarea.inputValue();
    expect(savedYaml).toContain('min-height: 99px');
    expect(savedYaml).not.toContain('min-height: 12px');

    // Close dialog
    await dialog.locator('.modal-footer .patch-editor-cancel').click();
    await expect(dialog).not.toBeVisible();
  });


  test('editing a patch keeps the active search query and filtered view', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

    await gotoManualPatchesStep(page);

    // Open the first section so its patches (and edit buttons) are in the DOM.
    const section = page.locator('.patch-file-section').first();
    await section.locator('summary').click();

    // Search for a query that matches the patch we'll edit.
    const searchInput = page.locator('.patch-search');
    await searchInput.fill('spacer');
    await expect(page.locator('.patch-search-clear')).toBeVisible();
    // The filter is active: some patches are hidden.
    await expect(page.locator('.patch-item-hidden')).not.toHaveCount(0);

    const patchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
    await expect(patchName).toBeVisible();
    const editBtn = patchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]').locator('.patch-edit-btn');
    await editBtn.click();

    // Edit a value and save (this re-renders the patch list).
    const dialog = page.locator('#patch-editor-dialog');
    await expect(dialog).toBeVisible();
    const textarea = dialog.locator('.patch-editor-textarea');
    const editedYaml = (await textarea.inputValue()).replace('min-height: 12px', 'min-height: 77px');
    await textarea.fill(editedYaml);
    await dialog.locator('.patch-editor-save').click();
    await expect(dialog).not.toBeVisible();

    // The search box keeps its query and the filtered view is preserved across
    // the post-save re-render — not reset to showing every patch.
    await expect(page.locator('.patch-search')).toHaveValue('spacer');
    await expect(page.locator('.patch-search-clear')).toBeVisible();
    await expect(page.locator('.patch-item-hidden')).not.toHaveCount(0);
    await expect(patchName).toBeVisible();
  });


  test('patch editor validation rejects empty and invalid YAML', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

    await gotoManualPatchesStep(page);

    // Open first section and find a patch
    const section = page.locator('.patch-file-section').first();
    await section.locator('summary').click();
    const patchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
    await expect(patchName).toBeVisible();
    const editBtn = patchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]').locator('.patch-edit-btn');
    await editBtn.click();

    const dialog = page.locator('#patch-editor-dialog');
    await expect(dialog).toBeVisible();
    const textarea = dialog.locator('.patch-editor-textarea');
    const statusEl = dialog.locator('.patch-editor-status');

    // Test empty content
    await textarea.fill('');
    await dialog.locator('.patch-editor-validate').click();
    await expect(statusEl).toContainText('cannot be empty');
    await expect(dialog.locator('.patch-editor-status--error')).toBeVisible();

    // Test invalid YAML (malformed indentation)
    await textarea.fill('some: random\n  - yaml: content');
    await dialog.locator('.patch-editor-validate').click();
    await expect(statusEl).toContainText('YAML error');
    await expect(dialog.locator('.patch-editor-status--error')).toBeVisible();

    // Test that save is blocked when invalid (dialog stays open)
    await dialog.locator('.patch-editor-save').click();
    await expect(dialog).toBeVisible();

    // Close dialog without saving
    await dialog.locator('.modal-footer .patch-editor-cancel').click();
    await expect(dialog).not.toBeVisible();
  });


  test('editing a patch value changes the output KoboRoot.tgz', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

    // --- First build: edited patch ---
    await gotoManualPatchesStep(page);

    // Open section, edit patch value
    const section = page.locator('.patch-file-section').first();
    await section.locator('summary').click();
    const patchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
    await expect(patchName).toBeVisible();
    const patchItem = patchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]');
    const editBtn = patchItem.locator('.patch-edit-btn');
    await editBtn.click();

    const dialog = page.locator('#patch-editor-dialog');
    const textarea = dialog.locator('.patch-editor-textarea');
    const initialYaml = await textarea.inputValue();
    const editedYaml = initialYaml.replace('min-height: 12px', 'min-height: 99px');
    await textarea.fill(editedYaml);
    await dialog.locator('.patch-editor-validate').click();
    await expect(dialog.locator('.patch-editor-status--ok')).toBeVisible();
    await dialog.locator('.patch-editor-save').click();
    await expect(dialog).not.toBeVisible();

    // Enable the patch
    await patchName.locator('xpath=ancestor::label').locator('input').check();
    await expect(page.locator('#patch-count-hint')).toContainText('1 patch selected');

    // Build and download
    await page.click('#btn-patches-next');
    await expect(page.locator('#step-firmware')).not.toBeHidden();
    await page.click('#btn-build');
    await expect(page.locator('#step-done')).toBeVisible({ timeout: 240_000 });
    await expect(page.locator('#build-status')).toContainText('Patching complete');
    const [dlEdited] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-download'),
    ]);
    const shaEdited = crypto.createHash('sha1').update(await extractKoboRootTgz(dlEdited)).digest('hex');

    // --- Second build: same patch, default (unedited) ---
    await page.goto('/');
    await gotoManualPatchesStep(page);

    // Enable the same patch WITHOUT editing
    const section2 = page.locator('.patch-file-section').first();
    await section2.locator('summary').click();
    const patchName2 = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
    await expect(patchName2).toBeVisible();
    await patchName2.locator('xpath=ancestor::label').locator('input').check();
    await expect(page.locator('#patch-count-hint')).toContainText('1 patch selected');

    // Build and download
    await page.click('#btn-patches-next');
    await expect(page.locator('#step-firmware')).not.toBeHidden();
    await page.click('#btn-build');
    await expect(page.locator('#step-done')).toBeVisible({ timeout: 240_000 });
    await expect(page.locator('#build-status')).toContainText('Patching complete');
    const [dlDefault] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-download'),
    ]);
    const shaDefault = crypto.createHash('sha1').update(await extractKoboRootTgz(dlDefault)).digest('hex');

    // The edited patch must produce different output
    expect(shaEdited).not.toBe(shaDefault);
  });


  test('edited patch shows a "modified" indicator that clears when reverted', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

    await gotoManualPatchesStep(page);

    const section = page.locator('.patch-file-section').first();
    await section.locator('summary').click();

    const patchLabel = 'Reduce top/bottom page spacer';
    const itemFor = () => page.locator('.patch-name', { hasText: patchLabel }).first()
      .locator('xpath=ancestor::div[contains(@class, "patch-item")]');

    // No indicator before any edit.
    await expect(itemFor().locator('.patch-modified')).toHaveCount(0);

    const dialog = page.locator('#patch-editor-dialog');
    const textarea = dialog.locator('.patch-editor-textarea');

    // Edit a value → indicator appears.
    await itemFor().locator('.patch-edit-btn').click();
    const original = await textarea.inputValue();
    await textarea.fill(original.replace('min-height: 12px', 'min-height: 77px'));
    await dialog.locator('.patch-editor-save').click();
    await expect(dialog).not.toBeVisible();
    await expect(itemFor().locator('.patch-modified')).toBeVisible();

    // Edit back to the original → indicator clears.
    await itemFor().locator('.patch-edit-btn').click();
    await textarea.fill(original);
    await dialog.locator('.patch-editor-save').click();
    await expect(dialog).not.toBeVisible();
    await expect(itemFor().locator('.patch-modified')).toHaveCount(0);
  });


  test('going back after editing a patch asks for confirmation', async ({ page }) => {
    test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

    await gotoManualPatchesStep(page);

    const section = page.locator('.patch-file-section').first();
    await section.locator('summary').click();
    const patchItem = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first()
      .locator('xpath=ancestor::div[contains(@class, "patch-item")]');

    // Edit a patch so there are unsaved edits.
    await patchItem.locator('.patch-edit-btn').click();
    const dialog = page.locator('#patch-editor-dialog');
    const textarea = dialog.locator('.patch-editor-textarea');
    const original = await textarea.inputValue();
    await textarea.fill(original.replace('min-height: 12px', 'min-height: 77px'));
    await dialog.locator('.patch-editor-save').click();
    await expect(dialog).not.toBeVisible();

    // Dismissing the confirm keeps us on the patches step.
    let prompted = false;
    page.once('dialog', (d) => { prompted = true; expect(d.message()).toContain('discard'); d.dismiss(); });
    await page.click('#btn-patches-back');
    expect(prompted).toBe(true);
    await expect(page.locator('#step-patches')).not.toBeHidden();

    // Accepting the confirm navigates back (manual mode → version step).
    page.once('dialog', (d) => d.accept());
    await page.click('#btn-patches-back');
    await expect(page.locator('#step-manual-version')).not.toBeHidden();
  });
});
