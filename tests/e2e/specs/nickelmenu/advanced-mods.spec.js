// @ts-check
// E2E coverage for the Advanced-section NickelHook mods: NickelCoverFix and
// NickelDissolve. Both ship a bare KoboRoot.tgz that the installer merges into
// the single archive it writes, and both follow the shared uninstall_xflag
// convention: the .adds/<mod>/uninstall marker present means installed, and
// deleting the whole folder triggers the mod's self-uninstall on reboot.
//
// NickelDissolve has no published release yet: until its asset is bundled, the
// feature row is shown as "Temporarily unavailable" (covered below), and the
// install-path tests skip via hasNickelDissolveAssets(). They activate on the
// first locked release with no further changes.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const JSZip = require('jszip');

const { WEBROOT } = require('../../support/paths');
const { hasNickelMenuAssets, hasNickelCoverFixAssets, hasNickelDissolveAssets } = require('../../support/assets');
const { connectMockDevice, goToManualMode, mockPathExists, getWrittenFiles } = require('../../support/mock-device');
const { parseTar } = require('../../support/tar');
const { skipNmBackup, openNmSection, goToNmFeatures } = require('../../support/nm-helpers');

// Navigate manual mode to the preset feature-selection step.
async function goToManualNmFeatures(page) {
    await goToManualMode(page);
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
    await page.click('input[name="nm-option"][value="preset"]');
    await page.click('#btn-nm-next');
    await expect(page.locator('#step-nm-features')).not.toBeHidden();
}

