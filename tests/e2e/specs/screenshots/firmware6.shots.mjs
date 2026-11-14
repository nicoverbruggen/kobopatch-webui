import { test, expect } from '@playwright/test';
import {
    shot,
    SCREENSHOT_DIRS,
    dismissMobileModal,
    connectToDeviceScreen,
    shotNickelMenuFontsModal,
    shotNickelMenuTabsModal,
} from '../../support/screenshot-helpers.mjs';

for (const mode of ['connected', 'manual']) {
    test(`Kobo OS 6 NickelMenu ${mode}`, async ({ page }, testInfo) => {
        const dir = SCREENSHOT_DIRS.edgeCompatibility;
        if (mode === 'connected') {
            await connectToDeviceScreen(page, { firmware: '6.0.276679' });
            await shot(page, dir, 'os6-device', testInfo);
            await page.click('#btn-device-next');
            await expect(page.locator('#beta-os-dialog')).toBeVisible();
            await shot(page, dir, 'os6-beta-warning', testInfo);
            await page.click('#btn-beta-os-continue');
            await expect(page.locator('#step-mode')).toBeHidden();
            await expect(page.locator('#step-nickelmenu')).toBeVisible();
            await shot(page, dir, 'os6-config', testInfo);
        } else {
            await page.goto('/');
            await dismissMobileModal(page);
            await page.click('#btn-manual');
            await page.click('input[name="mode"][value="nickelmenu"]');
            await page.click('#btn-mode-next');
        }
        if (mode === 'manual') {
            await page.selectOption('#nm-manual-firmware', '6');
            await shot(page, dir, 'os6-manual-version', testInfo);
        }
        await page.click('#btn-nm-next');
        await expect(page.locator('#nm-os6-notice')).toBeVisible();
        await page.check('input[name="nm-cfg-koreader"]');
        await page.check('input[name="nm-cfg-simplify-tabs"]');
        await page.check('input[name="nm-cfg-hide-recommendations"]');
        await page.check('input[name="nm-cfg-hide-notices"]');
        await shot(page, dir, `os6-${mode}-features`, testInfo);
        await expect(page.locator('input[name="nm-cfg-nickelmodmanager"]')).toBeChecked();
        if (mode === 'manual') {
            await shotNickelMenuFontsModal(page, dir, 'os6-fonts-dialog', testInfo);
            await shotNickelMenuTabsModal(page, dir, 'os6-tabs-dialog', testInfo);
        }
        await page.click('#btn-nm-features-next');
        if (mode === 'connected') await page.click('input[name="nm-backup-option"][value="skip"]');
        await page.click('#btn-nm-backup-next');
        await expect(page.locator('#nm-review-list')).toContainText('NickelMenu (Kobo.tgz)');
        await expect(page.locator('#nm-review-notices')).toContainText('Choosing Exit in KOReader will ask to restart your Kobo');
        await shot(page, dir, `os6-${mode}-review`, testInfo);
        if (mode === 'manual') {
            await page.click('#btn-nm-download');
            await expect(page.locator('#step-nm-done')).toBeVisible();
            await shot(page, dir, 'os6-manual-done', testInfo);
        }
    });
}
