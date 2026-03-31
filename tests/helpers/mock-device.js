const { expect } = require('@playwright/test');

/**
 * Inject a mock File System Access API into the page, simulating a Kobo Libra Color.
 * The mock provides:
 *   - .kobo/version file with serial N4280A0000000 and firmware 4.45.23646
 *   - Optionally a .adds/nm/ directory (to simulate NickelMenu being installed)
 *   - In-memory filesystem that tracks all writes for verification
 */
async function injectMockDevice(page, opts = {}) {
  const firmware = opts.firmware || '4.45.23646';
  const serial = opts.serial || 'N4280A0000000';
  await page.evaluate(({ hasNickelMenu, hasKoreader, hasReaderlyFonts, hasScreensaver, hasExistingExcludeCalibre, firmware, serial }) => {
    const filesystem = {
      '.kobo': {
        _type: 'dir',
        'version': {
          _type: 'file',
          content: serial + ',4.9.77,' + firmware + ',4.9.77,4.9.77,00000000-0000-0000-0000-000000000390',
        },
        'Kobo': {
          _type: 'dir',
          'Kobo eReader.conf': {
            _type: 'file',
            content: hasExistingExcludeCalibre
              ? '[General]\nsome=setting\n[FeatureSettings]\nExcludeSyncFolders=(calibre|\\.(?!kobo|adobe|calibre).+|([^.][^/]*/)+\\..+)\n'
              : '[General]\nsome=setting\n',
          },
        },
      },
    };

    if (hasNickelMenu) {
      filesystem['.adds'] = {
        _type: 'dir',
        'nm': {
          _type: 'dir',
          'items': { _type: 'file', content: 'menu_item:main:test:skip:' },
        },
      };
    }

    if (hasKoreader) {
      if (!filesystem['.adds']) filesystem['.adds'] = { _type: 'dir' };
      filesystem['.adds']['koreader'] = {
        _type: 'dir',
        'koreader.sh': { _type: 'file', content: '#!/bin/sh' },
      };
    }

    if (hasReaderlyFonts) {
      filesystem['fonts'] = {
        _type: 'dir',
        'KF_Readerly-Regular.ttf': { _type: 'file', content: '' },
        'KF_Readerly-Italic.ttf': { _type: 'file', content: '' },
        'KF_Readerly-Bold.ttf': { _type: 'file', content: '' },
        'KF_Readerly-BoldItalic.ttf': { _type: 'file', content: '' },
      };
    }

    if (hasScreensaver) {
      if (!filesystem['.kobo']['screensaver']) {
        filesystem['.kobo']['screensaver'] = { _type: 'dir' };
      }
      filesystem['.kobo']['screensaver']['moon.png'] = { _type: 'file', content: '' };
    }

    window.__mockFS = filesystem;
    window.__mockWrittenFiles = {};

    function makeFileHandle(dirNode, fileName, pathPrefix) {
      return {
        getFile: async () => {
          const fileNode = dirNode[fileName];
          const content = fileNode ? (fileNode.content || '') : '';
          return {
            text: async () => content,
            arrayBuffer: async () => new TextEncoder().encode(content).buffer,
          };
        },
        createWritable: async () => {
          const chunks = [];
          return {
            write: async (chunk) => { chunks.push(chunk); },
            close: async () => {
              const first = chunks[0];
              const bytes = first instanceof Uint8Array ? first : new TextEncoder().encode(String(first));
              if (!dirNode[fileName]) dirNode[fileName] = { _type: 'file' };
              dirNode[fileName].content = new TextDecoder().decode(bytes);
              const fullPath = pathPrefix ? pathPrefix + '/' + fileName : fileName;
              window.__mockWrittenFiles[fullPath] = true;
            },
          };
        },
      };
    }

    function makeDirHandle(node, name, pathPrefix) {
      const currentPath = pathPrefix ? pathPrefix + '/' + name : name;
      return {
        name: name,
        kind: 'directory',
        getDirectoryHandle: async (childName, opts2) => {
          if (node[childName] && node[childName]._type === 'dir') {
            return makeDirHandle(node[childName], childName, currentPath);
          }
          if (opts2 && opts2.create) {
            node[childName] = { _type: 'dir' };
            return makeDirHandle(node[childName], childName, currentPath);
          }
          throw new DOMException('Not found: ' + childName, 'NotFoundError');
        },
        getFileHandle: async (childName, opts2) => {
          if (node[childName] && node[childName]._type === 'file') {
            return makeFileHandle(node, childName, currentPath);
          }
          if (opts2 && opts2.create) {
            node[childName] = { _type: 'file', content: '' };
            return makeFileHandle(node, childName, currentPath);
          }
          throw new DOMException('Not found: ' + childName, 'NotFoundError');
        },
        removeEntry: async (childName) => {
          if (node[childName]) {
            delete node[childName];
            return;
          }
          throw new DOMException('Not found: ' + childName, 'NotFoundError');
        },
      };
    }

    const rootHandle = makeDirHandle(filesystem, 'KOBOeReader', '');
    window.showDirectoryPicker = async () => rootHandle;
  }, {
    hasNickelMenu: opts.hasNickelMenu || false,
    hasKoreader: opts.hasKoreader || false,
    hasReaderlyFonts: opts.hasReaderlyFonts || false,
    hasScreensaver: opts.hasScreensaver || false,
    hasExistingExcludeCalibre: opts.hasExistingExcludeCalibre || false,
    firmware,
    serial,
  });
}

