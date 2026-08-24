// @ts-check
const { test, expect } = require('@playwright/test');

const { hasNickelMenuAssets, hasFontAssets } = require('../../support/assets');
const { injectMockDevice, connectMockDevice, goToManualMode, ejectMockDevice } = require('../../support/mock-device');
const { skipNmBackup, goToNmFeatures } = require('../../support/nm-helpers');

/**
 * The NickelMenu done step watches for the connected Kobo to disappear, so the
 * final screen can move from "waiting for you to eject" to "disconnected", and
 * only then ask whether it worked. See src/js/kobo/eject-watch.js.
 */
async function stubAnalytics(page) {
    // The feedback widget only renders when analytics is on, and it is the
    // thing gated behind the eject, so every test here needs it enabled.
    await page.addInitScript(() => {
        window.__ANALYTICS_ENABLED = true;
        window.__trackedEvents = [];
        window.umami = {
            track: (eventName, data) => window.__trackedEvents.push({ eventName, data }),
        };
    });
}

test.describe('NickelMenu eject watch', () => {
    test('connected install waits for the eject, then reveals the feedback prompt', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

        await stubAnalytics(page);
        await injectMockDevice(page, { hasNickelMenu: false });
        await connectMockDevice(page, { hasNickelMenu: false });
        await goToNmFeatures(page);
        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);
        await page.click('#btn-nm-write');

        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#nm-done-status')).toContainText('installed');

        // Waiting: the prompt is live, and the vote is deliberately withheld
        // until the user has actually done something.
        await expect(page.locator('#nm-eject-watch')).toBeVisible();
        await expect(page.locator('#nm-eject-waiting')).toBeVisible();
        await expect(page.locator('#nm-eject-waiting')).toContainText('Waiting for you to eject');
        await expect(page.locator('#step-nm-done .feedback')).toBeHidden();

        await ejectMockDevice(page);

        // Disconnected: never claims a *safe* eject, since a pulled cable looks
        // identical from here.
        await expect(page.locator('#nm-eject-status')).toContainText('disconnected and should be restarting and updating', { timeout: 15_000 });
        await expect(page.locator('#nm-eject-waiting')).toBeHidden();
        await expect(page.locator('#nm-eject-detail')).toContainText('about a minute');
        await expect(page.locator('#nm-eject-status')).not.toContainText('Ejected');
        // The eject instruction and the "instructions below" title have been
        // overtaken by events, so neither should still be on screen.
        await expect(page.locator('#nm-write-instructions')).toBeHidden();
        await expect(page.locator('#nm-done-status')).not.toContainText('instructions below');

        // The vote is now worth collecting.
        await expect(page.locator('#step-nm-done .feedback')).toBeVisible();
        await page.locator('#step-nm-done .feedback-btn--up').click();
        await expect.poll(() => page.evaluate(() => window.__trackedEvents)).toContainEqual({ eventName: 'feedback', data: { vote: 'up' } });
    });

    test('removal names the removal and shows the glitch note only after disconnect', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await stubAnalytics(page);
        await injectMockDevice(page, { hasNickelMenu: true });
        await connectMockDevice(page, { hasNickelMenu: true });
        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
        await page.click('input[name="nm-option"][value="remove"]');
        await page.click('#btn-nm-next');
        await skipNmBackup(page);
        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        await page.click('#btn-nm-write');

        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#nm-done-status')).toContainText('on next reboot');
        await expect(page.locator('#nm-eject-waiting')).toBeVisible();
        // The reassurance about the glitchy line belongs to the reboot, so it
        // stays out of sight until the reboot is actually under way.
        await expect(page.locator('#nm-eject-glitch-note')).toBeHidden();
        await expect(page.locator('#step-nm-done .feedback')).toBeHidden();

        await ejectMockDevice(page);

        await expect(page.locator('#nm-eject-status')).toContainText('removing NickelMenu', { timeout: 15_000 });
        await expect(page.locator('#nm-eject-detail')).toContainText('about a minute');
        await expect(page.locator('#nm-reboot-instructions')).toBeHidden();
        // "on next reboot" gives way to "now" once the reboot is under way.
        await expect(page.locator('#nm-done-status')).toHaveText('NickelMenu will now be removed.');
        await expect(page.locator('#nm-eject-glitch-note')).toContainText("This is normal, don't worry!");
        await expect(page.locator('#step-nm-done .feedback')).toBeVisible();
    });

    test('manual download has no device to watch and asks for feedback right away', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasFontAssets(), 'Font assets not found (run npm run setup:installables)');

        await stubAnalytics(page);
        await goToManualMode(page);
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
        await page.click('input[name="nm-option"][value="preset"]');
        await page.click('#btn-nm-next');
        await expect(page.locator('#step-nm-features')).not.toBeHidden();
        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);
        await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);

        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#nm-eject-watch')).toBeHidden();
        await expect(page.locator('#step-nm-done .feedback')).toBeVisible();
    });
});