test.describe('NickelMenu — Advanced mods', () => {
    test('no device — both mods carry an Experimental badge, page turns sit below NickelClock in Reading Experience', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await goToManualNmFeatures(page);

        // Page turn animations now lives in Reading Experience (open by default),
        // directly below NickelClock.
        const clockRow = page.locator('.nm-config-item', { has: page.locator('input[name="nm-cfg-nickelclock"]') });
        const dissolveRow = page.locator('.nm-config-item', { has: page.locator('input[name="nm-cfg-nickeldissolve"]') });
        const dissolveBadge = dissolveRow.locator('.nm-config-experimental');
        await expect(dissolveBadge).toHaveText(/experimental/i);
        // The badge carries the hover/focus explanation, and reveals it on hover.
        await expect(dissolveBadge).toHaveAttribute('data-tooltip', /haven't been tested extensively.*filing a bug report/);
        await dissolveBadge.hover();
        await expect(dissolveBadge).toBeVisible();

        const clockBox = await clockRow.boundingBox();
        const dissolveBox = await dissolveRow.boundingBox();
        expect(dissolveBox.y).toBeGreaterThan(clockBox.y);

        // A non-experimental Reading Experience feature does not get the badge.
        const fontsRow = page.locator('.nm-config-item', { has: page.locator('input[name="nm-cfg-additional-fonts"]') });
        await expect(fontsRow.locator('.nm-config-experimental')).toHaveCount(0);

        // Alternative cover handling stays in the collapsed Advanced section and
        // also carries the badge once that section is opened.
        await openNmSection(page, 'Advanced');
        const coverRow = page.locator('.nm-config-item', { has: page.locator('input[name="nm-cfg-nickelcoverfix"]') });
        await expect(coverRow.locator('.nm-config-experimental')).toHaveText(/experimental/i);
    });

    test('no device — a disabled add-on shows its maintainer reason instead of the generic text', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        await goToManualNmFeatures(page);
        await openNmSection(page, 'Advanced');
        const cb = page.locator('input[name="nm-cfg-nickelcoverfix"]');
        // Only meaningful while the kill switch is on with a string reason.
        test.skip(!(await cb.isDisabled()), 'NickelCoverFix is enabled');
        const reason = page.locator('.nm-config-item', { has: cb }).locator('.nm-config-disabled-reason');
        // A string `disabled` value is shown verbatim in place of the generic
        // text — assert that, not the exact wording, so copy tweaks don't break it.
        await expect(reason).toBeVisible();
        await expect(reason).not.toHaveText('');
        await expect(reason).not.toHaveText('Temporarily unavailable.');
    });

    test('no device — NickelCoverFix merges into KoboRoot.tgz preserving original files', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasNickelCoverFixAssets(), 'NickelCoverFix assets not found (run npm run setup:installables)');

        // NickelMenu ships as a zip wrapping a KoboRoot.tgz; NickelCoverFix's
        // release asset is a bare KoboRoot.tgz.
        const nmZip = await JSZip.loadAsync(fs.readFileSync(path.join(WEBROOT, 'assets', 'NickelMenu.zip')));
        const nmEntries = parseTar(zlib.gunzipSync(await nmZip.file('KoboRoot.tgz').async('nodebuffer')));
        const ncfEntries = parseTar(zlib.gunzipSync(fs.readFileSync(path.join(WEBROOT, 'assets', 'NickelCoverFix.tgz'))));

        await goToManualNmFeatures(page);

        // The mod lives in the collapsed Advanced section, with its version and
        // a "learn more" link to the project.
        await openNmSection(page, 'Advanced');
        // Auto-skip while the maintainer kill switch (`disabled`) is on;
        // removing it re-enables both the feature and this test, no edits needed.
        test.skip(await page.locator('input[name="nm-cfg-nickelcoverfix"]').isDisabled(), 'NickelCoverFix is temporarily disabled');
        const row = page.locator('.nm-config-item', { has: page.locator('input[name="nm-cfg-nickelcoverfix"]') });
        await expect(row.locator('.nm-config-title')).toContainText('Alternative cover handling');
        await expect(row.locator('.nm-config-version')).toHaveText(/^v?\d/);
        await expect(row.locator('a.nm-config-help')).toHaveAttribute('href', 'https://github.com/nicoverbruggen/NickelCoverFix');

        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        // Better typography and fixes would merge NickelTypeFix into the archive too;
        // deselect it so the merge is exactly NickelMenu + NickelCoverFix.
        await page.uncheck('input[name="nm-cfg-better-typography"]');
        await page.check('input[name="nm-cfg-nickelcoverfix"]');

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        // The review step announces the bundled mod.
        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        await expect(page.locator('#nm-review-list')).toContainText('Alternative cover handling');
        await expect(page.locator('#nm-review-notices')).toContainText('NickelCoverFix');

        const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });

        // Unarchive the generated KoboRoot.tgz from the download package.
        const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
        const mergedTgz = await zip.file('.kobo/KoboRoot.tgz').async('nodebuffer');
        const mergedEntries = parseTar(zlib.gunzipSync(mergedTgz));

        // The merged archive is exactly the union of both sources — no more, no less.
        const expectedNames = [...Object.keys(nmEntries), ...Object.keys(ncfEntries)].sort();
        expect(Object.keys(mergedEntries).sort()).toEqual(expectedNames);

        // Both plugins travel, along with NickelCoverFix's uninstall_xflag marker
        // (whose absence later triggers the mod's self-uninstall)...
        expect(mergedEntries['usr/local/Kobo/imageformats/libnm.so']).toBeDefined();
        expect(mergedEntries['mnt/onboard/.adds/nickel-cover-fix/uninstall']).toBeDefined();

        // ...and every file's bytes are byte-for-byte identical to the original.
        for (const [name, data] of Object.entries({ ...nmEntries, ...ncfEntries })) {
            expect(mergedEntries[name], `missing ${name} in merged tgz`).toBeDefined();
            expect(Buffer.compare(mergedEntries[name], data), `${name} bytes differ after merge`).toBe(0);
        }
    });

    test('with device — install with NickelCoverFix writes the merged KoboRoot.tgz', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasNickelCoverFixAssets(), 'NickelCoverFix assets not found (run npm run setup:installables)');

        await connectMockDevice(page, { hasNickelMenu: false });
        await goToNmFeatures(page);

        await openNmSection(page, 'Advanced');
        // Auto-skip while the maintainer kill switch (`disabled`) is on.
        test.skip(await page.locator('input[name="nm-cfg-nickelcoverfix"]').isDisabled(), 'NickelCoverFix is temporarily disabled');
        await expect(page.locator('input[name="nm-cfg-nickelcoverfix"]')).not.toBeChecked();
        await page.uncheck('input[name="nm-cfg-additional-fonts"]');
        // Keep Better typography and fixes's merge out of this test.
        await page.uncheck('input[name="nm-cfg-better-typography"]');
        await page.check('input[name="nm-cfg-nickelcoverfix"]');

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        await expect(page.locator('#nm-review-list')).toContainText('Alternative cover handling');
        await expect(page.locator('#nm-review-notices')).toContainText('NickelCoverFix');
        await page.click('#btn-nm-write');
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('#nm-done-status')).toContainText('installed');

        // NickelCoverFix ships as a plugin inside KoboRoot.tgz, so the device write
        // goes through the merged .kobo/KoboRoot.tgz (the merge contents are
        // verified in the manual-download test).
        const writtenFiles = await getWrittenFiles(page);
        expect(writtenFiles.some((f) => f.includes('KoboRoot.tgz'))).toBe(true);
    });

    test('with device — NickelCoverFix is offered for removal and its folder is deleted', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        // Installed state per the shared convention: the uninstall marker exists.
        await connectMockDevice(page, {
            hasNickelMenu: true,
            extraAddsFiles: [
                { path: ['nickel-cover-fix', 'uninstall'], content: 'Delete this file...' },
                { path: ['nickel-cover-fix', 'config'], content: 'ncf_enabled=1' },
            ],
        });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="remove"]');

        await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();
        await expect(page.locator('input[name="nm-uninstall-nickelcoverfix"]')).toBeChecked();
        await expect(page.locator('#nm-uninstall-options')).toContainText('Remove NickelCoverFix (.adds/nickel-cover-fix)');

        await page.click('#btn-nm-next');
        await skipNmBackup(page);
        await expect(page.locator('#nm-review-list')).toContainText('NickelCoverFix');

        await page.click('#btn-nm-write');
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#nm-done-status')).toContainText('removed');

        // Deleting .adds/nickel-cover-fix clears the onboard footprint (marker,
        // config, mirrored covers); the now-missing marker triggers the mod's
        // self-uninstall on the next reboot.
        expect(await mockPathExists(page, '.adds', 'nickel-cover-fix')).toBe(false);
    });

    test('with device — NickelCoverFix is not offered for removal without its uninstall marker', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        // A leftover folder without the marker means the mod already ran its own
        // uninstall — there is nothing to offer.
        await connectMockDevice(page, {
            hasNickelMenu: true,
            extraAddsFiles: [{ path: ['nickel-cover-fix', 'config'], content: 'ncf_enabled=1' }],
        });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="remove"]');

        await expect(page.locator('input[name="nm-uninstall-nickelcoverfix"]')).toHaveCount(0);
    });

    test('with device — NickelDissolve is offered for removal and its folder is deleted', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');

        // Removal is detection-based, so it works even when the deployment has no
        // NickelDissolve asset (e.g. installed elsewhere, or the release was pulled).
        await connectMockDevice(page, {
            hasNickelMenu: true,
            extraAddsFiles: [
                { path: ['nickel-dissolve', 'uninstall'], content: 'Delete this file...' },
                { path: ['nickel-dissolve', 'config'], content: 'nds_mode=observe' },
            ],
        });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="nickelmenu"]');
        await page.click('#btn-mode-next');
        await page.click('input[name="nm-option"][value="remove"]');

        await expect(page.locator('#nm-uninstall-options')).not.toBeHidden();
        await expect(page.locator('input[name="nm-uninstall-nickeldissolve"]')).toBeChecked();
        await expect(page.locator('#nm-uninstall-options')).toContainText('Remove NickelDissolve (.adds/nickel-dissolve)');

        await page.click('#btn-nm-next');
        await skipNmBackup(page);
        await expect(page.locator('#nm-review-list')).toContainText('NickelDissolve');

        await page.click('#btn-nm-write');
        await expect(page.locator('#step-nm-done')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#nm-done-status')).toContainText('removed');

        expect(await mockPathExists(page, '.adds', 'nickel-dissolve')).toBe(false);
    });

    test('no device — NickelDissolve without a bundled asset is listed as temporarily unavailable', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(hasNickelDissolveAssets(), 'NickelDissolve asset is bundled — the unavailable state does not apply');

        await goToManualNmFeatures(page);

        // Page turn animations is in Reading Experience (open by default); the mod
        // is listed rather than hidden, but cannot be selected.
        const row = page.locator('.nm-config-item', { has: page.locator('input[name="nm-cfg-nickeldissolve"]') });
        await expect(row.locator('.nm-config-title')).toContainText('Page turn animations');
        await expect(row.locator('.nm-config-disabled-reason')).toHaveText('Temporarily unavailable.');
        await expect(page.locator('input[name="nm-cfg-nickeldissolve"]')).toBeDisabled();
        await expect(page.locator('input[name="nm-cfg-nickeldissolve"]')).not.toBeChecked();
    });

    // The remaining NickelDissolve tests need its bundled asset, so they skip
    // until the first release is locked (npm run update:installables).

    test('no device — NickelDissolve can be selected in manual mode (device unknown)', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasNickelDissolveAssets(), 'NickelDissolve assets not found (no locked release yet)');

        await goToManualNmFeatures(page);

        const checkbox = page.locator('input[name="nm-cfg-nickeldissolve"]');
        await expect(checkbox).toBeEnabled();
        await expect(checkbox).not.toBeChecked();
        await checkbox.check();

        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);

        // The review step carries the NickelDissolve caveat notice.
        await expect(page.locator('#step-nm-review')).not.toBeHidden();
        await expect(page.locator('#nm-review-list')).toContainText('Page turn animations');
        await expect(page.locator('#nm-review-notices')).toContainText('NickelDissolve');
    });

    test('with device — NickelDissolve is selectable on a supported device (Kobo Libra Colour)', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasNickelDissolveAssets(), 'NickelDissolve assets not found (no locked release yet)');

        // The default mock device is a Kobo Libra Colour — on the allowlist.
        await connectMockDevice(page, { hasNickelMenu: false });
        await goToNmFeatures(page);

        const row = page.locator('.nm-config-item', { has: page.locator('input[name="nm-cfg-nickeldissolve"]') });
        await expect(page.locator('input[name="nm-cfg-nickeldissolve"]')).toBeEnabled();
        await expect(row.locator('.nm-config-disabled-reason')).toHaveCount(0);
    });

    test('with device — NickelDissolve is disabled with a reason on an unsupported device (Kobo Sage)', async ({ page }) => {
        test.skip(!hasNickelMenuAssets(), 'NickelMenu assets not found in webroot');
        test.skip(!hasNickelDissolveAssets(), 'NickelDissolve assets not found (no locked release yet)');

        await connectMockDevice(page, {
            serial: 'N778A00000000',
            hardwareId: '00000000-0000-0000-0000-000000000383',
            expectedModel: 'Kobo Sage',
        });
        await goToNmFeatures(page);

        const row = page.locator('.nm-config-item', { has: page.locator('input[name="nm-cfg-nickeldissolve"]') });
        await expect(page.locator('input[name="nm-cfg-nickeldissolve"]')).toBeDisabled();
        await expect(row.locator('.nm-config-disabled-reason')).toContainText('Only supported on the Kobo Libra Colour, Clara Colour, Clara BW, and Libra 2');
        await expect(row.locator('.nm-config-disabled-reason')).toContainText('Kobo Sage');
    });
});
