const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { WEBROOT } = require('../../support/paths');
const { connectMockDevice, goToManualMode, readMockFile, mockPathExists } = require('../../support/mock-device');
const { goToNmFeatures, skipNmBackup } = require('../../support/nm-helpers');

const firmware = '6.0.276679';
const reader = 'input[name="nm-cfg-koreader"]';
const basePackage = () => fs.readFileSync(path.join(WEBROOT, 'assets/NickelMenu-Qt6.tgz'));

async function expectOs6Features(page) {
    await expect(page.locator('#nm-os6-notice')).toBeVisible();
    await expect(page.locator('#nm-os6-notice')).toHaveClass(/banner--warning/);
    await expect(page.locator('#nm-os6-notice p')).toHaveCount(1);
    await expect(page.locator('#nm-os6-notice')).toContainText('Kobo OS 6 is still in beta. Mods may have issues or stop working after future OS updates.');
    await expect(page.locator('#nm-os6-notice')).toContainText('Support is still being added');
    expect(await page.locator('#nm-config-options').evaluate((el) => el.nextElementSibling.id)).toBe('nm-os6-notice');
    await expect(page.locator('#nm-sideloaded-banner')).toBeHidden();
    await expect(page.locator(reader)).toBeEnabled();
    await expect(page.locator('input[name="nm-cfg-additional-fonts"]')).toBeChecked();
    const enabled = await page.locator('#nm-config-options input[type="checkbox"]:enabled').evaluateAll((inputs) => inputs.map((input) => input.name));
    expect(enabled).toEqual([
        'nm-cfg-simplify-tabs',
        'nm-cfg-hide-recommendations',
        'nm-cfg-hide-row2col2',
        'nm-cfg-hide-notices',
        'nm-cfg-nickelmodmanager',
        'nm-cfg-additional-fonts',
        'nm-cfg-koreader',
    ]);
    await expect(page.locator('input[name="nm-cfg-nickelmodmanager"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-custom-menu"]')).toBeChecked();
    for (const id of ['better-typography', 'nickelclock', 'cadmus', 'simpleui']) {
        await expect(page.locator(`input[name="nm-cfg-${id}"]`)).toHaveCount(0);
    }
}

async function manualConfig(page) {
    await goToManualMode(page);
    await page.click('input[name="mode"][value="nickelmenu"]');
    await page.click('#btn-mode-next');
}

