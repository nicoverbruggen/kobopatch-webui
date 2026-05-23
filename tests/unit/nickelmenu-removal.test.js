import test from 'node:test';
import assert from 'node:assert/strict';

import customMenu from '../../src/js/nickelmenu/features/custom-menu/index.js';
import screensaver from '../../src/js/nickelmenu/features/screensaver/index.js';
import {
    executeNickelMenuRemoval,
    hasAddsDirectoriesRequiringSyncExclusions,
    nickelMenuUninstallMarkerPath,
} from '../../src/js/nickelmenu/uninstaller.js';
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

test('executeNickelMenuRemoval removes NickelMenu assets, preset scripts, and creates uninstall marker', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.adds/nm',
            '.adds/scripts',
            ...customMenu.cleanup.paths.map(path => ({ path, kind: 'file' })),
        ],
    });
    const progress = createProgressRecorder();

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [customMenu],
        shouldRemoveSyncExclusions: async () => false,
        onProgress: progress,
    });

    assert.deepEqual(device.writePaths(), [
        koboRootTgzPath,
        pathString(nickelMenuUninstallMarkerPath),
    ]);
    assert.deepEqual(device.removePaths(), [
        '.adds/nm',
        '.adds/scripts/legibility_status.sh',
        '.adds/scripts/toggle_wk_rendering.sh',
        '.adds/scripts',
    ]);
    assert.deepEqual(device.removalFor('.adds/nm').options, { recursive: true });
    assert.deepEqual(device.removalFor('.adds/scripts').options, {});
    assert.equal(device.writeFor(pathString(nickelMenuUninstallMarkerPath)).data.length, 0);
    assert.deepEqual(progress.messages, [
        'Writing KoboRoot.tgz...',
        'Removing NickelMenu assets...',
        'Creating uninstall marker...',
    ]);
});

test('executeNickelMenuRemoval removes selected feature cleanup paths only', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.adds/nm',
            '.adds/scripts',
            ...customMenu.cleanup.paths.map(path => ({ path, kind: 'file' })),
            { path: '.kobo/screensaver/moon.png', kind: 'file' },
        ],
    });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [customMenu, screensaver],
        shouldRemoveSyncExclusions: async () => false,
    });

    assert.deepEqual(device.removePaths(), [
        '.adds/nm',
        '.adds/scripts/legibility_status.sh',
        '.adds/scripts/toggle_wk_rendering.sh',
        '.adds/scripts',
        '.kobo/screensaver/moon.png',
    ]);
    assert.deepEqual(device.removalFor('.kobo/screensaver/moon.png').options, { recursive: false });
});

test('executeNickelMenuRemoval ignores optional missing removal paths and continues', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.adds/scripts',
            ...customMenu.cleanup.paths.map(path => ({ path, kind: 'file' })),
            { path: '.kobo/screensaver/moon.png', kind: 'file' },
        ],
        failRemovePaths: ['.adds/nm', '.kobo/screensaver/moon.png'],
    });
    const logger = createWarnRecorder();

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [customMenu, screensaver],
        shouldRemoveSyncExclusions: async () => false,
        logger,
    });

    assert.deepEqual(device.writePaths(), [
        koboRootTgzPath,
        pathString(nickelMenuUninstallMarkerPath),
    ]);
    assert.deepEqual(device.removePaths(), [
        '.adds/scripts/legibility_status.sh',
        '.adds/scripts/toggle_wk_rendering.sh',
        '.adds/scripts',
    ]);
    assert.equal(logger.messages.length, 2);
    assert.match(logger.messages[0][0], /Could not remove \.adds\/nm/);
    assert.match(logger.messages[1][0], /Could not remove \.kobo\/screensaver\/moon\.png/);
});

test('executeNickelMenuRemoval keeps .adds/scripts when non-owned files remain', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({
        existingEntries: [
            '.adds/nm',
            '.adds/scripts',
            ...customMenu.cleanup.paths.map(path => ({ path, kind: 'file' })),
            { path: '.adds/scripts/user-script.sh', kind: 'file' },
        ],
    });

    await executeNickelMenuRemoval({
        device,
        installer,
        cleanupFeatures: [customMenu],
        shouldRemoveSyncExclusions: async () => false,
    });

    assert.equal(await device.pathExists(['.adds', 'scripts']), true);
    assert.equal(await device.pathExists(['.adds', 'scripts', 'user-script.sh']), true);
    assert.deepEqual(device.removePaths(), [
        '.adds/nm',
        '.adds/scripts/legibility_status.sh',
        '.adds/scripts/toggle_wk_rendering.sh',
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
