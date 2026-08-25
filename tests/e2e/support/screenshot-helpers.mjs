/**
 * Capture screenshots of every step in the wizard.
 * Uses the same Playwright test infrastructure and dev server as the E2E tests.
 * Runs once per project (mobile + desktop) defined in screenshots.config.js.
 * Every screen is captured in both light and dark mode.
 * Writes into screenshots/<project>/<theme>/{manual,connected,edge-cases}/...
 *
 * Run: ./run-screenshots.sh
 */
import { expect } from '@playwright/test';
import { injectMockDevice, overrideFirmwareURLs } from './mock-device.js';
import { hasFirmwareZip } from './assets.js';
import { buildAdditionalFilesTgz, sha256Hex } from '../../../src/js/patches/additional-files.js';

export const THEMES = ['light', 'dark'];

// Force a theme instantly (no transition), mirroring the app's own swap so the
// screenshot never catches a half-animated colour.
export const setTheme = (page, theme) =>
    page.evaluate((t) => {
        const root = document.documentElement;
        root.classList.add('theme-no-transition');
        root.setAttribute('data-theme', t);
        void root.offsetWidth;
        root.classList.remove('theme-no-transition');
    }, theme);

export const shot = async (page, folder, name, testInfo) => {
    const project = testInfo.project.name;
    await page.waitForTimeout(200);
    for (const theme of THEMES) {
        await setTheme(page, theme);
        await page.screenshot({ path: `screenshots/${project}/${theme}/${folder}/${name}.png`, fullPage: true });
    }
    // Leave the page on the default light theme so later steps start from a known state.
    await setTheme(page, 'light');
};

export const SCREENSHOT_DIRS = {
    manualNickelMenu: 'manual/nickelmenu',
    manualPatches: 'manual/patches',
    connectedNickelMenu: 'connected/nickelmenu/install',
    connectedNickelMenuModify: 'connected/nickelmenu/modify',
    connectedNickelMenuRemoval: 'connected/nickelmenu/removal',
    connectedNickelMenuFactory: 'connected/nickelmenu/factory-reset',
    connectedPatches: 'connected/patches',
    edgeConnection: 'edge-cases/connection',
    edgeDeviceWrite: 'edge-cases/device-write',
    edgeDownload: 'edge-cases/download',
    edgeCompatibility: 'edge-cases/compatibility',
    edgeAnalytics: 'edge-cases/analytics',
    edgeDialogs: 'edge-cases/dialogs',
    edgeNickelMenu: 'edge-cases/nickelmenu',
    edgeRestore: 'edge-cases/restore',
};

/**
 * Open a collapsed section on the NickelMenu feature-selection step (e.g. the
 * "Advanced" section, which starts collapsed) so its options are visible in
 * the shot. Mirrors openNmSection in support/nm-helpers.js.
 */
export const openNmFeatureSection = async (page, title) => {
    const section = page.locator('details.nm-config-section', {
        has: page.locator('.nm-config-section-title', { hasText: title }),
    });
    if (!(await section.evaluate((el) => el.open))) {
        await section.locator('summary').click();
    }
};

/** Dismiss the mobile warning modal if it's open. */
export const dismissMobileModal = async (page) => {
    const dialog = page.locator('#mobile-dialog');
    if (await dialog.evaluate((el) => el.open).catch(() => false)) {
        await page.click('#btn-mobile-continue');
        await expect(dialog).not.toBeVisible();
    }
};

export const makeKOReaderAvailable = async (_page) => {
    // No-op: add-on availability is now baked into the bundle from installables.lock
    // at build time (Vite define), not probed at runtime, so it can't be forced via
    // a route. The screenshot/e2e build runs setup:installables, so KOReader is present
    // and marked available already.
};

export const shotNickelMenuCustomizeModal = async (page, folder, name, testInfo) => {
    await page.getByRole('button', { name: 'Customize NickelMenu preset tab' }).click();
    const dialog = page.locator('#nm-customize-dialog');
    await expect(dialog).toBeVisible();
    await shot(page, folder, name, testInfo);
    await page.click('#btn-nm-customize-close');
    await expect(dialog).not.toBeVisible();
};

export const shotNickelMenuTabsModal = async (page, folder, name, testInfo) => {
    await page.getByRole('button', { name: 'Customize simplified navigation tabs' }).click();
    const dialog = page.locator('#nm-tabs-dialog');
    await expect(dialog).toBeVisible();
    // The live preview reflects the seeded default labels/visibility.
    await expect(dialog.locator('#nm-tabs-preview .nm-tabs-preview-tab').first()).toBeVisible();
    await shot(page, folder, name, testInfo);
    await page.click('#btn-nm-tabs-close');
    await expect(dialog).not.toBeVisible();
};

