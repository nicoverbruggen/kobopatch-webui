import test from 'node:test';
import assert from 'node:assert/strict';

import customMenu from '../../src/js/nickelmenu/features/custom-menu/index.js';
import screensaver from '../../src/js/nickelmenu/features/screensaver/index.js';

// screensaver is used as the stand-in for "an optional feature with files to
// remove" in the removal tests (better-typography's cleanup is now conf-only).
import {
    buildExcludeSyncFoldersLine,
    legacyBrokenExcludeSyncFoldersLines,
} from '../../src/js/kobo/sync-exclusions.js';
import {
    executeNickelMenuRemoval,
    hasAddsDirectoriesRequiringSyncExclusions,
    nickelMenuUninstallMarkerPath,
} from '../../src/js/nickelmenu/uninstaller.js';
import { AuditLog } from '../../src/js/kobo/audit-log.js';
import {
    RecordingDevice,
    createInstaller,
    createProgressRecorder,
    koboEReaderConfPath,
    koboRootTgzPath,
    text,
} from './test-helpers.js';

function createWarnRecorder() {
    const messages = [];
    return {
        messages,
        warn(...args) {
            messages.push(args);
        },
    };
}

function pathString(pathParts) {
    return pathParts.join('/');
}

test('hasAddsDirectoriesRequiringSyncExclusions ignores only the NickelMenu directory', () => {
    assert.equal(hasAddsDirectoriesRequiringSyncExclusions([
        { name: 'nm', kind: 'directory' },
    ]), false);

    assert.equal(hasAddsDirectoriesRequiringSyncExclusions([
        { name: 'nm', kind: 'directory' },
        { name: 'scripts', kind: 'directory' },
    ]), true);

    assert.equal(hasAddsDirectoriesRequiringSyncExclusions([
        { name: 'nm', kind: 'directory' },
        { name: 'koreader', kind: 'directory' },
    ]), true);
});

test('executeNickelMenuRemoval removes NickelMenu assets, optional feature files, and creates uninstall marker', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.adds/nm',
            '.kobo/screensaver',
            { path: '.kobo/screensaver/moon.png', kind: 'file' },
        ],
    });
    const progress = createProgressRecorder();

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [screensaver],
        shouldRemoveSyncExclusions: async () => false,
        onProgress: progress,
    });

    assert.deepEqual(device.writePaths(), [
        koboRootTgzPath,
        pathString(nickelMenuUninstallMarkerPath),
    ]);
    // Optional cleanup runs after the uninstall marker: the screensaver image is removed.
    assert.deepEqual(device.removePaths(), [
        '.adds/nm',
        '.kobo/screensaver/moon.png',
    ]);
    assert.deepEqual(device.removalFor('.adds/nm').options, { recursive: true });
    assert.equal(device.writeFor(pathString(nickelMenuUninstallMarkerPath)).data.length, 0);
    assert.deepEqual(progress.messages, [
        'Writing KoboRoot.tgz...',
        'Removing NickelMenu assets...',
        'Creating uninstall marker...',
        'Removing Screensaver...',
    ]);
});

test('executeNickelMenuRemoval writes an audit log of the removal steps', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.adds/nm',
            '.kobo/screensaver',
            { path: '.kobo/screensaver/moon.png', kind: 'file' },
        ],
    });
    const audit = new AuditLog('remove-nickelmenu', new Date(2026, 5, 11, 14, 30));

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [screensaver],
        shouldRemoveSyncExclusions: async () => false,
        audit,
    });

    const logPath = '.kobopatch-webui/logs/26-06-11_14-30-remove-nickelmenu.log';
    assert.ok(device.writePaths().includes(logPath));
    const log = text(device.writeFor(logPath).data);
    assert.match(log, /Removing NickelMenu: wrote \.kobo\/KoboRoot\.tgz/);
    assert.match(log, /Removed \.adds\/nm/);
    assert.match(log, /Removed \.kobo\/screensaver\/moon\.png/);
    assert.match(log, /Wrote uninstall marker/);
});

test('executeNickelMenuRemoval removes selected feature cleanup paths only', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.adds/nm',
            '.kobo/screensaver',
            { path: '.kobo/screensaver/moon.png', kind: 'file' },
            { path: '.kobo/screensaver/user.png', kind: 'file' },
        ],
    });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [screensaver],
        shouldRemoveSyncExclusions: async () => false,
    });

    assert.deepEqual(device.removePaths(), [
        '.adds/nm',
        '.kobo/screensaver/moon.png',
    ]);
    assert.deepEqual(device.removalFor('.kobo/screensaver/moon.png').options, { recursive: false });
});

