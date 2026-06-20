import { $, $q, $qa, collect, populateList } from '../shell/dom.js';
import { setupCardRadios } from '../shell/navigation.js';
import { renderNmCheckboxList } from '../nickelmenu/checkbox-list.js';
import { createFlow } from '../shell/step-machine.js';
import { createTerminal } from '../shell/terminal.js';
import { NICKELMENU_FEATURES } from '../nickelmenu/features/index.js';
import { installablesManifest } from '../nickelmenu/installables.js';
import {
    createDefaultMenuCustomization,
    isDefaultMenuCustomization,
    isValidMenuLabel,
    NM_MENU_DEFAULT_LABEL,
    sanitizeMenuLabel,
} from '../nickelmenu/customization.js';
import {
    checkNickelMenuInstalled as probeCheckNickelMenuInstalled,
    detectPresetConflicts as probeDetectPresetConflicts,
    getKoboUserCount as probeGetKoboUserCount,
} from '../nickelmenu/probes.js';
import { nmReviewModel } from '../nickelmenu/selection.js';
import {
    cloneMenuCustomization,
    getMenuCustomizationSummaryItem,
    updateMenuCustomizationSummary,
    openMenuCustomizeDialog,
    updateMenuCustomizationDialog,
    handleNmIconUpload,
} from '../nickelmenu/customization-dialog.js';
import { meetsMinimumVersion } from '../kobo/version.js';
import { TL } from '../shell/strings.js';
import { track } from '../shell/analytics.js';
import { shouldOfferNmBackup, prepareNmBackup } from './nickelmenu-backup.js';
import { executeNmInstall as executeNmInstallFn, renderNmDoneStatus, renderReviewNotices } from './nickelmenu-execute.js';

const NM_COLLAPSED_SECTIONS = new Set(['Advanced', 'Legacy']);

