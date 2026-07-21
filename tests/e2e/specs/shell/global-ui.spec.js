// @ts-check
const { test, expect } = require('@playwright/test');

// Behavioural coverage for the global shell UI that lives outside the wizard
// flow (src/js/shell/global-ui.js): the footer modal dialogs and their focus
// trap, the analytics-gated privacy link, the small-screen warning dialog, and
// the iPadOS/Safari connect gating in src/js/flows/connect-flow.js. All of this
// is reachable on the landing page without a device or firmware.
test.describe('Global shell UI', () => {
    test('footer dialogs open, focus their close button, and close every way', async ({ page }) => {
        await page.goto('/');

        // Credits: opens from the footer link, focus lands on the close button.
        await expect(page.locator('#credits-dialog')).toBeHidden();
        await page.click('#btn-credits');
        await expect(page.locator('#credits-dialog')).toBeVisible();
        await expect(page.locator('#btn-close-credits')).toBeFocused();

        // ...closes via its button.
        await page.click('#btn-close-credits');
        await expect(page.locator('#credits-dialog')).toBeHidden();

        // The "Disclaimer" link opens the how-it-works dialog; Escape closes it.
        await page.click('#btn-how-it-works');
        await expect(page.locator('#how-it-works-dialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#how-it-works-dialog')).toBeHidden();

        // A backdrop click (a click whose target is the dialog element itself)
        // closes the dialog too.
        await page.click('#btn-credits');
        await expect(page.locator('#credits-dialog')).toBeVisible();
        await page.locator('#credits-dialog').evaluate((dlg) => dlg.click());
        await expect(page.locator('#credits-dialog')).toBeHidden();
    });

    test('an open dialog traps Tab focus inside it', async ({ page }) => {
        await page.goto('/');
        await page.click('#btn-credits');
        await expect(page.locator('#credits-dialog')).toBeVisible();

        const focusInsideDialog = () => page.evaluate(() => document.getElementById('credits-dialog').contains(document.activeElement));

        // Tabbing forward never escapes the dialog...
        for (let i = 0; i < 6; i++) {
            await page.keyboard.press('Tab');
            expect(await focusInsideDialog()).toBe(true);
        }
        // ...and neither does tabbing backward.
        for (let i = 0; i < 4; i++) {
            await page.keyboard.press('Shift+Tab');
            expect(await focusInsideDialog()).toBe(true);
        }
    });

    test('the privacy link is hidden unless analytics is enabled', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('#btn-privacy')).toBeHidden();
        await expect(page.locator('#privacy-link-separator')).toBeHidden();
    });

    test('with analytics enabled the privacy link appears and opens the privacy dialog', async ({ page }) => {
        await page.addInitScript(() => {
            window.__ANALYTICS_ENABLED = true;
        });
        await page.goto('/');

        await expect(page.locator('#btn-privacy')).toBeVisible();
        await expect(page.locator('#privacy-link-separator')).toBeVisible();

        await page.click('#btn-privacy');
        await expect(page.locator('#privacy-dialog')).toBeVisible();
        await expect(page.locator('#btn-close-privacy')).toBeFocused();
        await page.click('#btn-close-privacy');
        await expect(page.locator('#privacy-dialog')).toBeHidden();
    });

    test('iPadOS Safari (MacIntel + touch, no filesystem API) disables direct connect with an iOS hint', async ({ page }) => {
        // Spoof the iPadOS-desktop-Safari signature and remove the File System
        // Access API so KoboDevice.isSupported() is false.
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
            Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 2 });
            delete window.showDirectoryPicker;
        });
        await page.goto('/');

        await expect(page.locator('#step-connect')).not.toBeHidden();
        await expect(page.locator('#btn-connect')).toBeDisabled();
        await expect(page.locator('#connect-unsupported-hint')).toBeVisible();
        await expect(page.locator('#connect-unsupported-text')).toContainText('iOS');
        await expect(page.locator('#connect-unsupported-text')).toContainText('Safari');

        // The manual-download path stays available as the fallback.
        await expect(page.locator('#btn-manual')).toBeEnabled();
    });

    test.describe('on a small touch screen', () => {
        test.use({ viewport: { width: 400, height: 800 } });

        test('the mobile warning dialog appears and can be dismissed', async ({ page }) => {
            // The dialog gates on maxTouchPoints > 0 and a narrow viewport.
            await page.addInitScript(() => {
                Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 1 });
            });
            await page.goto('/');

            await expect(page.locator('#mobile-dialog')).toBeVisible();
            await page.click('#btn-mobile-continue');
            await expect(page.locator('#mobile-dialog')).toBeHidden();
        });
    });
});
