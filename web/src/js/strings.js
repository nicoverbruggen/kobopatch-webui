export const TL = {
    NAV_NICKELMENU: ['Device', 'Mode', 'Configure', 'Review', 'Install'],
    NAV_PATCHES: ['Device', 'Mode', 'Patches', 'Build', 'Install'],
    NAV_DEFAULT: ['Device', 'Mode', 'Patches', 'Build', 'Install'],

    BUTTON: {
        RESTORE_ORIGINAL: 'Restore Original Software',
        BUILD_PATCHED: 'Build Patched Software',
        WRITE_TO_KOBO: 'Write to Kobo',
        REMOVE_FROM_KOBO: 'Remove from Kobo',
        WRITING: 'Writing...',
        WRITTEN: 'Written',
        GO_BACK: '\u2039 Back',
        SELECT_DIFFERENT_PATCHES: '\u2039 Select different patches',
    },

    STATUS: {
        DEVICE_RECOGNIZED: 'Your device has been recognized. You can continue to the next step!',
        NM_REMOVED_ON_REBOOT: 'NickelMenu will be removed on next reboot.',
        NM_INSTALLED: 'NickelMenu has been installed on your Kobo.',
        NM_DOWNLOAD_READY: 'Your NickelMenu package is ready to download.',
        NM_WILL_BE_REMOVED: 'NickelMenu will be updated and marked for removal. It will uninstall itself when your Kobo reboots.',
        NM_WILL_BE_INSTALLED: 'The following will be installed on your Kobo:',
        NM_NICKEL_ROOT_TGZ: 'NickelMenu (KoboRoot.tgz)',
        NM_REMOVAL_HINT: 'Removes NickelMenu from your device. You must restart your Kobo to complete the uninstall!',
        NM_REMOVAL_DISABLED: 'Removes NickelMenu from your device. Only available when a Kobo with NickelMenu installed is connected.',
        PATCH_COUNT_ZERO: 'No patches selected \u2014 continuing will restore the original unpatched software.',
        PATCH_COUNT_ONE: '1 patch selected.',
        PATCH_COUNT_MULTI: (n) => `${n} patches selected.`,
        FIRMWARE_WILL_BE_DOWNLOADED: 'will be downloaded automatically from Kobo\u2019s servers and will be patched after the download completes.',
        RESTORE_ORIGINAL: 'will be downloaded and extracted without modifications to restore the original unpatched software.',
        BUILDING_STARTING: 'Starting...',
        DOWNLOADING: 'Downloading software update...',
        DOWNLOADING_PROGRESS: (received, total, pct) => `Downloading software update... ${received} / ${total} (${pct}%)`,
        EXTRACTING: 'Extracting KoboRoot.tgz...',
        APPLYING_PATCHES: 'Applying patches...',
        NO_FIRMWARE_URL: 'No download URL available for this device.',
        WRITE_FAILED: 'Failed to write KoboRoot.tgz: ',
        NM_INSTALL_FAILED: 'NickelMenu installation failed: ',
        EXTRACT_FAILED: 'KoboRoot.tgz not found in software update',
    },

    ERROR: {
        PATCH_FAILED: 'The patch failed to apply',
        SOMETHING_WENT_WRONG: 'Something went wrong',
        LOAD_PATCHES_FAILED: (v) => `Could not load patches for software version ${v}`,
    },

    PATCH: {
        NONE: 'None (do not patch)',
    },

    NICKEL_MENU_ITEMS: {
        FONTS: 'Readerly fonts',
        SCREENSAVER: 'Custom screensaver',
        SIMPLIFY_TABS: 'Simplified tab menu',
        SIMPLIFY_HOME: 'Simplified homescreen',
        KOREADER: 'KOReader',
    },
};
