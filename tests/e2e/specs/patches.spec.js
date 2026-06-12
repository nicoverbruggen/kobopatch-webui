// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');

const { FIRMWARE_PATH, getOriginalTgzSha1 } = require('../support/paths');
const { hasFirmwareZip } = require('../support/assets');
const { injectMockDevice, connectMockDevice, overrideFirmwareURLs, goToManualMode, readMockFile, getWrittenFiles } = require('../support/mock-device');
const { parseTar } = require('../support/tar');

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

    expect(download.suggestedFilename()).toBe('KoboRoot.tgz');
    await expect(page.locator('#download-device-name')).toHaveText('Kobo Libra Colour');
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

    // Download KoboRoot.tgz and verify it matches the original
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-download'),
    ]);

    expect(download.suggestedFilename()).toBe('KoboRoot.tgz');
    const downloadPath = await download.path();
    const tgzData = fs.readFileSync(downloadPath);
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
      'Optionally install KOReader',
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

    expect(download.suggestedFilename()).toBe('KoboRoot.tgz');
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

    expect(download.suggestedFilename()).toBe('KoboRoot.tgz');
    const downloadPath = await download.path();
    const tgzData = fs.readFileSync(downloadPath);
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
});
