// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const crypto = require('crypto');
const zlib = require('zlib');
const JSZip = require('jszip');

const { FIRMWARE_PATH, paths, getOriginalTgzSha1 } = require('../../support/paths');
const { hasFirmwareZip } = require('../../support/assets');
const { injectMockDevice, connectMockDevice, overrideFirmwareURLs, goToManualMode, readMockFile, getWrittenFiles } = require('../../support/mock-device');
const { parseTar } = require('../../support/tar');

// Build a custom-patches-files archive (and its checksum) exactly the way the app
// does, so a seeded manifest can reference bytes the app will accept on reload.
async function buildPatchFilesArchive(entries) {
    const { buildAdditionalFilesTgz, sha256Hex } = await import(paths.src('js/patches/additional-files.js'));
    const archiveBytes = await buildAdditionalFilesTgz(entries);
    const sha256 = await sha256Hex(archiveBytes);
    return { archiveBytes, sha256, base64: Buffer.from(archiveBytes).toString('base64') };
}

const VERIFIED_IDENTIFICATION_HINT = 'The hardware UUID and serial prefix match this device.';
const REFURBISHED_IDENTIFICATION_HINT =
    'The hardware UUID matches this device. The serial prefix uses the refurbished-device form, which is expected for some Kobo replacements.';
const REFURBISHED_MODEL_HINT = 'This serial number uses the refurbished-device prefix form, which is expected for some Kobo replacements.';
const MISMATCH_IDENTIFICATION_HINT =
    'The hardware UUID matches this device, but the serial prefix does not match the expected device family. Custom patches are disabled for this device.';
const CLOUD_SYNC_PATCH_NAME = 'Unlock Dropbox and Google Drive support';
const DROPBOX_LINK_ACCOUNT_POLL = 'dropbox_link_account_poll=https://authorize.kobo.com/{region}/{language}/LinkDropbox';
const GOOGLEDRIVE_LINK_ACCOUNT_START = 'googledrive_link_account_start=https://authorize.kobo.com/{region}/{language}/linkcloudstorage/provider/google_drive';
const GOOGLEDRIVE_LINK_ACCOUNT_ENABLED = 'kobo_googledrive_link_account_enabled=True';
const DROPBOX_LINK_ACCOUNT_ENABLED = 'kobo_dropbox_link_account_enabled=True';

const CUSTOM_PATCHES_MANIFEST = JSON.stringify({
    overrides: { 'src/nickel.yaml': { 'Remove footer (row3) on new home screen': true } },
    customized: {},
    meta: { writer: { name: 'kobopatch-webui', version: 'test' } },
});

const customPatchesManifestFile = () => ({
    path: ['.kobopatch-webui', 'custom-patches.json'],
    content: CUSTOM_PATCHES_MANIFEST,
});

/**
 * Read a downloaded patches ZIP and return the embedded KoboRoot.tgz bytes.
 * The download bundles `.kobo/KoboRoot.tgz` alongside the custom-patches manifest.
 */
async function extractKoboRootTgz(download) {
    const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
    return zip.file('.kobo/KoboRoot.tgz').async('nodebuffer');
}

/**
 * A content signature of a KoboRoot.tgz: each entry's path, mode, and a hash of
 * its bytes, sorted by path. This compares the *patched payload* and ignores
 * archive-level metadata (gzip/tar timestamps), which is not reproducible across
 * builds even for identical inputs.
 */
function tgzContentSignature(tgzBytes) {
    const entries = parseTar(zlib.gunzipSync(tgzBytes));
    return Object.entries(entries)
        .map(([path, data]) => ({ path, sha1: crypto.createHash('sha1').update(Buffer.from(data)).digest('hex') }))
        .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Drive the manual flow up to a loaded patches step for 4.45.23646 / kobo13.
 * Collapses the version → channel → confirm sequence that nearly every patch
 * test repeats. Leaves the page on #step-patches with sections rendered.
 */
async function gotoManualPatchesStep(page) {
    await goToManualMode(page);
    await page.click('input[name="mode"][value="patches"]');
    await page.click('#btn-mode-next');
    await expect(page.locator('#step-manual-version')).not.toBeHidden();
    await overrideFirmwareURLs(page);
    await page.selectOption('#manual-version', '4.45.23646');
    await page.selectOption('#manual-model', 'kobo13');
    await page.click('#btn-manual-confirm');
    await expect(page.locator('#step-patches')).not.toBeHidden();
    await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);
}

