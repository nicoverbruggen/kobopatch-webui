import test from 'node:test';
import assert from 'node:assert/strict';

import JSZip from 'jszip';

import { NickelMenuInstaller } from '../../src/js/nickelmenu/installer.js';
import customMenu from '../../src/js/nickelmenu/features/custom-menu/index.js';
import excludeCalibre from '../../src/js/nickelmenu/features/exclude-calibre/index.js';
import hideNotices from '../../src/js/nickelmenu/features/hide-notices/index.js';
import {
    RecordingDevice,
    bytes,
    createInstaller,
    createProgressRecorder,
    koboEReaderConfPath,
    koboRootTgzPath,
    text,
    useCustomMenuAssetFetch,
} from './test-helpers.js';

test('installToDevice with no features writes only NickelMenu KoboRoot.tgz', async () => {
    const tgz = bytes('tgz payload');
    const installer = createInstaller(tgz);
    const device = new RecordingDevice();
    const progress = createProgressRecorder();

    await installer.installToDevice(device, [], progress);

    assert.deepEqual(device.writePaths(), [koboRootTgzPath]);
    assert.deepEqual(device.writeFor(koboRootTgzPath).data, tgz);
    assert.deepEqual(progress.messages, [
        'Writing KoboRoot.tgz...',
        'Done.',
    ]);
});

test('installToDevice with features updates eReader config and writes feature files', async () => {
    const restoreFetch = useCustomMenuAssetFetch();
    const installer = createInstaller();
    const device = new RecordingDevice({
        textFiles: {
            [koboEReaderConfPath]: '[ApplicationPreferences]\nCurrentLocale=en_US\n',
        },
    });

    try {
        await installer.installToDevice(device, [customMenu], createProgressRecorder());
    } finally {
        restoreFetch();
    }

    assert.deepEqual(device.writePaths(), [
        koboRootTgzPath,
        koboEReaderConfPath,
        '.adds/nm/items',
        '.adds/nm/.cog.png',
    ]);
    assert.match(text(device.writeFor(koboEReaderConfPath).data), /^\[ApplicationPreferences\]\nCurrentLocale=en_US\n\n\[FeatureSettings\]\nExcludeSyncFolders=/);
    assert.equal(text(device.writeFor('.adds/nm/items').data), 'menu_item :main :base');
});

test('installToDevice uses the calibre sync exclusion when exclude-calibre is selected', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice();

    await installer.installToDevice(device, [excludeCalibre], createProgressRecorder());

    assert.deepEqual(device.writePaths(), [
        koboRootTgzPath,
        koboEReaderConfPath,
    ]);
    assert.match(
        text(device.writeFor(koboEReaderConfPath).data),
        /^ExcludeSyncFolders=\(calibre\|/m
    );
});

test('installToDevice writes post-processed NickelMenu items as bytes', async () => {
    const restoreFetch = useCustomMenuAssetFetch();
    const installer = createInstaller();
    const device = new RecordingDevice();

    try {
        await installer.installToDevice(
            device,
            [customMenu, hideNotices],
            createProgressRecorder()
        );
    } finally {
        restoreFetch();
    }

    const itemsWrite = device.writeFor('.adds/nm/items');
    assert.ok(itemsWrite.data instanceof Uint8Array);
    assert.equal(text(itemsWrite.data), 'menu_item :main :base\nexperimental:hide_home_row3_enabled:1\n');
});

test('installToDevice stops before config or feature writes if KoboRoot.tgz write fails', async () => {
    const installer = createInstaller();
    const device = new RecordingDevice({ failWritePath: koboRootTgzPath });

    await assert.rejects(
        () => installer.installToDevice(device, [excludeCalibre], createProgressRecorder()),
        /Refusing write to \.kobo\/KoboRoot\.tgz/
    );
    assert.deepEqual(device.writePaths(), []);
});

test('installToDevice stops writing remaining feature files after a feature write fails', async () => {
    const restoreFetch = useCustomMenuAssetFetch();
    const installer = createInstaller();
    const device = new RecordingDevice({ failWritePath: '.adds/nm/items' });

    try {
        await assert.rejects(
            () => installer.installToDevice(device, [customMenu], createProgressRecorder()),
            /Refusing write to \.adds\/nm\/items/
        );
    } finally {
        restoreFetch();
    }
    assert.deepEqual(device.writePaths(), [
        koboRootTgzPath,
        koboEReaderConfPath,
    ]);
});

test('installToDevice does not write to the device when NickelMenu zip is missing KoboRoot.tgz', async () => {
    const installer = new NickelMenuInstaller();
    installer.nickelMenuZip = new JSZip();
    installer.nickelMenuZip.file('not-KoboRoot.tgz', bytes('wrong file'));
    const device = new RecordingDevice();

    await assert.rejects(
        () => installer.installToDevice(device, [], createProgressRecorder()),
        /KoboRoot\.tgz not found/
    );
    assert.deepEqual(device.writePaths(), []);
});

test('buildDownloadZip with no features includes only NickelMenu KoboRoot.tgz', async () => {
    const tgz = bytes('download tgz');
    const installer = createInstaller(tgz);

    const result = await installer.buildDownloadZip([], createProgressRecorder());
    const zip = await JSZip.loadAsync(result);
    const filePaths = Object.keys(zip.files).filter(path => !zip.files[path].dir);

    assert.deepEqual(filePaths, ['.kobo/KoboRoot.tgz']);
    assert.deepEqual(await zip.file('.kobo/KoboRoot.tgz').async('uint8array'), tgz);
});

test('buildDownloadZip with features includes feature files but not Kobo eReader.conf', async () => {
    const restoreFetch = useCustomMenuAssetFetch();
    const installer = createInstaller(bytes('download tgz'));

    try {
        const result = await installer.buildDownloadZip(
            [customMenu, hideNotices],
            createProgressRecorder()
        );
        const zip = await JSZip.loadAsync(result);
        const filePaths = Object.keys(zip.files).filter(path => !zip.files[path].dir);

        assert.deepEqual(filePaths, [
            '.kobo/KoboRoot.tgz',
            '.adds/nm/items',
            '.adds/nm/.cog.png',
        ]);
        assert.equal(
            await zip.file('.adds/nm/items').async('string'),
            'menu_item :main :base\nexperimental:hide_home_row3_enabled:1\n'
        );
        assert.equal(zip.file(koboEReaderConfPath), null);
    } finally {
        restoreFetch();
    }
});

test('buildDownloadZip rejects when NickelMenu zip is missing KoboRoot.tgz', async () => {
    const installer = new NickelMenuInstaller();
    installer.nickelMenuZip = new JSZip();
    installer.nickelMenuZip.file('not-KoboRoot.tgz', bytes('wrong file'));

    await assert.rejects(
        () => installer.buildDownloadZip([], createProgressRecorder()),
        /KoboRoot\.tgz not found/
    );
});
