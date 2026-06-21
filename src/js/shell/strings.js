const NAV_NICKELMENU = ['Device', 'Mode', 'Configure', 'Backup', 'Review', 'Install'];

export const TL = {
    NAV_NICKELMENU,
    NAV_NICKELMENU_REMOVE: ['Device', 'Mode', 'Configure', 'Backup', 'Review', 'Remove'],
    NAV_NICKELMENU_MANUAL_REMOVE: ['Device', 'Mode', 'Configure', 'Remove'],
    NAV_PATCHES: ['Device', 'Mode', 'Customize', 'Build', 'Install'],
    // Placeholder shown before a mode is chosen; mirrors the recommended NickelMenu flow.
    NAV_DEFAULT: NAV_NICKELMENU,

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
        NM_INSTALLED: 'NickelMenu has been installed on your Kobo. To complete the installation, follow the instructions below.',
        NM_DOWNLOAD_READY: 'Your NickelMenu package is ready to download. After downloading, a list of installation steps will be displayed.',
        NM_WILL_BE_REMOVED:
            'Nothing has been changed yet. When you press Remove from Kobo, KoboPatch Web UI will update NickelMenu and mark it for removal. After the files are written, you will be asked to safely eject your Kobo so it can restart and remove NickelMenu during startup.',
        NM_SELECTED_REMOVALS: 'Selected removals:',
        NM_KEPT_FEATURES: 'These items and their files will be kept:',
        NM_WILL_BE_INSTALLED: 'The following will be installed on your Kobo:',
        NM_NICKEL_ROOT_TGZ: 'NickelMenu (KoboRoot.tgz)',
        NM_REMOVAL_NICKELMENU: 'NickelMenu',
        NM_REMOVAL_HINT: 'Removes NickelMenu from your device. Your device will restart automatically.',
        NM_REMOVAL_MANUAL_HINT: 'Shows instructions for manually removing NickelMenu from a Kobo.',
        NM_REMOVAL_DISABLED: 'Removes NickelMenu from your device. Only available when a Kobo with NickelMenu installed is connected.',
        NM_PRESET_CONFLICT: 'This Kobo seems to have been modded before.',
        PATCH_COUNT_ZERO: 'No patches selected \u2014 continuing will restore the original unpatched software.',
        PATCH_COUNT_ONE: '1 patch selected.',
        PATCH_COUNT_MULTI: (n) => `${n} patches selected.`,
        PATCH_EXTRA_FILE_COUNT_ONE: '1 additional file selected.',
        PATCH_EXTRA_FILE_COUNT_MULTI: (n) => `${n} additional files selected.`,
        PATCH_AND_EXTRA_FILE_COUNT: (patches, files) =>
            `${patches} patch${patches === 1 ? '' : 'es'} and ${files} additional file${files === 1 ? '' : 's'} selected.`,
        FIRMWARE_WILL_BE_DOWNLOADED: 'will be downloaded automatically from Kobo\u2019s servers and will be patched after the download completes.',
        RESTORE_ORIGINAL: 'will be downloaded and extracted without modifications to restore the original unpatched software.',
        BUILDING_STARTING: 'Starting...',
        DOWNLOADING: 'Downloading software update...',
        DOWNLOADING_PROGRESS: (received, total, pct) => `Downloading software update... ${received} / ${total} (${pct}%)`,
        EXTRACTING: 'Extracting KoboRoot.tgz...',
        APPLYING_PATCHES: 'Applying patches...',
        NO_FIRMWARE_URL: 'No download URL available for this device.',
        WRITE_FAILED: (msg) => `Failed to write KoboRoot.tgz: ${msg}`,
        NM_INSTALL_FAILED: (msg) => `NickelMenu installation failed: ${msg}`,
        EXTRACT_FAILED: 'KoboRoot.tgz not found in software update',
    },

    ERROR: {
        PATCH_FAILED: 'The patch failed to apply',
        SOMETHING_WENT_WRONG: 'Something went wrong',
        LOAD_PATCHES_FAILED: (v) => `Could not load patches for software version ${v}`,
        DEVICE_WRITE_FAILED_TITLE: 'Writing to your device didn’t work',
        DEVICE_WRITE_FAILED_MESSAGE:
            'Something went wrong while writing to your Kobo, so the changes may only be partly applied. Follow the tips below and try again.',
        DEVICE_CONFIG_READ_FAILED_MESSAGE:
            'An important configuration file could not be read, so nothing was changed on your device. Follow the tips below and try again.',
        DEVICE_PROBE_FAILED_TITLE: 'Connection to device failed',
        DEVICE_PROBE_FAILED_MESSAGE:
            'A small test file to verify your device can be written to was not written correctly. This is usually an indicator of a potential connection issue. Follow the tips below and try again.',
        NM_INSTALL_FAILED_TITLE: 'NickelMenu could not be installed',
        NM_REMOVE_FAILED_TITLE: 'NickelMenu could not be removed',
        DOWNLOAD_FAILED_TITLE: 'Preparing the download didn’t work',
        DOWNLOAD_FAILED_MESSAGE: 'Something went wrong while creating the archive to download. Please start over and try again.',
        PERMISSION_DENIED_TITLE: 'Access to your device was blocked',
        PERMISSION_DENIED_MESSAGE:
            'Your browser did not get permission to read and write to your Kobo. When the permission prompt appears, choose “Allow” (or “Edit files”) so the app can access your device, then connect again.',
        UNEXPECTED_TITLE: 'Something went wrong',
        UNEXPECTED_MESSAGE:
            'An unexpected error occurred and the app couldn’t continue. Please start over and try again. The technical details below may help if you report this.',
    },

    PATCH: {
        NONE: 'None (do not patch)',
        MODIFIED: 'modified',
        MODIFIED_TITLE: 'You edited this patch’s definition.',
        DISCARD_EDITS_CONFIRM: 'You have unsaved edits to one or more patches. Going back will discard them. Continue?',
        RELOAD_OFFER:
            'You connected a device that is or was previously patched. If you need to re-apply the previous patches, you can restore them, including any manual edits.',
        RELOAD_APPLIED: 'Previously applied patches have been reloaded, including any manual edits.',
        RELOAD_NONE_MATCHED: 'None of the previously applied patches could be matched to the patches for this software version.',
    },
};
