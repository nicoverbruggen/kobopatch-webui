/**
 * nickelmenu-flow.js — NickelMenu installation/removal flow.
 *
 * Handles the entire NickelMenu path through the wizard:
 *   1. Config step    — choose preset install, NickelMenu-only, or removal
 *   2. Conflict step  — blocks preset installs when incompatible add-ons exist
 *   3. Features step  — pick which features to include (only for "preset")
 *   4. Backup step    — optionally download a backup from the connected Kobo
 *   5. Review step    — confirm selections before proceeding
 *   6. Installing step — progress indicator while writing files
 *   7. Done step      — success message with next-steps instructions
 *
 * Exported `initNickelMenu(state)` receives the shared app state and returns
 * functions the orchestrator (app.js) needs: `goToNickelMenuConfig` and
 * `resetNickelMenuState`.
 */

import JSZip from 'jszip';
import { $, $q, $qa, triggerDownload, renderNmCheckboxList, populateList, setupFeedback } from '../dom.js';
import { showStep, setNavStep } from '../nav.js';
import { ALL_FEATURES } from '../../nickelmenu/installer.js';
import { TL } from '../strings.js';
import { isEnabled as analyticsEnabled, track } from '../analytics.js';

const NM_REVIEW_BACKUP_PATHS = [
    ['.kobo', 'Kobo'],
    ['.kobo', 'markups'],
    ['.kobo', 'BookReader.sqlite'],
    ['.kobo', 'device.salt.conf'],
    ['.kobo', 'fonts.sqlite'],
    ['.kobo', 'KoboReader.sqlite'],
    ['.kobo', 'version'],
];

const NM_PRESET_CONFLICTS = [
    { id: 'nickeldbus', path: ['.adds', 'nickeldbus'], label: 'nickeldbus (.adds/nickeldbus)' },
    { id: 'nickelseries', path: ['.adds', 'nickelseries'], label: 'nickelseries (.adds/nickelseries)' },
    { id: 'nickelclock', path: ['.adds', 'nickelclock'], label: 'nickelclock (.adds/nickelclock)' },
];