export function initNickelMenu(state) {
    const {
        'step-nickelmenu': stepNickelMenu,
        'step-nm-backup': stepNmBackup,
        'step-nm-done': stepNmDone,
        'nm-config-options': nmConfigOptions,
        'nm-uninstall-options': nmUninstallOptions,
        'btn-nm-back': btnNmBack,
        'btn-nm-next': btnNmNext,
        'btn-nm-preset-conflict-back': btnNmPresetConflictBack,
        'btn-nm-preset-conflict-next': btnNmPresetConflictNext,
        'btn-nm-features-back': btnNmFeaturesBack,
        'btn-nm-features-next': btnNmFeaturesNext,
        'btn-nm-backup-back': btnNmBackupBack,
        'btn-nm-backup-next': btnNmBackupNext,
        'btn-nm-review-back': btnNmReviewBack,
        'btn-nm-write': btnNmWrite,
        'btn-nm-download': btnNmDownload,
        'nm-backup-intro': nmBackupIntro,
        'nm-backup-options': nmBackupOptions,
        'nm-backup-local-note': nmBackupLocalNote,
        'nm-manual-backup-instructions': nmManualBackupInstructions,
        'nm-preset-conflict-summary': nmPresetConflictSummary,
        'nm-preset-conflict-list': nmPresetConflictList,
        'nm-preset-conflict-ack': nmPresetConflictAck,
        'nm-customize-dialog': nmCustomizeDialog,
        'nm-customize-label': nmCustomizeLabel,
        'nm-customize-counter': nmCustomizeCounter,
        'nm-customize-status': nmCustomizeStatus,
        'nm-customize-presets': nmCustomizePresets,
        'nm-customize-upload': nmCustomizeUpload,
        'nm-customize-upload-preview': nmCustomizeUploadPreview,
        'nm-customize-upload-name': nmCustomizeUploadName,
        'btn-nm-customize-close': btnNmCustomizeClose,
        'btn-nm-customize-cancel': btnNmCustomizeCancel,
        'btn-nm-customize-reset': btnNmCustomizeReset,
        'btn-nm-customize-save': btnNmCustomizeSave,
        'nm-option-preset-title': nmOptionPresetTitle,
    } = collect([
        'step-nickelmenu',
        'step-nm-backup',
        'step-nm-done',
        'nm-config-options',
        'nm-uninstall-options',
        'btn-nm-back',
        'btn-nm-next',
        'btn-nm-preset-conflict-back',
        'btn-nm-preset-conflict-next',
        'btn-nm-features-back',
        'btn-nm-features-next',
        'btn-nm-backup-back',
        'btn-nm-backup-next',
        'btn-nm-review-back',
        'btn-nm-write',
        'btn-nm-download',
        'nm-backup-intro',
        'nm-backup-options',
        'nm-backup-local-note',
        'nm-manual-backup-instructions',
        'nm-preset-conflict-summary',
        'nm-preset-conflict-list',
        'nm-preset-conflict-ack',
        'nm-customize-dialog',
        'nm-customize-label',
        'nm-customize-counter',
        'nm-customize-status',
        'nm-customize-presets',
        'nm-customize-upload',
        'nm-customize-upload-preview',
        'nm-customize-upload-name',
        'btn-nm-customize-close',
        'btn-nm-customize-cancel',
        'btn-nm-customize-reset',
        'btn-nm-customize-save',
        'nm-option-preset-title',
    ]);

    // Gate runtime-available installables (reading apps, NickelClock, ...) on the
    // baked-in manifest so unavailable add-ons stay hidden from the feature list.
    for (const [id, info] of Object.entries(installablesManifest())) {
        const feature = NICKELMENU_FEATURES.find((f) => f.id === id);
        if (feature && info.available) {
            feature.available = true;
            feature.version = info.version;
        }
    }

    setupCardRadios(stepNickelMenu, 'selection-card--selected');

    const NM_PRESET_TITLE_INSTALL = nmOptionPresetTitle.textContent;
    const NM_PRESET_TITLE_REINSTALL = '(Re)install with preset (and customize)';

    let detectedOptionalCleanupFeatures = [];
    let detectedPresetConflictsList = [];
    let legacyItemsDetected = false;
    let legacyItemsWasOurs = false;
    let nmCustomizationDraft = cloneMenuCustomization(state.nickelMenuCustomization);
    let nmCustomizationSession = 0;

    function resolveNavLabels(ctx) {
        const option = ctx.nickelMenuOption;
        if (option === 'remove' && state.manualMode) return TL.NAV_NICKELMENU_MANUAL_REMOVE;
        if (option === 'remove') return TL.NAV_NICKELMENU_REMOVE;
        return TL.NAV_NICKELMENU;
    }

    const steps = [
        {
            id: 'config',
            domId: 'step-nickelmenu',
            navLabels: resolveNavLabels,
            navIndex: 3,
            recoveryStep: 'config',
            onEnter: async () => {
                await checkNmInstalledState();
                if (!$q('input[name="nm-option"]:checked', stepNickelMenu)) {
                    const presetRadio = $q('input[name="nm-option"][value="preset"]', stepNickelMenu);
                    presetRadio.checked = true;
                    presetRadio.dispatchEvent(new Event('change'));
                }
                const currentOption = $q('input[name="nm-option"]:checked', stepNickelMenu);
                nmUninstallOptions.hidden = !currentOption || currentOption.value !== 'remove' || detectedOptionalCleanupFeatures.length === 0;
                btnNmNext.disabled = !currentOption;
            },
        },
        {
            id: 'preset-conflict',
            domId: 'step-nm-preset-conflict',
            navLabels: resolveNavLabels,
            navIndex: 3,
            back: () => 'config',
            onEnter: async () => {
                nmPresetConflictSummary.textContent = TL.STATUS.NM_PRESET_CONFLICT;
                populateList(
                    nmPresetConflictList,
                    detectedPresetConflictsList.map((c) => c.label),
                );
                nmPresetConflictAck.checked = false;
                btnNmPresetConflictNext.disabled = true;
            },
        },
        {
            id: 'features',
            domId: 'step-nm-features',
            navLabels: resolveNavLabels,
            navIndex: 3,
            back: () => 'config',
            onEnter: async () => {
                renderFeatureCheckboxes();
                updateSideloadedRecommendation().catch(() => {});
            },
        },
        {
            id: 'backup',
            domId: 'step-nm-backup',
            navLabels: resolveNavLabels,
            navIndex: 4,
            back: (ctx) => (ctx.nickelMenuOption === 'preset' ? 'features' : 'config'),
            onEnter: async () => {
                const canCreateBackup = shouldOfferNmBackup(state);
                if (canCreateBackup && !state.nmBackupChoice) {
                    state.nmBackupChoice = 'key-files';
                    for (const radio of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
                        const checked = radio.value === state.nmBackupChoice;
                        radio.checked = checked;
                        radio.closest('.selection-card')?.classList.toggle('selection-card--selected', checked);
                    }
                }

                btnNmBackupNext.disabled = canCreateBackup ? !state.nmBackupChoice : false;
                btnNmBackupBack.disabled = false;
                btnNmBackupNext.textContent = 'Continue \u203A';
                nmBackupIntro.textContent = canCreateBackup
                    ? "Before continuing, it's highly recommended that you let the Web UI make an automatic backup of important system files. You can do that here."
                    : 'Manual mode cannot create a backup for you, but it is worth making a backup of some important device files first.';
                nmBackupOptions.hidden = !canCreateBackup;
                nmBackupLocalNote.hidden = !canCreateBackup;
                nmManualBackupInstructions.hidden = canCreateBackup;

                const keepConfigOption = $('nm-keep-config-option');
                const keepConfigCheckbox = $('nm-keep-items');
                const keepConfigTitle = $('nm-keep-config-title');
                const keepConfigDesc = $('nm-keep-config-desc');
                if (legacyItemsDetected && state.nickelMenuOption === 'preset') {
                    keepConfigCheckbox.checked = legacyItemsWasOurs ? false : true;
                    state.nmKeepLegacyConfig = keepConfigCheckbox.checked;
                    keepConfigTitle.textContent = legacyItemsWasOurs
                        ? 'Keep previous KoboPatch Web UI config (not recommended)'
                        : 'Keep my custom NickelMenu configuration';
                    keepConfigDesc.textContent = legacyItemsWasOurs
                        ? 'This appears to be from an earlier KoboPatch Web UI installation. Since the new config will include the same entries, you can safely leave this unchecked and the old file will be cleaned up. If you made manual modifications to the file, you may want to check this box.'
                        : 'This appears to be a NickelMenu config that was not generated by this tool. Keep this checked to preserve your manual entries alongside the new config.';
                    keepConfigOption.hidden = false;
                } else {
                    keepConfigOption.hidden = true;
                }
            },
        },
        {
            id: 'review',
            domId: 'step-nm-review',
            navLabels: resolveNavLabels,
            navIndex: 5,
            back: () => 'backup',
            onEnter: async () => {
                const summary = $('nm-review-summary');
                const listLabel = $('nm-review-list-label');
                const list = $('nm-review-list');
                const keptCard = $('nm-review-kept');
                const keptLabel = $('nm-review-kept-label');
                const keptList = $('nm-review-kept-list');
                const reviewNotices = $('nm-review-notices');

                const model = nmReviewModel(state, detectedOptionalCleanupFeatures, state.device.deviceInfo);
                $('step-nm-review').classList.toggle('review--removal', model.mode === 'remove');

                if (model.mode === 'remove') {
                    summary.textContent = TL.STATUS.NM_WILL_BE_REMOVED;
                    summary.hidden = false;
                    listLabel.textContent = TL.STATUS.NM_SELECTED_REMOVALS;
                    populateList(list, [TL.STATUS.NM_REMOVAL_NICKELMENU, ...model.removedFeatures.map((f) => f.cleanup.title)]);
                    populateList(
                        keptList,
                        model.keptFeatures.map((f) => f.cleanup.title),
                    );
                    keptLabel.textContent = TL.STATUS.NM_KEPT_FEATURES;
                    keptCard.hidden = model.keptFeatures.length === 0;
                    btnNmWrite.hidden = state.manualMode;
                    btnNmWrite.textContent = TL.BUTTON.REMOVE_FROM_KOBO;
                    btnNmDownload.hidden = true;
                    renderReviewNotices(reviewNotices, []);
                } else {
                    summary.hidden = true;
                    summary.textContent = '';
                    keptCard.hidden = true;
                    listLabel.textContent = TL.STATUS.NM_WILL_BE_INSTALLED;
                    populateList(list, [TL.STATUS.NM_NICKEL_ROOT_TGZ, ...model.installFeatures.map((f) => f.title)]);
                    btnNmWrite.hidden = false;
                    btnNmWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
                    btnNmDownload.hidden = false;
                    renderReviewNotices(reviewNotices, model.notices);
                }

                if (state.manualMode || !state.device.directoryHandle) {
                    btnNmWrite.hidden = true;
                }

                btnNmWrite.disabled = false;
                btnNmWrite.className = 'primary';
                btnNmDownload.disabled = false;
            },
        },
        {
            id: 'installing',
            domId: 'step-nm-installing',
            transient: true,
            navLabels: resolveNavLabels,
            navIndex: 5,
            recoveryStep: 'review',
        },
        {
            id: 'done',
            domId: 'step-nm-done',
            navLabels: resolveNavLabels,
            navIndex: 6,
            onEnter: async () => {
                renderNmDoneStatus(state, terminal, {
                    doneStatus: $('nm-done-status'),
                    writeInstructions: $('nm-write-instructions'),
                    downloadInstructions: $('nm-download-instructions'),
                    rebootInstructions: $('nm-reboot-instructions'),
                    downloadConfStep: $('nm-download-conf-step'),
                    downloadRebootStep: $('nm-download-reboot-step'),
                    downloadConfLine: $('nm-download-conf-line'),
                    downloadConfDesc: $('nm-download-conf-desc'),
                    downloadConfSettings: $('nm-download-conf-settings'),
                    downloadConfSettingsStep: $('nm-download-conf-settings-step'),
                });
            },
        },
        {
            id: 'manual-remove',
            domId: 'step-nm-manual-remove',
            navLabels: resolveNavLabels,
            navIndex: 4,
        },
    ];

    const flow = createFlow({ id: 'nickelmenu', steps });
    const terminal = createTerminal({
        doneStep: stepNmDone,
        showError: (...args) => state.showError(...args),
    });

    function renderFeatureCheckboxes() {
        const firmware = state.device?.deviceInfo?.firmware;
        const features = NICKELMENU_FEATURES.filter((f) => f.available !== false);

        if (state.selectedFeatureIds.length === 0) {
            state.selectedFeatureIds = features.filter((f) => meetsMinimumVersion(firmware, f.minimumVersion) && (f.required || f.default)).map((f) => f.id);
        }

        const items = features.map((f) => {
            const meetsMinimum = meetsMinimumVersion(firmware, f.minimumVersion);
            return {
                name: 'nm-cfg-' + f.id,
                title: f.title + (f.required ? ' (required)' : ''),
                version: f.version,
                description: f.description,
                hint: f.hint,
                sectionTitle: f.section,
                sectionCollapsed: NM_COLLAPSED_SECTIONS.has(f.section),
                checked: state.selectedFeatureIds.includes(f.id),
                disabled: f.required || !meetsMinimum,
                disabledReason: meetsMinimum ? undefined : `Requires Kobo software ${f.minimumVersion} or newer (this device runs ${firmware}).`,
                actionLabel: f.customization?.actionLabel,
                actionAriaLabel: f.customization?.actionAriaLabel,
                onAction: f.customization
                    ? (triggerEl) => {
                          nmCustomizationDraft = openMenuCustomizeDialog(state, customizationDialogDom, triggerEl);
                      }
                    : undefined,
                ...(f.customization ? getMenuCustomizationSummaryItem(state) : {}),
            };
        });
        renderNmCheckboxList(nmConfigOptions, items);

        for (const feature of features) {
            const cb = $q(`input[name="nm-cfg-${feature.id}"]`);
            if (!cb) continue;
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    if (!state.selectedFeatureIds.includes(feature.id)) {
                        state.selectedFeatureIds.push(feature.id);
                    }
                } else {
                    state.selectedFeatureIds = state.selectedFeatureIds.filter((id) => id !== feature.id);
                }
            });
        }
    }

    const customizationDialogDom = {
        dialog: nmCustomizeDialog,
        labelInput: nmCustomizeLabel,
        counter: nmCustomizeCounter,
        presets: nmCustomizePresets,
        upload: nmCustomizeUpload,
        uploadPreview: nmCustomizeUploadPreview,
        uploadName: nmCustomizeUploadName,
        close: btnNmCustomizeClose,
        cancel: btnNmCustomizeCancel,
        reset: btnNmCustomizeReset,
        save: btnNmCustomizeSave,
        status: nmCustomizeStatus,
    };

    function renderCleanupCheckboxes() {
        if (detectedOptionalCleanupFeatures.length === 0) {
            nmUninstallOptions.innerHTML = '';
            return;
        }
        const items = detectedOptionalCleanupFeatures.map((f) => ({
            name: 'nm-uninstall-' + f.id,
            title: f.cleanup.removeLabel ?? 'Remove ' + f.cleanup.title,
            description: f.cleanup.description,
            checked: true,
        }));
        renderNmCheckboxList(nmUninstallOptions, items);

        // Checkboxes default to checked (remove). Seed the session from that and
        // keep it in sync as the source of truth for what gets removed.
        state.nmOptionalCleanupIds = detectedOptionalCleanupFeatures.map((f) => f.id);
        for (const f of detectedOptionalCleanupFeatures) {
            const cb = $q(`input[name="nm-uninstall-${f.id}"]`);
            if (!cb) continue;
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    if (!state.nmOptionalCleanupIds.includes(f.id)) {
                        state.nmOptionalCleanupIds.push(f.id);
                    }
                } else {
                    state.nmOptionalCleanupIds = state.nmOptionalCleanupIds.filter((id) => id !== f.id);
                }
            });
        }
    }

    function resetNickelMenuState() {
        detectedOptionalCleanupFeatures = [];
        detectedPresetConflictsList = [];
        legacyItemsDetected = false;
        legacyItemsWasOurs = false;
        nmOptionPresetTitle.textContent = NM_PRESET_TITLE_INSTALL;
        state.koboUserCount = undefined;
        state.nickelMenuOption = null;
        state.selectedFeatureIds = [];
        state.nmOptionalCleanupIds = [];
        state.nmKeepLegacyConfig = false;
        $('nm-sideloaded-banner').hidden = true;
        nmUninstallOptions.hidden = true;
        nmUninstallOptions.innerHTML = '';
        nmPresetConflictList.innerHTML = '';
        nmPresetConflictAck.checked = false;
        btnNmPresetConflictNext.disabled = true;
        state.nmBackupChoice = null;
        state.nickelMenuCustomization = createDefaultMenuCustomization();
        nmCustomizationDraft = cloneMenuCustomization(state.nickelMenuCustomization);
        nmCustomizationSession++;
        nmConfigOptions.innerHTML = '';
        updateMenuCustomizationSummary(state);
        btnNmBackupNext.disabled = true;
        btnNmBackupNext.textContent = 'Continue \u203A';
        btnNmBackupBack.disabled = false;
        for (const radio of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
            radio.checked = false;
            radio.closest('.selection-card')?.classList.remove('selection-card--selected');
            radio.disabled = false;
        }
    }

    async function checkNmInstalledState() {
        const removeOption = $('nm-option-remove');
        const removeRadio = $q('input[value="remove"]', removeOption);
        const removeDesc = $('nm-remove-desc');

        await probeCheckNickelMenuInstalled(state, {
            presetTitleEl: nmOptionPresetTitle,
            removeOption,
            removeRadio,
            removeDesc,
            presetTitleInstall: NM_PRESET_TITLE_INSTALL,
            presetTitleReinstall: NM_PRESET_TITLE_REINSTALL,
            // Detect only on first visit so back-navigation preserves the user's
            // cleanup checkbox selections (re-rendering would wipe them).
            onOptionalCleanupDetected:
                detectedOptionalCleanupFeatures.length === 0
                    ? (detected) => {
                          detectedOptionalCleanupFeatures.push(...detected);
                          renderCleanupCheckboxes();
                      }
                    : undefined,
            onLegacyItemsDetected: ({ detected, wasOurs }) => {
                legacyItemsDetected = detected;
                legacyItemsWasOurs = wasOurs;
            },
        });
    }

    async function detectHasPresetConflicts() {
        detectedPresetConflictsList = await probeDetectPresetConflicts(state);
        return detectedPresetConflictsList.length > 0;
    }

    for (const radio of $qa('input[name="nm-option"]', stepNickelMenu)) {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            state.nickelMenuOption = radio.value;
            nmUninstallOptions.hidden = radio.value !== 'remove' || detectedOptionalCleanupFeatures.length === 0;
            flow.refreshNav(state);
            btnNmNext.disabled = false;
        });
    }

    async function goToNickelMenuConfig() {
        await flow.go('config', state);
    }

    btnNmBack.addEventListener('click', () => {
        state.goToModeSelection();
    });

    btnNmNext.addEventListener('click', async () => {
        const selected = $q('input[name="nm-option"]:checked', stepNickelMenu);
        if (!selected) return;
        state.nickelMenuOption = selected.value;
        track('nm-option', { option: state.nickelMenuOption });

        if (state.nickelMenuOption === 'remove' && state.manualMode) {
            terminal.end('nm-remove-manual');
            await flow.go('manual-remove', state);
            return;
        }

        if (state.nickelMenuOption === 'preset') {
            if (await detectHasPresetConflicts()) {
                await flow.go('preset-conflict', state);
                return;
            }
            await flow.go('features', state);
        } else {
            await flow.go('backup', state);
        }
    });

    btnNmPresetConflictBack.addEventListener('click', async () => {
        const target = flow.back(state);
        if (target) await flow.go(target, state);
    });

    nmPresetConflictAck.addEventListener('change', () => {
        btnNmPresetConflictNext.disabled = !nmPresetConflictAck.checked;
    });

    btnNmPresetConflictNext.addEventListener('click', async () => {
        if (!nmPresetConflictAck.checked) return;
        await flow.go('features', state);
    });

    async function updateSideloadedRecommendation() {
        const banner = $('nm-sideloaded-banner');
        const firmware = state.device?.deviceInfo?.firmware;
        const sideloaded = NICKELMENU_FEATURES.find((f) => f.id === 'sideloaded-mode');
        if (!meetsMinimumVersion(firmware, sideloaded?.minimumVersion)) {
            banner.hidden = true;
            return;
        }

        const userCount = await probeGetKoboUserCount(state);
        banner.hidden = userCount !== 0;

        if (userCount === 0) {
            for (const section of $qa('.nm-config-section', nmConfigOptions)) {
                const title = $q('.nm-config-section-title', section);
                if (title && title.textContent === sideloaded.section) section.open = true;
            }
        }
    }

    btnNmFeaturesBack.addEventListener('click', async () => {
        const target = flow.back(state);
        if (target) await flow.go(target, state);
    });

    btnNmFeaturesNext.addEventListener('click', async () => {
        await flow.go('backup', state);
    });

    nmCustomizeLabel.addEventListener('input', () => updateMenuCustomizationDialog(nmCustomizationDraft, customizationDialogDom));
    nmCustomizeUpload.addEventListener('change', () => {
        const draft = nmCustomizationDraft;
        const session = nmCustomizationSession;
        handleNmIconUpload(
            nmCustomizeUpload.files?.[0],
            draft,
            (msg) => {
                if (draft !== nmCustomizationDraft || session !== nmCustomizationSession) return;
                updateMenuCustomizationDialog(nmCustomizationDraft, customizationDialogDom, msg);
            },
            () => draft === nmCustomizationDraft && session === nmCustomizationSession,
        );
        nmCustomizeUpload.value = '';
    });
    btnNmCustomizeClose.addEventListener('click', () => nmCustomizeDialog.close());
    btnNmCustomizeCancel.addEventListener('click', () => nmCustomizeDialog.close());
    btnNmCustomizeReset.addEventListener('click', () => {
        nmCustomizationSession++;
        nmCustomizationDraft = createDefaultMenuCustomization();
        nmCustomizeLabel.value = NM_MENU_DEFAULT_LABEL;
        updateMenuCustomizationDialog(
            nmCustomizationDraft,
            customizationDialogDom,
            isDefaultMenuCustomization(state.nickelMenuCustomization) ? '' : 'Defaults restored.',
        );
    });
    btnNmCustomizeSave.addEventListener('click', () => {
        const label = sanitizeMenuLabel(nmCustomizeLabel.value).trim();
        if (!isValidMenuLabel(label)) {
            updateMenuCustomizationDialog(nmCustomizationDraft, customizationDialogDom);
            return;
        }

        state.nickelMenuCustomization = {
            ...nmCustomizationDraft,
            label,
        };
        nmCustomizationSession++;
        updateMenuCustomizationSummary(state);
        nmCustomizeDialog.close();
    });

    for (const radio of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
        radio.addEventListener('change', () => {
            state.nmBackupChoice = radio.value;
            btnNmBackupNext.disabled = false;
            for (const other of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
                other.closest('.selection-card')?.classList.toggle('selection-card--selected', other.checked);
            }
        });
    }

    $('nm-keep-items').addEventListener('change', () => {
        state.nmKeepLegacyConfig = $('nm-keep-items').checked;
    });

    btnNmBackupBack.addEventListener('click', async () => {
        const target = flow.back(state);
        if (target) await flow.go(target, state);
    });

    btnNmBackupNext.addEventListener('click', async () => {
        if (!shouldOfferNmBackup(state)) {
            await flow.go('review', state);
            return;
        }

        if (!state.nmBackupChoice) return;
        if (state.nmBackupChoice === 'skip') {
            await flow.go('review', state);
            return;
        }

        btnNmBackupBack.disabled = true;
        btnNmBackupNext.disabled = true;
        btnNmBackupNext.textContent = 'Preparing backup...';
        for (const radio of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
            radio.disabled = true;
        }

        try {
            const backup = await prepareNmBackup(state);
            if (backup) {
                await terminal.download({ entries: backup.entries, filename: backup.filename });
            }
            await flow.go('review', state);
        } catch (err) {
            state.showError(err.message);
        } finally {
            btnNmBackupBack.disabled = false;
            btnNmBackupNext.textContent = 'Continue \u203A';
            for (const radio of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
                radio.disabled = false;
            }
        }
    });

    btnNmReviewBack.addEventListener('click', async () => {
        const target = flow.back(state);
        if (target) await flow.go(target, state);
    });

    btnNmWrite.addEventListener('click', () => {
        executeNmInstallFn({
            state,
            flow,
            terminal,
            dom: {
                progress: $('nm-progress'),
                progressDetail: $('nm-progress-detail'),
                detectedOptionalCleanupFeatures,
                legacyItemsDetected,
                writeToDevice: true,
            },
            showError: (...args) => state.showError(...args),
        });
    });
    btnNmDownload.addEventListener('click', () => {
        executeNmInstallFn({
            state,
            flow,
            terminal,
            dom: {
                progress: $('nm-progress'),
                progressDetail: $('nm-progress-detail'),
                detectedOptionalCleanupFeatures,
                legacyItemsDetected,
                writeToDevice: false,
            },
            showError: (...args) => state.showError(...args),
        });
    });

    return { goToNickelMenuConfig, resetNickelMenuState };
}