test.describe('Custom patches', () => {
    test('patches are grouped into themed sections, not by patch file', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await gotoManualPatchesStep(page);

        // Sections are labelled by user-facing theme (the old per-file labels like
        // "Nickel (UI patches)" are gone).
        const labels = await page.locator('.patch-file-section .patch-file-name').allTextContents();
        expect(labels).toContain('Typography & Fonts');
        expect(labels).toContain('Cloud Sync');
        expect(labels).not.toContain('Nickel (UI patches)');

        // A patch keeps its YAML name as identity but can show a friendlier label:
        // "Remove footer (row3) on new home screen" → "Hide home-screen footer row".
        const homeSection = page.locator('.patch-file-section').filter({ has: page.locator('.patch-file-name', { hasText: 'Home & Library' }) });
        await homeSection.locator('summary').click();
        await expect(homeSection.locator('.patch-name', { hasText: 'Hide home-screen footer row' }).first()).toBeVisible();
    });

    test('Advanced toggle switches to the original file-based names and sections', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await gotoManualPatchesStep(page);

        // Themed by default.
        let labels = await page.locator('.patch-file-section .patch-file-name').allTextContents();
        expect(labels).toContain('Typography & Fonts');
        expect(labels).not.toContain('Nickel (UI patches)');

        // Flip the toggle in the Customize Patch List section.
        await page.locator('#patch-about-patches-section > summary').click();
        await page.locator('#patch-original-format').check();

        // Now grouped by source file, under the original kobopatch titles.
        labels = await page.locator('.patch-file-section .patch-file-name').allTextContents();
        expect(labels).toContain('Nickel (UI patches)');
        expect(labels).not.toContain('Typography & Fonts');

        const nickelSection = page.locator('.patch-file-section').filter({ has: page.locator('.patch-file-name', { hasText: 'Nickel (UI patches)' }) });
        await nickelSection.locator('summary').click();
        // The raw YAML name shows instead of the friendlier metadata label.
        await expect(nickelSection.locator('.patch-name', { hasText: 'Remove footer (row3) on new home screen' }).first()).toBeVisible();
        await expect(page.locator('.patch-name', { hasText: 'Hide home-screen footer row' })).toHaveCount(0);

        // Unchecking returns to the themed view.
        await page.locator('#patch-original-format').uncheck();
        labels = await page.locator('.patch-file-section .patch-file-name').allTextContents();
        expect(labels).toContain('Typography & Fonts');
        expect(labels).not.toContain('Nickel (UI patches)');
    });

    test('patch notes surface metadata description and author; editor shows customization tips', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await gotoManualPatchesStep(page);

        // "My 10 line spacing values" (typography) has a description, author, and tips.
        const patchName = page.locator('.patch-name', { hasText: 'My 10 line spacing values' }).first();
        await patchName.locator('xpath=ancestor::details').locator('summary').click();
        const item = patchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]');

        // Notes are collapsed until the help toggle is pressed.
        const notes = item.locator('.patch-notes');
        await expect(notes).toBeHidden();
        await item.locator('.patch-desc-toggle').click();
        await expect(notes).toBeVisible();
        await expect(notes.locator('.patch-author')).toHaveText('Patch by GeoffR');
        await expect(notes.locator('.patch-description')).toContainText('line-spacing slider');

        // The editor surfaces the tips where values are actually changed.
        await item.locator('.patch-edit-btn').click();
        const dialog = page.locator('#patch-editor-dialog');
        await expect(dialog).toBeVisible();
        const tips = dialog.locator('.patch-editor-tips');
        await expect(tips).toBeVisible();
        await expect(tips.locator('li').first()).toContainText('ReplaceFloat');
        await dialog.locator('.patch-editor-cancel').first().click();
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

        // Type a search query (matches against the displayed label)
        await searchInput.fill('home screen');

        // Matching patches remain visible
        await expect(page.locator('.patch-name', { hasText: 'Increase home screen cover size' }).first()).toBeVisible();

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

        const blacklist = JSON.parse(fs.readFileSync(paths.repo('patches', 'blacklist.json'), 'utf-8'));
        const version45 = blacklist['4.45'];
        test.skip(!version45, 'No 4.45 blacklist entries found');

        // Patches show their metadata display label, not the raw YAML name.
        const { getPatchMeta } = await import(paths.src('js/patches/patch-metadata.js'));
        const displayName = (name) => getPatchMeta(name).label || name;

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
                const patchName = page.locator('.patch-name', { hasText: displayName(name) }).first();
                await expect(patchName).toBeVisible();

                const label = patchName.locator('xpath=ancestor::label');
                const input = label.locator('input');
                await expect(input).toBeEnabled();

                const badge = label.locator('.patch-incompatible');
                await expect(badge).toBeVisible();
                await expect(badge).toHaveText('known to fail');
            }
        }

        await page.locator('#patch-about-patches-section > summary').click();
        await page.getByRole('button', { name: 'View incompatible patches for this firmware' }).click();
        const blacklistDialog = page.locator('#patch-blacklist-dialog');
        await expect(blacklistDialog).toBeVisible();
        await expect(blacklistDialog.locator('#patch-blacklist-updated')).toHaveText(/Last updated: \d{4}-\d{2}-\d{2}/);
        await expect(blacklistDialog.locator('#patch-blacklist-description')).toContainText('firmware 4.45.23697');
        await expect(blacklistDialog.locator('#patch-blacklist-description')).toContainText('Patch compatibility may vary');
        await expect(blacklistDialog.locator('#patch-blacklist-current-version')).toHaveText('Your firmware version: 4.45.23646');
        await expect(blacklistDialog.locator('#patch-blacklist-current-version .device-identification-badge--verified')).toHaveCount(0);
        await expect(blacklistDialog.locator('#patch-blacklist-empty')).toBeHidden();
        await expect(blacklistDialog).not.toContainText('src/libnickel.so.1.0.0.yaml');
        // The dialog mirrors the patch list's themed section labels, not file names.
        await expect(blacklistDialog).toContainText('Privacy & Features');
        await expect(blacklistDialog).toContainText('PDF');

        for (const patchNames of Object.values(version45)) {
            for (const name of patchNames) {
                await expect(blacklistDialog).toContainText(displayName(name));
            }
        }

        await blacklistDialog.locator('#btn-patch-blacklist-close').click();
        await expect(blacklistDialog).toBeHidden();
    });

    test('blacklist dialog match tooltip stays inside the modal', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await connectMockDevice(page, { hasNickelMenu: false, firmware: '4.45.23697', overrideFirmware: true });

        await page.click('#btn-device-next');
        await page.click('input[name="mode"][value="patches"]');
        await page.click('#btn-mode-next');
        await expect(page.locator('#patch-container .patch-file-section')).not.toHaveCount(0);

        await page.locator('#patch-about-patches-section > summary').click();
        await page.getByRole('button', { name: 'View incompatible patches for this firmware' }).click();
        const blacklistDialog = page.locator('#patch-blacklist-dialog');
        await expect(blacklistDialog).toBeVisible();

        const badge = blacklistDialog.locator('.device-identification-badge--verified');
        await expect(badge).toBeVisible();
        await badge.hover();

        const tooltip = blacklistDialog.locator('#patch-blacklist-version-tooltip');
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toHaveText('Your firmware version matches the version that was tested');

        const tooltipBox = await tooltip.boundingBox();
        const contentBox = await blacklistDialog.locator('.patch-blacklist-dialog-content').boundingBox();
        expect(tooltipBox.x).toBeGreaterThanOrEqual(contentBox.x);
        expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(contentBox.x + contentBox.width + 1);
        expect(tooltipBox.y).toBeGreaterThanOrEqual(contentBox.y);
        expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(contentBox.y + contentBox.height + 1);
    });

    test('patch edit button opens editor dialog with patch YAML', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await gotoManualPatchesStep(page);

        // Find a known patch and open its section, then click its edit button
        const patchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
        await patchName.locator('xpath=ancestor::details').locator('summary').click();
        await expect(patchName).toBeVisible();
        const patchItem = patchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]');
        const editBtn = patchItem.locator('.patch-edit-btn');
        await expect(editBtn).toBeVisible();
        await editBtn.click();

        // Dialog should be open with the patch YAML
        const dialog = page.locator('#patch-editor-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.patch-editor-title')).toContainText('Reduce top/bottom page spacer');

        // Textarea should contain the patch YAML
        const textarea = dialog.locator('.patch-editor-textarea');
        await expect(textarea).toBeVisible();
        const initialYaml = await textarea.inputValue();
        expect(initialYaml).toContain('Reduce top/bottom page spacer');
        expect(initialYaml).toContain('min-height: 12px');

        // Validate button should report valid YAML
        await dialog.locator('.patch-editor-validate').click();
        await expect(dialog.locator('.patch-editor-status--ok')).toBeVisible();

        // Modify a value in the YAML
        const editedYaml = initialYaml.replace('min-height: 12px', 'min-height: 99px');
        await textarea.fill(editedYaml);

        // Validate the edited YAML
        await dialog.locator('.patch-editor-validate').click();
        await expect(dialog.locator('.patch-editor-status--ok')).toBeVisible();

        // Save and close
        await dialog.locator('.patch-editor-save').click();
        await expect(dialog).not.toBeVisible();

        // Re-open the editor to verify persistence. The section stays expanded across
        // the post-save re-render, so re-query the patch directly without toggling it.
        const reOpenedPatchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
        await expect(reOpenedPatchName).toBeVisible();
        const reOpenedEditBtn = reOpenedPatchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]').locator('.patch-edit-btn');
        await reOpenedEditBtn.click();
        await expect(dialog).toBeVisible();
        const savedYaml = await textarea.inputValue();
        expect(savedYaml).toContain('min-height: 99px');
        expect(savedYaml).not.toContain('min-height: 12px');

        // Close dialog
        await dialog.locator('.modal-footer .patch-editor-cancel').click();
        await expect(dialog).not.toBeVisible();
    });

    test('editing a patch keeps the active search query and filtered view', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await gotoManualPatchesStep(page);

        // The patches all live in the DOM (inside collapsed sections); the search
        // below re-expands whichever section holds a match, so nothing to open here.

        // Search for a query that matches the patch we'll edit.
        const searchInput = page.locator('.patch-search');
        await searchInput.fill('spacer');
        await expect(page.locator('.patch-search-clear')).toBeVisible();
        // The filter is active: some patches are hidden.
        await expect(page.locator('.patch-item-hidden')).not.toHaveCount(0);

        const patchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
        await expect(patchName).toBeVisible();
        const editBtn = patchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]').locator('.patch-edit-btn');
        await editBtn.click();

        // Edit a value and save (this re-renders the patch list).
        const dialog = page.locator('#patch-editor-dialog');
        await expect(dialog).toBeVisible();
        const textarea = dialog.locator('.patch-editor-textarea');
        const editedYaml = (await textarea.inputValue()).replace('min-height: 12px', 'min-height: 77px');
        await textarea.fill(editedYaml);
        await dialog.locator('.patch-editor-save').click();
        await expect(dialog).not.toBeVisible();

        // The search box keeps its query and the filtered view is preserved across
        // the post-save re-render — not reset to showing every patch.
        await expect(page.locator('.patch-search')).toHaveValue('spacer');
        await expect(page.locator('.patch-search-clear')).toBeVisible();
        await expect(page.locator('.patch-item-hidden')).not.toHaveCount(0);
        await expect(patchName).toBeVisible();
    });

    test('patch editor validation rejects empty and invalid YAML', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await gotoManualPatchesStep(page);

        // Find a patch, open its section, and open the editor
        const patchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
        await patchName.locator('xpath=ancestor::details').locator('summary').click();
        await expect(patchName).toBeVisible();
        const editBtn = patchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]').locator('.patch-edit-btn');
        await editBtn.click();

        const dialog = page.locator('#patch-editor-dialog');
        await expect(dialog).toBeVisible();
        const textarea = dialog.locator('.patch-editor-textarea');
        const statusEl = dialog.locator('.patch-editor-status');

        // Test empty content
        await textarea.fill('');
        await dialog.locator('.patch-editor-validate').click();
        await expect(statusEl).toContainText('cannot be empty');
        await expect(dialog.locator('.patch-editor-status--error')).toBeVisible();

        // Test invalid YAML (malformed indentation)
        await textarea.fill('some: random\n  - yaml: content');
        await dialog.locator('.patch-editor-validate').click();
        await expect(statusEl).toContainText('YAML error');
        await expect(dialog.locator('.patch-editor-status--error')).toBeVisible();

        // Test that save is blocked when invalid (dialog stays open)
        await dialog.locator('.patch-editor-save').click();
        await expect(dialog).toBeVisible();

        // Close dialog without saving
        await dialog.locator('.modal-footer .patch-editor-cancel').click();
        await expect(dialog).not.toBeVisible();
    });

    test('editing a patch value changes the output KoboRoot.tgz', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        // --- First build: edited patch ---
        await gotoManualPatchesStep(page);

        // Open the patch's section, edit patch value
        const patchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
        await patchName.locator('xpath=ancestor::details').locator('summary').click();
        await expect(patchName).toBeVisible();
        const patchItem = patchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]');
        const editBtn = patchItem.locator('.patch-edit-btn');
        await editBtn.click();

        const dialog = page.locator('#patch-editor-dialog');
        const textarea = dialog.locator('.patch-editor-textarea');
        const initialYaml = await textarea.inputValue();
        const editedYaml = initialYaml.replace('min-height: 12px', 'min-height: 99px');
        await textarea.fill(editedYaml);
        await dialog.locator('.patch-editor-validate').click();
        await expect(dialog.locator('.patch-editor-status--ok')).toBeVisible();
        await dialog.locator('.patch-editor-save').click();
        await expect(dialog).not.toBeVisible();

        // Enable the patch
        await patchName.locator('xpath=ancestor::label').locator('input').check();
        await expect(page.locator('#patch-count-hint')).toContainText('1 patch selected');

        // Build and download
        await page.click('#btn-patches-next');
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await page.click('#btn-build');
        await expect(page.locator('#step-done')).toBeVisible({ timeout: 240_000 });
        await expect(page.locator('#build-status')).toContainText('Patching complete');
        const [dlEdited] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);
        const shaEdited = crypto
            .createHash('sha1')
            .update(await extractKoboRootTgz(dlEdited))
            .digest('hex');

        // --- Second build: same patch, default (unedited) ---
        await page.goto('/');
        await gotoManualPatchesStep(page);

        // Enable the same patch WITHOUT editing
        const patchName2 = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
        await patchName2.locator('xpath=ancestor::details').locator('summary').click();
        await expect(patchName2).toBeVisible();
        await patchName2.locator('xpath=ancestor::label').locator('input').check();
        await expect(page.locator('#patch-count-hint')).toContainText('1 patch selected');

        // Build and download
        await page.click('#btn-patches-next');
        await expect(page.locator('#step-firmware')).not.toBeHidden();
        await page.click('#btn-build');
        await expect(page.locator('#step-done')).toBeVisible({ timeout: 240_000 });
        await expect(page.locator('#build-status')).toContainText('Patching complete');
        const [dlDefault] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);
        const shaDefault = crypto
            .createHash('sha1')
            .update(await extractKoboRootTgz(dlDefault))
            .digest('hex');

        // The edited patch must produce different output
        expect(shaEdited).not.toBe(shaDefault);
    });

    test('edited patch shows a "modified" indicator that clears when reverted', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await gotoManualPatchesStep(page);

        const patchLabel = 'Reduce top/bottom page spacer';
        const itemFor = () => page.locator('.patch-name', { hasText: patchLabel }).first().locator('xpath=ancestor::div[contains(@class, "patch-item")]');
        await page.locator('.patch-name', { hasText: patchLabel }).first().locator('xpath=ancestor::details').locator('summary').click();

        // No indicator before any edit.
        await expect(itemFor().locator('.patch-modified')).toHaveCount(0);

        const dialog = page.locator('#patch-editor-dialog');
        const textarea = dialog.locator('.patch-editor-textarea');

        // Edit a value → indicator appears.
        await itemFor().locator('.patch-edit-btn').click();
        const original = await textarea.inputValue();
        await textarea.fill(original.replace('min-height: 12px', 'min-height: 77px'));
        await dialog.locator('.patch-editor-save').click();
        await expect(dialog).not.toBeVisible();
        await expect(itemFor().locator('.patch-modified')).toBeVisible();

        // Edit back to the original → indicator clears.
        await itemFor().locator('.patch-edit-btn').click();
        await textarea.fill(original);
        await dialog.locator('.patch-editor-save').click();
        await expect(dialog).not.toBeVisible();
        await expect(itemFor().locator('.patch-modified')).toHaveCount(0);
    });

    test('going back after editing a patch asks for confirmation', async ({ page }) => {
        test.skip(!hasFirmwareZip(), `Firmware not found at ${FIRMWARE_PATH}`);

        await gotoManualPatchesStep(page);

        const patchName = page.locator('.patch-name', { hasText: 'Reduce top/bottom page spacer' }).first();
        await patchName.locator('xpath=ancestor::details').locator('summary').click();
        const patchItem = patchName.locator('xpath=ancestor::div[contains(@class, "patch-item")]');

        // Edit a patch so there are unsaved edits.
        await patchItem.locator('.patch-edit-btn').click();
        const dialog = page.locator('#patch-editor-dialog');
        const textarea = dialog.locator('.patch-editor-textarea');
        const original = await textarea.inputValue();
        await textarea.fill(original.replace('min-height: 12px', 'min-height: 77px'));
        await dialog.locator('.patch-editor-save').click();
        await expect(dialog).not.toBeVisible();

        // Dismissing the confirm keeps us on the patches step.
        let prompted = false;
        page.once('dialog', (d) => {
            prompted = true;
            expect(d.message()).toContain('discard');
            d.dismiss();
        });
        await page.click('#btn-patches-back');
        expect(prompted).toBe(true);
        await expect(page.locator('#step-patches')).not.toBeHidden();

        // Accepting the confirm navigates back (manual mode → version step).
        page.once('dialog', (d) => d.accept());
        await page.click('#btn-patches-back');
        await expect(page.locator('#step-manual-version')).not.toBeHidden();
    });
});