for (const mode of ['manual', 'connected']) {
    test(`OS 6 ${mode} can install NickelMenu, fonts and KOReader after opting out of the manager with the Qt6 package`, async ({ page }) => {
        if (mode === 'manual') {
            await manualConfig(page);
            await page.selectOption('#nm-manual-firmware', '6');
            await page.click('#btn-nm-next');
        } else {
            await connectMockDevice(page, { firmware, signedIn: false });
            await page.click('#btn-device-next');
            await page.click('#btn-beta-os-continue');
            await expect(page.locator('#step-mode')).toBeHidden();
            await expect(page.locator('#step-nickelmenu')).toBeVisible();
            await expect(page.locator('#step-nav li')).toHaveText(['Device', 'Configure', 'Backup', 'Review', 'Install']);
            await expect(page.locator('#nm-manual-firmware-field')).toBeHidden();
            await page.click('#btn-nm-next');
        }
        const source = await JSZip.loadAsync(fs.readFileSync(path.join(WEBROOT, 'assets/koreader-kobov5.zip')));
        const expectedReaderBinary = await source.file('koreader/luajit').async('nodebuffer');
        const legacySource = await JSZip.loadAsync(fs.readFileSync(path.join(WEBROOT, 'assets/koreader-kobo.zip')));
        expect(expectedReaderBinary).not.toEqual(await legacySource.file('koreader/luajit').async('nodebuffer'));
        await expectOs6Features(page);
        await page.uncheck('input[name="nm-cfg-nickelmodmanager"]');
        await page.check(reader);
        await expect(page.locator('input[name="nm-cfg-simpleui"]')).toHaveCount(0);
        await page.click('#btn-nm-features-next');
        await skipNmBackup(page);
        await expect(page.locator('#nm-review-list')).toContainText('NickelMenu (Kobo.tgz)');
        await expect(page.locator('#nm-review-list')).not.toContainText('KoboRoot.tgz');
        await expect(page.locator('#nm-review-notices')).toContainText('Choosing Exit in KOReader will ask to restart your Kobo');
        await expect(page.locator('#nm-review-notices')).toContainText('Keep the included KOReader user patch enabled');
        await expect(page.locator('#nm-review-notices')).not.toContainText('Bluetooth');
        if (mode === 'manual') {
            const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-nm-download')]);
            const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
            expect(await zip.file('.kobo/Kobo.tgz').async('nodebuffer')).toEqual(basePackage());
            expect(zip.file('.kobo/KoboRoot.tgz')).toBeNull();
            expect(zip.file('.adds/koreader/koreader.sh')).not.toBeNull();
            expect(await zip.file('.adds/koreader/patches/2-webui-os6-exit.lua').async('string')).toContain('UIManager:askForReboot()');
            expect(await zip.file('.adds/koreader/luajit').async('nodebuffer')).toEqual(expectedReaderBinary);
            expect(Object.keys(zip.files).some((name) => name.startsWith('fonts/') && name.endsWith('.ttf'))).toBe(true);
            const preset = await zip.file('.adds/nm/webui-preset').async('string');
            expect(preset).toContain('KOReader:cmd_spawn');
            expect(preset).not.toContain('Invert Display');
            const manifest = JSON.parse(await zip.file('.kobopatch-webui/nickelmenu.json').async('string'));
            expect(manifest.selected).toEqual(['custom-menu', 'additional-fonts', 'koreader']);
            expect(manifest.meta.installed.firmware).toBe('6.0');
            expect(await zip.file('instructions.txt').async('string')).toContain('This package is for Kobo OS 6.x.');
            await expect(page.locator('#nm-download-version-note')).toContainText('.kobo/Kobo.tgz');
        } else {
            await page.click('#btn-nm-write');
            await expect(page.locator('#step-nm-done')).toBeVisible();
            const archive = await page.evaluate(() => Array.from(window.__mockFS['.kobo']['Kobo.tgz'].bytes));
            expect(Buffer.from(archive)).toEqual(basePackage());
            expect(await mockPathExists(page, '.kobo', 'KoboRoot.tgz')).toBe(false);
            expect(await mockPathExists(page, '.adds', 'koreader', 'koreader.sh')).toBe(true);
            expect(await readMockFile(page, '.adds', 'koreader', 'patches', '2-webui-os6-exit.lua')).toContain('UIManager:askForReboot()');
            const installedReader = await page.evaluate(() => Array.from(window.__mockFS['.adds'].koreader.luajit.bytes));
            expect(Buffer.from(installedReader)).toEqual(expectedReaderBinary);
            expect(await page.evaluate(() => Object.keys(window.__mockFS.fonts).some((name) => name.endsWith('.ttf')))).toBe(true);
            const preset = await readMockFile(page, '.adds', 'nm', 'webui-preset');
            expect(preset).toContain('KOReader:cmd_spawn');
            expect(preset).not.toContain('Invert Display');
            const manifest = JSON.parse(await readMockFile(page, '.kobopatch-webui', 'nickelmenu.json'));
            expect(manifest.selected).toEqual(['custom-menu', 'additional-fonts', 'koreader']);
            expect(manifest.meta.installed.firmware).toBe(firmware);
        }
    });
}

test('changing manual firmware families recalculates the available features and preserves firmware 4 defaults', async ({ page }) => {
    await manualConfig(page);
    await page.click('#btn-nm-next');
    await expect(page.locator('input[name="nm-cfg-additional-fonts"]')).toBeChecked();
    await page.click('#btn-nm-features-back');
    await page.selectOption('#nm-manual-firmware', '6');
    await page.click('#btn-nm-next');
    await expectOs6Features(page);
    await page.click('#btn-nm-features-back');
    await page.selectOption('#nm-manual-firmware', '4');
    await page.click('#btn-nm-next');
    await expect(page.locator('#nm-os6-notice')).toBeHidden();
    await expect(page.locator('input[name="nm-cfg-additional-fonts"]')).toBeEnabled();
    await expect(page.locator('input[name="nm-cfg-additional-fonts"]')).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-nickelmodmanager"]')).toBeEnabled();
    await expect(page.locator('input[name="nm-cfg-nickelmodmanager"]')).not.toBeChecked();
    await expect(page.locator('.nm-config-recommended')).toHaveCount(0);
});

test('an OS 6 modify run preserves unsupported installed mods and removes only a deselected KOReader', async ({ page }) => {
    await connectMockDevice(page, {
        firmware,
        hasNickelMenu: true,
        hasKOReader: true,
        extraAddsFiles: [
            { path: ['nm', 'webui-preset'], content: '# Generated by KoboPatch Web UI\n' },
            { path: ['nickelclock', 'nickelclock.conf'], content: 'keep clock settings' },
        ],
    });
    await goToNmFeatures(page);
    await expect(page.locator(reader)).toBeChecked();
    await expect(page.locator('input[name="nm-cfg-nickelclock"]')).toHaveCount(0);
    await page.uncheck(reader);
    await page.click('#btn-nm-features-next');
    await skipNmBackup(page);
    await expect(page.locator('#nm-review-kept-list')).toContainText('KOReader');
    await expect(page.locator('#nm-review-kept-list')).not.toContainText('NickelClock');
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible();
    expect(await mockPathExists(page, '.adds', 'koreader')).toBe(false);
    expect(await readMockFile(page, '.adds', 'nickelclock', 'nickelclock.conf')).toBe('keep clock settings');
});