test('executeNickelMenuRemoval ignores optional missing removal paths and continues', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.kobo/screensaver',
            { path: '.kobo/screensaver/moon.png', kind: 'file' },
        ],
        failRemovePaths: ['.adds/nm'],
    });
    const logger = createWarnRecorder();

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [screensaver],
        shouldRemoveSyncExclusions: async () => false,
        logger,
    });

    assert.deepEqual(device.writePaths(), [
        koboRootTgzPath,
        pathString(nickelMenuUninstallMarkerPath),
    ]);
    assert.deepEqual(device.removePaths(), [
        '.kobo/screensaver/moon.png',
    ]);
    assert.equal(logger.messages.length, 1);
    assert.match(logger.messages[0][0], /Could not remove \.adds\/nm/);
});

test('executeNickelMenuRemoval removes only the owned file, leaving unrelated files intact', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.adds/nm',
            '.kobo/screensaver',
            { path: '.kobo/screensaver/moon.png', kind: 'file' },
            { path: '.kobo/screensaver/user.png', kind: 'file' },
        ],
    });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [screensaver],
        shouldRemoveSyncExclusions: async () => false,
    });

    assert.equal(await device.pathExists(['.kobo', 'screensaver', 'user.png']), true);
    assert.equal(await device.pathExists(['.kobo', 'screensaver', 'moon.png']), false);
    assert.deepEqual(device.removePaths(), [
        '.adds/nm',
        '.kobo/screensaver/moon.png',
    ]);
});

test('executeNickelMenuRemoval removes sync exclusions only when requested', async () => {
    const installer = createInstaller();
    const originalConf = [
        '[FeatureSettings]',
        'ExcludeSyncFolders=(old)',
        'Foo=bar',
        '',
    ].join('\n');
    const device = new RecordingDevice({
        textFiles: {
            [koboEReaderConfPath]: originalConf,
        },
    });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [customMenu],
        shouldRemoveSyncExclusions: async () => true,
    });

    assert.equal(text(device.writeFor(koboEReaderConfPath).data), [
        '[FeatureSettings]',
        'Foo=bar',
        '',
    ].join('\n'));
});

test('executeNickelMenuRemoval keeps sync exclusions when requested', async () => {
    const installer = createInstaller();
    const originalConf = [
        '[FeatureSettings]',
        'ExcludeSyncFolders=(old)',
        'Foo=bar',
        '',
    ].join('\n');
    const device = new RecordingDevice({
        textFiles: {
            [koboEReaderConfPath]: originalConf,
        },
    });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [customMenu],
        shouldRemoveSyncExclusions: async () => false,
    });

    assert.equal(device.writeFor(koboEReaderConfPath), undefined);
});

test('executeNickelMenuRemoval repairs persisted legacy malformed sync exclusions to the default line', async () => {
    const installer = createInstaller();
    const originalConf = [
        '[FeatureSettings]',
        legacyBrokenExcludeSyncFoldersLines.calibre,
        'Foo=bar',
        '',
    ].join('\n');
    const device = new RecordingDevice({
        textFiles: {
            [koboEReaderConfPath]: originalConf,
        },
    });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [customMenu],
        shouldRemoveSyncExclusions: async () => false,
    });

    const updated = text(device.writeFor(koboEReaderConfPath).data);
    assert.equal(updated, [
        '[FeatureSettings]',
        buildExcludeSyncFoldersLine(),
        'Foo=bar',
        '',
    ].join('\n'));
});

test('executeNickelMenuRemoval stops before removals if KoboRoot.tgz write fails', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({ failWritePath: koboRootTgzPath });

    await assert.rejects(
        () => executeNickelMenuRemoval({
            device,
            installer,
            cleanupFeatures: [customMenu, screensaver],
            shouldRemoveSyncExclusions: async () => true,
        }),
        /Refusing write to \.kobo\/KoboRoot\.tgz/
    );

    assert.deepEqual(device.writePaths(), []);
    assert.deepEqual(device.removePaths(), []);
});

test('executeNickelMenuRemoval stops before removals when NickelMenu zip is missing KoboRoot.tgz', async () => {
    const installer = {
        async loadNickelMenu() {},
        async getKoboRootTgz() {
            throw new Error('KoboRoot.tgz not found in NickelMenu.zip');
        },
        async removeExcludeSyncFolders() {
            throw new Error('should not remove sync exclusions');
        },
    };
    const device = new RecordingDevice();

    await assert.rejects(
        () => executeNickelMenuRemoval({
            device,
            installer,
            cleanupFeatures: [customMenu, screensaver],
            shouldRemoveSyncExclusions: async () => true,
        }),
        /KoboRoot\.tgz not found/
    );

    assert.deepEqual(device.writePaths(), []);
    assert.deepEqual(device.removePaths(), []);
});
