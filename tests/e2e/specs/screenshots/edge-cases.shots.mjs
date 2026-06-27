import { test, expect } from '@playwright/test';
import {
    shot,
    SCREENSHOT_DIRS,
    dismissMobileModal,
    connectToDeviceScreen,
    injectMockDevice,
    overrideFirmwareURLs,
    hasFirmwareZip,
} from '../../support/screenshot-helpers.mjs';

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

test('Sideload Mode too old os', async ({ page }, testInfo) => {
    const dir = SCREENSHOT_DIRS.edgeNickelMenu;
    await page.goto('/');
    await dismissMobileModal(page);
    await injectMockDevice(page, { firmware: '4.28.17820', signedIn: false });
    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
    // Open the (collapsed) Advanced section so the disabled option is visible.
    await page.locator('summary.nm-config-section-heading').filter({ hasText: 'Advanced' }).click();
    await expect(page.locator('.nm-config-disabled-reason')).toBeVisible();
    await shot(page, dir, 'sideloaded-mode-too-old-os', testInfo);
});