test('OS 6 removal writes its uninstall marker and Qt6 package while keeping an unticked KOReader', async ({ page }) => {
    await connectMockDevice(page, { firmware, hasNickelMenu: true, hasKOReader: true });
    await page.click('#btn-device-next');
    await page.click('#btn-beta-os-continue');
    await expect(page.locator('#step-mode')).toBeHidden();
    await page.click('input[name="nm-option"][value="remove"]');
    await page.uncheck('input[name="nm-uninstall-koreader"]');
    await page.click('#btn-nm-next');
    await skipNmBackup(page);
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible();
    expect(await mockPathExists(page, '.adds', 'nm', 'uninstall')).toBe(true);
    expect(await mockPathExists(page, '.adds', 'koreader')).toBe(true);
    expect(await mockPathExists(page, '.kobo', 'KoboRoot.tgz')).toBe(false);
    const archive = await page.evaluate(() => Array.from(window.__mockFS['.kobo']['Kobo.tgz'].bytes));
    expect(Buffer.from(archive)).toEqual(basePackage());
});

test('OS 6 skips mode selection in both directions and keeps the five-step breadcrumb', async ({ page }) => {
    await connectMockDevice(page, { firmware });
    await expect(page.locator('#step-nav li')).toHaveText(['Device', 'Configure', 'Backup', 'Review', 'Install']);
    await page.click('#btn-device-next');
    await page.click('#btn-beta-os-continue');
    await expect(page.locator('#step-nickelmenu')).toBeVisible();
    await expect(page.locator('#step-mode')).toBeHidden();
    await expect(page.locator('#step-nav [aria-current="step"]')).toHaveText('Configure');
    await page.click('#btn-nm-back');
    await expect(page.locator('#step-device')).toBeVisible();
    await expect(page.locator('#step-mode')).toBeHidden();
    await page.click('#btn-device-next');
    await page.click('#btn-beta-os-continue');
    await page.click('#btn-nm-next');
    await page.click('#btn-nm-features-next');
    await expect(page.locator('#step-nav [aria-current="step"]')).toHaveText('Backup');
    await skipNmBackup(page);
    await expect(page.locator('#step-nav [aria-current="step"]')).toHaveText('Review');
    await page.click('#btn-nm-write');
    await expect(page.locator('#step-nm-done')).toBeVisible();
    await expect(page.locator('#step-nav [aria-current="step"]')).toHaveText('Install');
});

for (const firmware of ['6.0.276679', '6.0.999999']) {
    test(`OS ${firmware} warns about beta software before continuing`, async ({ page }) => {
        await connectMockDevice(page, { firmware });
        const dialog = page.locator('#beta-os-dialog');
        await expect(dialog).toBeHidden();
        await page.click('#btn-device-next');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('Your Kobo is running a beta operating system');
        await expect(dialog).toContainText('Some may come from the operating system itself');
        await expect(dialog.locator('.modal-body p')).toHaveCount(2);
        await expect(dialog.locator('.banner')).toHaveCount(0);
        await expect(page.locator('#step-nickelmenu')).toBeHidden();
        await page.click('#btn-beta-os-back');
        await expect(dialog).toBeHidden();
        await expect(page.locator('#step-device')).toBeVisible();
        await page.click('#btn-device-next');
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        await expect(page.locator('#step-device')).toBeVisible();
        await expect(page.locator('#btn-device-next')).toBeFocused();
        await page.click('#btn-device-next');
        await page.click('#btn-beta-os-close');
        await expect(page.locator('#step-device')).toBeVisible();
        await page.click('#btn-device-next');
        await page.click('#btn-beta-os-continue');
        await expect(dialog).toBeHidden();
        await expect(page.locator('#step-nickelmenu')).toBeVisible();
        await expect(page.locator('#step-mode')).toBeHidden();
    });
}

test('firmware 4 continues without a beta warning', async ({ page }) => {
    await connectMockDevice(page);
    await page.click('#btn-device-next');
    await expect(page.locator('#beta-os-dialog')).toBeHidden();
    await expect(page.locator('#step-mode')).toBeVisible();
});
