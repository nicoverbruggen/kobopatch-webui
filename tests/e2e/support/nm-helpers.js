// @ts-check
// Shared constants and helpers for the NickelMenu E2E specs, which are split
// across nickelmenu-install / nickelmenu-config / nickelmenu-removal spec files.
const { expect } = require('@playwright/test');

const EXCLUDE_SYNC_FOLDERS_LINE = String.raw`ExcludeSyncFolders=(\\.(?!kobo|adobe).+|([^.][^/]*/)+\\..+)`;
const EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE = String.raw`ExcludeSyncFolders=(calibre|\\.(?!kobo|adobe|calibre).+|([^.][^/]*/)+\\..+)`;
const LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_LINE = 'ExcludeSyncFolders=((?!kobo|adobe).+|([^.][^/]*/)+.+)';
const LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE = 'ExcludeSyncFolders=(calibre|(?!kobo|adobe|calibre).+|([^.][^/]*/)+.+)';
const QUADRUPLE_BACKSLASH_DOT = String.raw`\\\\.`;

async function skipNmBackup(page) {
  await expect(page.locator('#step-nm-backup')).not.toBeHidden();
  if (await page.locator('#nm-backup-options').isVisible()) {
    await page.click('input[name="nm-backup-option"][value="skip"]');
  }
  await page.click('#btn-nm-backup-next');
}

// Feature-selection sections are collapsible; the last ("Advanced") starts
// collapsed, so open it before interacting with options it contains.
async function openNmSection(page, title) {
  const section = page.locator('details.nm-config-section', {
    has: page.locator('.nm-config-section-title', { hasText: title }),
  });
  if (!(await section.evaluate(el => el.open))) {
    await section.locator('summary').click();
  }
}

// Navigate a connected device to the preset feature-selection step.
async function goToNmFeatures(page) {
  await page.click('#btn-device-next');
  await page.click('input[name="mode"][value="nickelmenu"]');
  await page.click('#btn-mode-next');
  await expect(page.locator('#step-nickelmenu')).not.toBeHidden();
  await page.click('input[name="nm-option"][value="preset"]');
  await page.click('#btn-nm-next');
  await expect(page.locator('#step-nm-features')).not.toBeHidden();
}

module.exports = {
  EXCLUDE_SYNC_FOLDERS_LINE,
  EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE,
  LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_LINE,
  LEGACY_BROKEN_EXCLUDE_SYNC_FOLDERS_CALIBRE_LINE,
  QUADRUPLE_BACKSLASH_DOT,
  skipNmBackup,
  openNmSection,
  goToNmFeatures,
};