export function initNickelMenu(state) {
    // --- DOM references (scoped to this flow) ---

    const stepNickelMenu = $('step-nickelmenu');
    const stepNmPresetConflict = $('step-nm-preset-conflict');
    const stepNmFeatures = $('step-nm-features');
    const stepNmBackup = $('step-nm-backup');
    const stepNmReview = $('step-nm-review');
    const stepNmInstalling = $('step-nm-installing');
    const stepNmDone = $('step-nm-done');
    const nmConfigOptions = $('nm-config-options');
    const nmUninstallOptions = $('nm-uninstall-options');
    const btnNmBack = $('btn-nm-back');
    const btnNmNext = $('btn-nm-next');
    const btnNmPresetConflictBack = $('btn-nm-preset-conflict-back');
    const btnNmPresetConflictNext = $('btn-nm-preset-conflict-next');
    const btnNmFeaturesBack = $('btn-nm-features-back');
    const btnNmFeaturesNext = $('btn-nm-features-next');
    const btnNmBackupBack = $('btn-nm-backup-back');
    const btnNmBackupNext = $('btn-nm-backup-next');
    const btnNmReviewBack = $('btn-nm-review-back');
    const btnNmWrite = $('btn-nm-write');
    const btnNmDownload = $('btn-nm-download');
    const nmBackupIntro = $('nm-backup-intro');
    const nmBackupOptions = $('nm-backup-options');
    const nmBackupLocalNote = $('nm-backup-local-note');
    const nmBackupWarning = $('nm-backup-warning');
    const nmPresetConflictSummary = $('nm-preset-conflict-summary');
    const nmPresetConflictList = $('nm-preset-conflict-list');
    const nmPresetConflictAck = $('nm-preset-conflict-ack');

    // Features detected on the device that can be cleaned up during removal
    // (e.g. KOReader). Populated by checkNickelMenuInstalled().
    let detectedUninstallFeatures = [];
    let detectedPresetConflicts = [];
    let nmBackupChoice = null;
    let nmNeedsBookBackupWarning = false;

    // --- Feature checkboxes ---
    // Renders one checkbox per available feature from ALL_FEATURES.
    // Required features are checked and disabled; others use their default.

    function renderFeatureCheckboxes() {
        const items = ALL_FEATURES
            .filter(f => f.available !== false)
            .map(f => ({
                name: 'nm-cfg-' + f.id,
                title: f.title + (f.required ? ' (required)' : '') + (f.version ? ' ' + f.version : ''),
                description: f.description,
                sectionTitle: f.section,
                checked: f.required || f.default,
                disabled: f.required,
            }));
        renderNmCheckboxList(nmConfigOptions, items);
    }

    // --- Uninstall checkboxes ---
    // When removing NickelMenu, shows checkboxes for any detected extras
    // (like KOReader) so the user can opt into cleaning those up too.

    function renderUninstallCheckboxes() {
        if (detectedUninstallFeatures.length === 0) {
            nmUninstallOptions.innerHTML = '';
            return;
        }
        const items = detectedUninstallFeatures.map(f => ({
            name: 'nm-uninstall-' + f.id,
            title: 'Also remove ' + f.uninstall.title,
            description: f.uninstall.description,
            checked: true,
        }));
        renderNmCheckboxList(nmUninstallOptions, items);
    }

    /** Clear removal state when returning to mode selection. */
    function resetNickelMenuState() {
        detectedUninstallFeatures = [];
        detectedPresetConflicts = [];
        nmUninstallOptions.hidden = true;
        nmUninstallOptions.innerHTML = '';
        nmPresetConflictList.innerHTML = '';
        nmPresetConflictAck.checked = false;
        btnNmPresetConflictNext.disabled = true;
        nmBackupChoice = null;
        nmBackupWarning.hidden = true;
        nmBackupWarning.textContent = '';
        btnNmBackupNext.disabled = true;
        btnNmBackupNext.textContent = 'Continue ›';
        btnNmBackupBack.disabled = false;
        for (const radio of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
            radio.checked = false;
            radio.closest('.selection-card')?.classList.remove('selection-card--selected');
            radio.disabled = false;
        }
    }

    /** Return only the uninstall features whose checkboxes are checked. */
    function getSelectedUninstallFeatures() {
        return detectedUninstallFeatures.filter(f => {
            const cb = $q(`input[name="nm-uninstall-${f.id}"]`);
            return cb && cb.checked;
        });
    }

    /** Return all features the user has selected for installation. */
    function getSelectedFeatures() {
        return ALL_FEATURES.filter(f => {
            if (f.available === false) return false;
            if (f.required) return true;
            const checkbox = $q(`input[name="nm-cfg-${f.id}"]`);
            return checkbox && checkbox.checked;
        });
    }

    async function updateNmBackupWarningState() {
        nmNeedsBookBackupWarning = false;
        if (state.manualMode || !state.device.directoryHandle || state.nickelMenuOption !== 'preset') {
            return;
        }

        const rootEntries = await state.device.listDirectoryNames();
        nmNeedsBookBackupWarning =
            rootEntries.some(name => name.includes(',')) ||
            rootEntries.includes('calibre');
    }

    function updateNmBackupWarningUi() {
        const shouldShow =
            nmNeedsBookBackupWarning &&
            (nmBackupChoice === 'key-files' || nmBackupChoice === 'skip');

        nmBackupWarning.hidden = !shouldShow;
        nmBackupWarning.textContent = shouldShow
            ? 'At this point, it\'s also recommended that you back up your sideloaded books (if you have any!) before continuing, just in case something goes wrong.'
            : '';
    }

    function updateNmReviewLibraryWarningUi() {
        const libraryWarning = $('nm-review-library-warning');
        libraryWarning.hidden = !nmNeedsBookBackupWarning;
    }

    function shouldOfferNmBackup() {
        return !state.manualMode && !!state.device.directoryHandle;
    }

    function getNmBackupFilename() {
        const serial = state.device.deviceInfo?.serial || 'UNKNOWN SERIAL';
        const now = new Date();
        const timestamp = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, '0'),
            String(now.getDate()).padStart(2, '0'),
        ].join('-') + ' ' + [
            String(now.getHours()).padStart(2, '0'),
            String(now.getMinutes()).padStart(2, '0'),
            String(now.getSeconds()).padStart(2, '0'),
        ].join('-');
        return `KoboPatch Backup (${serial}) - ${timestamp}.zip`;
    }

    async function showNmBackupStep() {
        const canCreateBackup = shouldOfferNmBackup();
        if (canCreateBackup && !nmBackupChoice) {
            nmBackupChoice = 'key-files';
            for (const radio of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
                const checked = radio.value === nmBackupChoice;
                radio.checked = checked;
                radio.closest('.selection-card')?.classList.toggle('selection-card--selected', checked);
            }
        }

        btnNmBackupNext.disabled = canCreateBackup ? !nmBackupChoice : false;
        btnNmBackupBack.disabled = false;
        btnNmBackupNext.textContent = 'Continue ›';
        nmBackupIntro.textContent = canCreateBackup
            ? 'Before continuing, it\'s highly recommended that you let the Web UI make an automatic backup of important system files. You can do that here.'
            : 'Before continuing, it is highly recommended that you manually make a backup of the files on your Kobo device, especially the hidden `.kobo` folder. Please do that now (or skip this, if you prefer). When you are ready to move on, press Continue.';
        nmBackupOptions.hidden = !canCreateBackup;
        nmBackupLocalNote.hidden = !canCreateBackup;
        await updateNmBackupWarningState();
        if (canCreateBackup) {
            updateNmBackupWarningUi();
        } else {
            nmBackupWarning.hidden = true;
            nmBackupWarning.textContent = '';
        }
        setNavStep(4);
        showStep(stepNmBackup);
    }

    async function buildNmBackupZip() {
        if (nmBackupChoice !== 'key-files') {
            return null;
        }

        const backupPaths = [...NM_REVIEW_BACKUP_PATHS];
        if (await state.device.pathExists(['.adds', 'nm'])) {
            backupPaths.push(['.adds', 'nm']);
        }

        const entries = await state.device.collectExistingEntries(backupPaths);
        const filename = getNmBackupFilename();

        if (entries.length === 0) {
            throw new Error('No backup files were found on the connected Kobo.');
        }

        const zip = new JSZip();
        for (const entry of entries) {
            zip.file(entry.path, entry.data);
        }

        return {
            bytes: await zip.generateAsync({ type: 'uint8array' }),
            filename,
        };
    }

    // --- NM installed detection ---
    // Probes the connected device for .adds/nm/items to determine if
    // NickelMenu is currently installed. Enables or disables the "Remove"
    // radio option accordingly. Also scans for removable extras (e.g. KOReader).

    async function checkNickelMenuInstalled() {
        const removeOption = $('nm-option-remove');
        const removeRadio = $q('input[value="remove"]', removeOption);
        const removeDesc = $('nm-remove-desc');

        // Only probe the device in auto mode (manual mode has no device handle).
        if (!state.manualMode && state.device.directoryHandle) {
            try {
                const addsDir = await state.device.directoryHandle.getDirectoryHandle('.adds');
                const nmDir = await addsDir.getDirectoryHandle('nm');
                await nmDir.getFileHandle('items');
                // NickelMenu is installed — enable removal option.
                removeRadio.disabled = false;
                removeOption.classList.remove('selection-card--disabled');
                removeDesc.textContent = TL.STATUS.NM_REMOVAL_HINT;

                // Scan for removable extras (only once per session).
                if (detectedUninstallFeatures.length === 0) {
                    for (const feature of ALL_FEATURES) {
                        if (!feature.uninstall) continue;
                        for (const detectPath of feature.uninstall.detect) {
                            if (await state.device.pathExists(detectPath)) {
                                detectedUninstallFeatures.push(feature);
                                break;
                            }
                        }
                    }
                    renderUninstallCheckboxes();
                }
                return;
            } catch {
                // .adds/nm not found — NickelMenu is not installed.
            }
        }

        // No device or NickelMenu not found — disable removal.
        removeRadio.disabled = true;
        removeOption.classList.add('selection-card--disabled');
        removeDesc.textContent = TL.STATUS.NM_REMOVAL_DISABLED;
        if (removeRadio.checked) {
            const presetRadio = $q('input[value="preset"]', stepNickelMenu);
            presetRadio.checked = true;
            presetRadio.dispatchEvent(new Event('change'));
        }
    }

    async function detectPresetConflicts() {
        if (state.manualMode || !state.device.directoryHandle) {
            return [];
        }

        const conflicts = [];
        for (const conflict of NM_PRESET_CONFLICTS) {
            if (await state.device.pathExists(conflict.path)) {
                conflicts.push(conflict);
            }
        }
        return conflicts;
    }

    async function maybeShowPresetConflictStep() {
        detectedPresetConflicts = await detectPresetConflicts();
        if (detectedPresetConflicts.length === 0) {
            return false;
        }

        nmPresetConflictSummary.textContent = TL.STATUS.NM_PRESET_CONFLICT;
        populateList(nmPresetConflictList, detectedPresetConflicts.map(conflict => conflict.label));
        nmPresetConflictAck.checked = false;
        btnNmPresetConflictNext.disabled = true;
        setNavStep(3);
        showStep(stepNmPresetConflict);
        return true;
    }

    // --- Step: NM config ---
    // Radio buttons for the three NM options: preset, nickelmenu-only, remove.
    // Toggling "remove" shows/hides the uninstall checkboxes.

    for (const radio of $qa('input[name="nm-option"]', stepNickelMenu)) {
        radio.addEventListener('change', () => {
            nmUninstallOptions.hidden = radio.value !== 'remove' || !radio.checked || detectedUninstallFeatures.length === 0;
            btnNmNext.disabled = false;
        });
    }

    /** Entry point into the NickelMenu flow. Probes the device, then shows the config step. */
    async function goToNickelMenuConfig() {
        await checkNickelMenuInstalled();
        const currentOption = $q('input[name="nm-option"]:checked', stepNickelMenu);
        nmUninstallOptions.hidden = !currentOption || currentOption.value !== 'remove' || detectedUninstallFeatures.length === 0;
        btnNmNext.disabled = !currentOption;
        setNavStep(3);
        showStep(stepNickelMenu);
    }

    btnNmBack.addEventListener('click', () => {
        state.goToModeSelection();
    });

    btnNmNext.addEventListener('click', async () => {
        const selected = $q('input[name="nm-option"]:checked', stepNickelMenu);
        if (!selected) return;
        state.nickelMenuOption = selected.value;
        track('nm-option', { option: state.nickelMenuOption });

        // "preset" goes to feature selection; other options skip to review.
        if (state.nickelMenuOption === 'preset') {
            if (await maybeShowPresetConflictStep()) {
                return;
            }
            goToNmFeatures();
        } else {
            await showNmBackupStep();
        }
    });

    btnNmPresetConflictBack.addEventListener('click', async () => {
        await goToNickelMenuConfig();
    });

    nmPresetConflictAck.addEventListener('change', () => {
        btnNmPresetConflictNext.disabled = !nmPresetConflictAck.checked;
    });

    btnNmPresetConflictNext.addEventListener('click', () => {
        if (!nmPresetConflictAck.checked) return;
        goToNmFeatures();
    });

    // --- Step: Features ---
    // Checkboxes are rendered lazily on first visit, then preserved
    // so selections survive back-navigation.

    function goToNmFeatures() {
        if (!nmConfigOptions.children.length) {
            renderFeatureCheckboxes();
        }
        setNavStep(3);
        showStep(stepNmFeatures);
    }

    btnNmFeaturesBack.addEventListener('click', async () => {
        await goToNickelMenuConfig();
    });

    btnNmFeaturesNext.addEventListener('click', async () => {
        await showNmBackupStep();
    });

    for (const radio of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
        radio.addEventListener('change', () => {
            nmBackupChoice = radio.value;
            btnNmBackupNext.disabled = false;
            for (const other of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
                other.closest('.selection-card')?.classList.toggle('selection-card--selected', other.checked);
            }
            updateNmBackupWarningUi();
        });
    }

    btnNmBackupBack.addEventListener('click', async () => {
        if (state.nickelMenuOption === 'preset') {
            goToNmFeatures();
        } else {
            await goToNickelMenuConfig();
        }
    });

    btnNmBackupNext.addEventListener('click', async () => {
        if (!shouldOfferNmBackup()) {
            await goToNmReview();
            return;
        }

        if (!nmBackupChoice) return;
        if (nmBackupChoice === 'skip') {
            await goToNmReview();
            return;
        }

        btnNmBackupBack.disabled = true;
        btnNmBackupNext.disabled = true;
        btnNmBackupNext.textContent = 'Preparing backup...';
        for (const radio of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
            radio.disabled = true;
        }

        try {
            const backup = await buildNmBackupZip();
            if (backup) {
                triggerDownload(backup.bytes, backup.filename, 'application/zip');
            }
            await goToNmReview();
        } catch (err) {
            state.showError(err.message);
        } finally {
            btnNmBackupBack.disabled = false;
            btnNmBackupNext.textContent = 'Continue ›';
            for (const radio of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
                radio.disabled = false;
            }
        }
    });

    // --- Step: Review ---
    // Builds a summary of what will be installed/removed and shows
    // the appropriate action buttons (write to device / download).

    async function goToNmReview() {
        const summary = $('nm-review-summary');
        const list = $('nm-review-list');
        await updateNmBackupWarningState();

        if (state.nickelMenuOption === 'remove') {
            summary.textContent = TL.STATUS.NM_WILL_BE_REMOVED;
            const featuresToRemove = getSelectedUninstallFeatures();
            populateList(list, [
                TL.STATUS.NM_REMOVE_NICKELMENU,
                ...featuresToRemove.map(f => f.uninstall.title + ' will also be removed'),
            ]);
            $('nm-review-library-warning').hidden = true;
            btnNmWrite.hidden = state.manualMode;
            btnNmWrite.textContent = TL.BUTTON.REMOVE_FROM_KOBO;
            btnNmDownload.hidden = true;
        } else {
            // "nickelmenu-only" or "preset" — both install NickelMenu.
            summary.textContent = TL.STATUS.NM_WILL_BE_INSTALLED;
            const items = [TL.STATUS.NM_NICKEL_ROOT_TGZ];
            if (state.nickelMenuOption === 'preset') {
                for (const feature of getSelectedFeatures()) {
                    items.push(feature.title);
                }
            }
            populateList(list, items);
            updateNmReviewLibraryWarningUi();
            btnNmWrite.hidden = false;
            btnNmWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
            btnNmDownload.hidden = false;
        }

        // "Write to Kobo" is only available when a device is connected.
        if (state.manualMode || !state.device.directoryHandle) {
            btnNmWrite.hidden = true;
        }

        btnNmWrite.disabled = false;
        btnNmWrite.className = 'primary';
        btnNmDownload.disabled = false;

        setNavStep(5);
        showStep(stepNmReview);
    }

    btnNmReviewBack.addEventListener('click', async () => {
        if (state.nickelMenuOption === 'preset') {
            await showNmBackupStep();
        } else {
            await showNmBackupStep();
        }
    });

    // --- Install / Download ---
    // Performs the actual installation or builds a downloadable ZIP.
    // The removal path writes a KoboRoot.tgz (for NickelMenu's own uninstaller),
    // deletes NM assets, creates an uninstall marker, then optionally removes
    // detected extras like KOReader.

    async function executeNmInstall(writeToDevice) {
        const nmProgress = $('nm-progress');
        const progressFn = (msg) => { nmProgress.textContent = msg; };
        showStep(stepNmInstalling);

        try {
            if (state.nickelMenuOption === 'remove') {
                // Removal flow: write uninstall tgz, clean up assets, remove extras.
                await state.nmInstaller.loadNickelMenu(progressFn);
                nmProgress.textContent = 'Writing KoboRoot.tgz...';
                const tgz = await state.nmInstaller.getKoboRootTgz();
                await state.device.writeFile(['.kobo', 'KoboRoot.tgz'], tgz);
                nmProgress.textContent = 'Removing NickelMenu assets...';
                try {
                    await state.device.removeEntry(['.adds', 'nm'], { recursive: true });
                } catch (err) {
                    console.warn('Could not remove .adds/nm:', err);
                }
                try {
                    await state.device.removeEntry(['.adds', 'scripts'], { recursive: true });
                } catch (err) {
                    console.warn('Could not remove .adds/scripts:', err);
                }
                // Marker tells NickelMenu to finish uninstalling on next reboot.
                nmProgress.textContent = 'Creating uninstall marker...';
                await state.device.writeFile(['.adds', 'nm', 'uninstall'], new Uint8Array(0));

                // Remove any extras the user opted to clean up.
                const featuresToRemove = getSelectedUninstallFeatures();
                for (const feature of featuresToRemove) {
                    nmProgress.textContent = 'Removing ' + feature.uninstall.title + '...';
                    for (const entry of feature.uninstall.paths) {
                        try {
                            await state.device.removeEntry(entry.path, { recursive: !!entry.recursive });
                        } catch (err) {
                            console.warn(`Could not remove ${entry.path.join('/')}:`, err);
                        }
                    }
                }

                showNmDone('remove');
                return;
            }

            // Install flow: either write directly to device or build a ZIP for download.
            const features = state.nickelMenuOption === 'preset' ? getSelectedFeatures() : [];
            const hasKOReader = features.some(f => f.id === 'koreader');
            const hasSimplifiedHome = features.some(f =>
                ['hide-recommendations', 'hide-row2col2', 'hide-notices'].includes(f.id)
            );
            const hasBasicTabs = features.some(f => f.id === 'simplify-tabs');
            track('nm-koreader-addon', { enabled: hasKOReader ? 'yes' : 'no' });
            track('nm-simplified-home', { enabled: hasSimplifiedHome ? 'yes' : 'no' });
            track('nm-basic-tabs', { enabled: hasBasicTabs ? 'yes' : 'no' });

            if (writeToDevice && state.device.directoryHandle) {
                await state.nmInstaller.installToDevice(state.device, features, progressFn);
                showNmDone('written');
            } else {
                state.resultNmZip = await state.nmInstaller.buildDownloadZip(features, progressFn);
                showNmDone('download');
            }
        } catch (err) {
            state.showError(TL.STATUS.NM_INSTALL_FAILED(err.message));
        }
    }

    btnNmWrite.addEventListener('click', () => executeNmInstall(true));
    btnNmDownload.addEventListener('click', () => executeNmInstall(false));

    // --- Done ---
    // Shows the appropriate success message and post-install instructions
    // depending on whether the user wrote to device, downloaded, or removed.

    function showNmDone(mode) {
        const nmDoneStatus = $('nm-done-status');
        $('nm-write-instructions').hidden = true;
        $('nm-download-instructions').hidden = true;
        $('nm-reboot-instructions').hidden = true;

        if (mode === 'remove') {
            nmDoneStatus.textContent = TL.STATUS.NM_REMOVED_ON_REBOOT;
            $('nm-reboot-instructions').hidden = false;
            track('flow-end', { result: 'nm-remove' });
        } else if (mode === 'written') {
            nmDoneStatus.textContent = TL.STATUS.NM_INSTALLED;
            $('nm-write-instructions').hidden = false;
            track('flow-end', { result: 'nm-write' });
        } else {
            nmDoneStatus.textContent = TL.STATUS.NM_DOWNLOAD_READY;
            triggerDownload(state.resultNmZip, 'NickelMenu-install.zip', 'application/zip');
            $('nm-download-instructions').hidden = false;
            // Show config step for preset installs (ExcludeSyncFolders is always written)
            const features = state.nickelMenuOption === 'preset' ? getSelectedFeatures() : [];
            const hasExcludeCalibre = features.some(f => f.id === 'exclude-calibre');
            $('nm-download-conf-step').hidden = state.nickelMenuOption !== 'preset';
            $('nm-download-reboot-step').hidden = state.nickelMenuOption !== 'preset';
            $('nm-download-conf-line').textContent = hasExcludeCalibre
                ? 'ExcludeSyncFolders=(calibre|\\.(?!kobo|adobe|calibre).+|([^.][^/]*/)+\\..+)'
                : 'ExcludeSyncFolders=(\\.(?!kobo|adobe).+|([^.][^/]*/)+\\..+)';
            $('nm-download-conf-desc').textContent = hasExcludeCalibre
                ? 'This prevents new books in the calibre folder from showing up in Kobo\'s list of books. Move Calibre-transferred books into a "calibre" folder first.'
                : 'This prevents the Kobo from incorrectly identifying certain files as books in your library.';
            track('flow-end', { result: 'nm-download' });
        }

        if (analyticsEnabled()) {
            setupFeedback(stepNmDone, (vote) => {
                track('feedback', { vote });
            });
        }

        setNavStep(6);
        showStep(stepNmDone);
    }

    // Expose only what the orchestrator needs.
    return { goToNickelMenuConfig, resetNickelMenuState };
}
