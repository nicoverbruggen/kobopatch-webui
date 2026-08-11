// @ts-check
const { test, expect } = require('@playwright/test');

// Boot resilience (src/js/app.js). The shared async resources — firmware
// download URLs, the patch catalogue, the blacklist — are started at boot and
// awaited much later, inside whichever flow needs them. A rejection in that gap
// has nobody watching it, so it reaches the global `unhandledrejection` handler
// and the safety net reads it as the app crashing. The user then gets
// "Something went wrong" before touching anything, for a resource they had not
// asked for. These cover that the landing page survives each one.

const BOOT_RESOURCES = [
    { label: 'firmware download URLs', pattern: '**/patches/downloads.json' },
    { label: 'the patch catalogue', pattern: '**/patches/index.json' },
];

// Boot is finished once app.js removes the initial loader.
async function waitForBoot(page) {
    await expect(page.locator('#initial-loader')).toHaveCount(0);
}

test.describe('Boot', () => {
    for (const resource of BOOT_RESOURCES) {
        test(`a failed load of ${resource.label} does not surface an error screen`, async ({ page }) => {
            await page.addInitScript(() => {
                window.__ANALYTICS_ENABLED = true;
                window.__trackedEvents = [];
                window.umami = { track: (eventName, data) => window.__trackedEvents.push({ eventName, data }) };
            });
            await page.route(resource.pattern, (route) => route.abort('failed'));

            await page.goto('/');
            await waitForBoot(page);

            // The landing page is usable: the failure only matters to the flow
            // that needs the resource, which reports it with a real message.
            await expect(page.locator('#btn-connect')).toBeVisible();
            await expect(page.locator('#step-error')).toBeHidden();
            expect(await page.evaluate(() => window.__trackedEvents.filter((e) => e.eventName === 'error'))).toEqual([]);
        });
    }

    test('every boot resource failing at once still leaves the landing page usable', async ({ page }) => {
        for (const resource of BOOT_RESOURCES) {
            await page.route(resource.pattern, (route) => route.abort('failed'));
        }

        await page.goto('/');
        await waitForBoot(page);

        await expect(page.locator('#btn-connect')).toBeVisible();
        await expect(page.locator('#step-error')).toBeHidden();
    });
});
