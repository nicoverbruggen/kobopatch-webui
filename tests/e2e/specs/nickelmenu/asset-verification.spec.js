const { test, expect } = require('@playwright/test');
const { hasNickelMenuAssets } = require('../../support/assets');
const { connectMockDevice, getWrittenFiles, mockPathExists } = require('../../support/mock-device');
const { skipNmBackup } = require('../../support/nm-helpers');

// A deploy replaces every asset in place, and the version sits in the query
// string, which servers ignore. So a page left open across a deploy can be handed
// an archive belonging to a build it was never compiled against. These drive that
// through the real install: the download is swapped for bytes that cannot match
// the pinned digest, and the app has to notice before anything reaches the Kobo.

async function serveWrongAsset(page) {
    await page.route('**/assets/NickelMenu.tgz*', (route) =>
        route.fulfill({ status: 200, contentType: 'application/gzip', body: 'not the archive this build pinned' }),
    );
}

async function serveVersion(page, version) {
    await page.route('**/version.json', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version, bundle: 'ffffffff' }) }),
    );
}

async function installUpTo(page, write = true) {
    await page.click('#btn-device-next');
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);
    await expect(page.locator('#step-nm-review')).not.toBeHidden();
    if (write) await page.click('#btn-nm-write');
}

test.describe('NickelMenu — asset verification', () => {
    test('with device — an asset from a newer deployment stops the install and offers a reload', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await connectMockDevice(page);
        await serveWrongAsset(page);
        // The server reports a build this page was not compiled from.
        await serveVersion(page, '99.0');
        await installUpTo(page);

        const dialog = page.locator('#app-updated-dialog');
        await expect(dialog).toBeVisible({ timeout: 30_000 });
        await expect(dialog).toContainText('The website has been updated since you started using it');
        await expect(page.locator('#btn-app-updated-reload')).toBeVisible();

        // The whole point: the archive that did not match never reached the Kobo.
        // The whole point: the archive that failed its checksum never reached the
        // Kobo. The connection write-probe is the only write, and the device
        // removes it again, so nothing of the install is left behind.
        expect(await getWrittenFiles(page)).toEqual(['KOBOeReader/.kobopatch-webui-probe']);
        expect(await mockPathExists(page, '.kobopatch-webui-probe')).toBe(false);
        expect(await mockPathExists(page, '.kobo', 'KoboRoot.tgz')).toBe(false);
        expect(await mockPathExists(page, '.adds', 'nm', 'items')).toBe(false);
    });

    test('with device — a corrupt download on the same deployment blames the download, not an update', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await connectMockDevice(page);
        await serveWrongAsset(page);
        // Same build as the page: a reload would not fix this, so it must not ask
        // for one.
        const { version, bundle } = await page.evaluate(() => ({
            version: globalThis.__APP_VERSION__,
            bundle: new URL(document.querySelector('script[src*="bundle.js"]').src).searchParams.get('h'),
        }));
        await page.route('**/version.json', (route) =>
            route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version, bundle }) }),
        );
        await installUpTo(page);

        await expect(page.locator('#step-error')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#step-error')).toContainText('did not match its expected checksum');
        await expect(page.locator('#app-updated-dialog')).toBeHidden();
        expect(await getWrittenFiles(page)).toEqual(['KOBOeReader/.kobopatch-webui-probe']);
        expect(await mockPathExists(page, '.kobo', 'KoboRoot.tgz')).toBe(false);
    });
});