/**
 * Inject mock device, optionally override firmware URLs, and connect.
 */
async function connectMockDevice(page, opts = {}) {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('KoboPatch');
  await injectMockDevice(page, opts);
  if (opts.overrideFirmware) {
    await overrideFirmwareURLs(page);
  }
  await page.click('#btn-connect');
  await expect(page.locator('#step-connect-instructions')).not.toBeHidden();
  await page.click('#btn-connect-ready');
  await expect(page.locator('#step-device')).not.toBeHidden();
  await expect(page.locator('#device-model')).toHaveText('Kobo Libra Colour');
  await expect(page.locator('#device-firmware')).toHaveText('4.45.23646');
  await expect(page.locator('#device-status')).toContainText('recognized');
}

/**
 * Override firmware download URLs to point at the local test server.
 */
async function overrideFirmwareURLs(page) {
  await page.evaluate(() => {
    for (const version of Object.keys(FIRMWARE_DOWNLOADS)) {
      for (const prefix of Object.keys(FIRMWARE_DOWNLOADS[version])) {
        FIRMWARE_DOWNLOADS[version][prefix] = '/_test_firmware.zip';
      }
    }
  });
}

/**
 * Navigate to manual mode.
 */
async function goToManualMode(page) {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('KoboPatch');
  await page.click('#btn-manual');
  await expect(page.locator('#step-mode')).not.toBeHidden();
}

/**
 * Read a file's content from the mock filesystem.
 */
async function readMockFile(page, ...pathParts) {
  return page.evaluate((parts) => {
    let node = window.__mockFS;
    for (const part of parts) {
      if (!node || !node[part]) return null;
      node = node[part];
    }
    return node && node._type === 'file' ? (node.content || '') : null;
  }, pathParts);
}

/**
 * Check whether a path exists in the mock filesystem.
 */
async function mockPathExists(page, ...pathParts) {
  return page.evaluate((parts) => {
    let node = window.__mockFS;
    for (const part of parts) {
      if (!node || !node[part]) return false;
      node = node[part];
    }
    return true;
  }, pathParts);
}

/**
 * Get the list of written file paths from the mock device.
 */
async function getWrittenFiles(page) {
  return page.evaluate(() => Object.keys(window.__mockWrittenFiles));
}

module.exports = {
  injectMockDevice,
  connectMockDevice,
  overrideFirmwareURLs,
  goToManualMode,
  readMockFile,
  mockPathExists,
  getWrittenFiles,
};