export const shotNickelMenuFontsModal = async (page, folder, name, testInfo) => {
    await page.getByRole('button', { name: 'Select which additional fonts are installed' }).click();
    const dialog = page.locator('#nm-fonts-dialog');
    await expect(dialog).toBeVisible();
    // The family lists are rendered from the generated catalogue on open, and
    // the type specimens fill in once font-previews.json is fetched.
    await expect(dialog.locator('#nm-fonts-core-list input[type="checkbox"]').first()).toBeVisible();
    await expect(dialog.locator('.nm-fonts-item-preview').first()).toBeVisible();
    await shot(page, folder, name, testInfo);
    await page.click('#btn-nm-fonts-close');
    await expect(dialog).not.toBeVisible();
};

export const selectManualPatchesModel = async (page) => {
    await page.selectOption('#manual-version', { index: 1 });
    await expect(page.locator('#manual-model')).not.toBeHidden();
    await page.selectOption('#manual-model', { index: 1 });
    await page.click('#btn-manual-confirm');
};

export const capturePatchesBuildingScreen = async (page, folder, name, testInfo, hint) => {
    await page.evaluate((waitHint) => {
        for (const step of document.querySelectorAll('.step')) step.hidden = true;
        document.getElementById('step-building').hidden = false;
        document.getElementById('build-progress').textContent = 'Downloading firmware...';
        document.getElementById('build-wait-hint').textContent = waitHint;
        document.getElementById('build-log').textContent = 'Download started...\n';
    }, hint);
    await expect(page.locator('#step-building')).not.toBeHidden();
    await shot(page, folder, name, testInfo);
};

export const connectToDeviceScreen = async (page, device = {}) => {
    await page.goto('/');
    await dismissMobileModal(page);
    await injectMockDevice(page, device);
    await page.click('#btn-connect');
    await page.click('#btn-connect-ready');
    await expect(page.locator('#step-device')).not.toBeHidden();
};

export const poseRestoreDoneScreen = async (page, { manual = false, written = false, downloaded = false } = {}) => {
    await page.evaluate(
        ({ isManual, isWritten, isDownloaded }) => {
            for (const step of document.querySelectorAll('.step')) step.hidden = true;
            document.getElementById('step-done').hidden = false;
            const nav = document.getElementById('step-nav');
            nav.hidden = false;
            nav.querySelectorAll('li').forEach((li, index) => {
                const stepNum = index + 1;
                li.classList.toggle('done', stepNum < 5);
                li.classList.toggle('active', stepNum === 5);
                if (stepNum === 5) {
                    li.setAttribute('aria-current', 'step');
                } else {
                    li.removeAttribute('aria-current');
                }
            });
            document.getElementById('build-status').innerHTML =
                'Software extracted. <strong>KoboRoot.tgz</strong> (1.2 MB) is ready. ' +
                'This will restore the original unpatched software. ' +
                (isManual ? 'Download the file and copy it to your Kobo.' : 'Write it directly to your connected Kobo, or download for manual installation.');
            document.getElementById('done-log').textContent = [
                'Download complete: 150.0 MB',
                'Extracting original KoboRoot.tgz from firmware...',
                'Extracted KoboRoot.tgz: 1.2 MB',
            ].join('\n');

            const writeButton = document.getElementById('btn-write');
            writeButton.hidden = isManual;
            writeButton.disabled = false;
            writeButton.className = isWritten ? 'btn-success' : 'primary';
            writeButton.textContent = isWritten ? 'Written' : 'Write to Kobo';

            const downloadButton = document.getElementById('btn-download');
            downloadButton.disabled = false;
            document.getElementById('write-instructions').hidden = !isWritten;
            document.getElementById('download-instructions').hidden = !isDownloaded;
            document.getElementById('download-device-name').textContent = 'Kobo Libra Colour';
            document.getElementById('existing-tgz-warning').hidden = true;
        },
        { isManual: manual, isWritten: written, isDownloaded: downloaded },
    );
    await expect(page.locator('#step-done')).not.toBeHidden();
};

export { injectMockDevice, overrideFirmwareURLs, hasFirmwareZip, buildAdditionalFilesTgz, sha256Hex };
