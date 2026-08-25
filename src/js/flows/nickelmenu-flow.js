/**
 * nickelmenu-flow.js — The NickelMenu wizard flow.
 *
 * Owns the configure → backup → review → install/remove steps: preset vs
 * NickelMenu-only selection, feature configuration, the optional backup, and the
 * review screen. The actual device writes are delegated to nickelmenu-execute.js.
 */

import { $, $q, $qa, collect, populateList } from '../shell/dom.js';
import { setupCardRadios } from '../shell/navigation.js';
import { renderNmCheckboxList, setNmSubItemAvailability } from '../nickelmenu/checkbox-list.js';
import { createFlow } from '../shell/step-machine.js';
import { createTerminal } from '../shell/terminal.js';
import { NICKELMENU_FEATURES } from '../nickelmenu/features/index.js';
import { displayVersion, installablesManifest } from '../nickelmenu/installables.js';
import {
    createDefaultMenuCustomization,
    isDefaultMenuCustomization,
    isValidMenuLabel,
    NM_MENU_DEFAULT_LABEL,
    sanitizeMenuLabel,
} from '../nickelmenu/customization.js';
import {
    checkNickelMenuInstalled as probeCheckNickelMenuInstalled,
    detectInstalledNickelMenuFeatureIds,
    detectPresetConflicts as probeDetectPresetConflicts,
    getKoboUserCount as probeGetKoboUserCount,
    readPreviousNickelMenuConfiguration,
} from '../nickelmenu/probes.js';
import { nmReviewModel, featureDisabledReason, parentIsCovered, subFeatureCheckboxLabel, subFeatureNoun, subFeatures } from '../nickelmenu/selection.js';
import {
    cloneMenuCustomization,
    getMenuCustomizationSummaryItem,
    updateMenuCustomizationSummary,
    openMenuCustomizeDialog,
    updateMenuCustomizationDialog,
    handleNmIconUpload,
} from '../nickelmenu/customization-dialog.js';
import {
    cloneTabsCustomization,
    createDefaultTabsCustomization,
    getTabsCustomizationSummaryItem,
    updateTabsCustomizationSummary,
    openTabsCustomizeDialog,
    seedTabsCustomizeDialog,
    updateTabsCustomizationDialog,
} from '../nickelmenu/features/simplify-tabs/customization-dialog.js';
import {
    cloneFontsCustomization,
    createDefaultFontsCustomization,
    getFontsCustomizationSummaryItem,
    updateFontsCustomizationSummary,
    openFontsCustomizeDialog,
    seedFontsCustomizeDialog,
    setFontsCollectionSelection,
    normalizedFontsCustomization,
} from '../nickelmenu/features/additional-fonts/customization-dialog.js';
import { meetsMinimumVersion } from '../kobo/version.js';
import { TL } from '../shell/strings.js';
import { track } from '../shell/analytics.js';
import { shouldOfferNmBackup, prepareNmBackup } from './nickelmenu-backup.js';
import { executeNmInstall as executeNmInstallFn, renderNmDoneStatus, renderReviewNotices } from './nickelmenu-execute.js';

const NM_COLLAPSED_SECTIONS = new Set(['Alternative reading apps', 'Advanced', 'Legacy']);

export function initNickelMenuFlow(state) {
    const {
        'step-nickelmenu': stepNickelMenu,
        'step-nm-backup': stepNmBackup,
        'step-nm-done': stepNmDone,
        'nm-config-options': nmConfigOptions,
        'nm-previous-configuration-actions': nmPreviousConfigurationActions,
        'btn-nm-use-previous-configuration': btnNmUsePreviousConfiguration,
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
        'nm-tabs-dialog': nmTabsDialog,
        'nm-tabs-status': nmTabsStatus,
        'nm-tabs-preview': nmTabsPreview,
        'nm-tabs-vis-stats': nmTabsVisStats,
        'nm-tabs-vis-notes': nmTabsVisNotes,
        'nm-tabs-vis-store': nmTabsVisStore,
        'nm-tabs-label-books': nmTabsLabelBooks,
        'nm-tabs-label-stats': nmTabsLabelStats,
        'nm-tabs-label-notes': nmTabsLabelNotes,
        'btn-nm-tabs-close': btnNmTabsClose,
        'btn-nm-tabs-cancel': btnNmTabsCancel,
        'btn-nm-tabs-reset': btnNmTabsReset,
        'btn-nm-tabs-save': btnNmTabsSave,
        'nm-fonts-dialog': nmFontsDialog,
        'nm-fonts-status': nmFontsStatus,
        'nm-fonts-core-list': nmFontsCoreList,
        'nm-fonts-extra-list': nmFontsExtraList,
        'nm-fonts-core-count': nmFontsCoreCount,
        'nm-fonts-extra-count': nmFontsExtraCount,
        'btn-nm-fonts-core-all': btnNmFontsCoreAll,
        'btn-nm-fonts-core-none': btnNmFontsCoreNone,
        'btn-nm-fonts-extra-all': btnNmFontsExtraAll,
        'btn-nm-fonts-extra-none': btnNmFontsExtraNone,
        'btn-nm-fonts-close': btnNmFontsClose,
        'btn-nm-fonts-cancel': btnNmFontsCancel,
        'btn-nm-fonts-reset': btnNmFontsReset,
        'btn-nm-fonts-save': btnNmFontsSave,
        'nm-option-preset-title': nmOptionPresetTitle,
    } = collect([
        'step-nickelmenu',
        'step-nm-backup',
        'step-nm-done',
        'nm-config-options',
        'nm-previous-configuration-actions',
        'btn-nm-use-previous-configuration',
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
        'nm-tabs-dialog',
        'nm-tabs-status',
        'nm-tabs-preview',
        'nm-tabs-vis-stats',
        'nm-tabs-vis-notes',
        'nm-tabs-vis-store',
        'nm-tabs-label-books',
        'nm-tabs-label-stats',
        'nm-tabs-label-notes',
        'btn-nm-tabs-close',
        'btn-nm-tabs-cancel',
        'btn-nm-tabs-reset',
        'btn-nm-tabs-save',
        'nm-fonts-dialog',
        'nm-fonts-status',
        'nm-fonts-core-list',
        'nm-fonts-extra-list',
        'nm-fonts-core-count',
        'nm-fonts-extra-count',
        'btn-nm-fonts-core-all',
        'btn-nm-fonts-core-none',
        'btn-nm-fonts-extra-all',
        'btn-nm-fonts-extra-none',
        'btn-nm-fonts-close',
        'btn-nm-fonts-cancel',
        'btn-nm-fonts-reset',
        'btn-nm-fonts-save',
        'nm-option-preset-title',
    ]);

    // Gate runtime-available installables (reading apps, NickelClock, ...) on the
    // baked-in manifest; add-ons whose asset is not bundled stay `available: false`
    // and are listed as "Temporarily unavailable" in the feature list.
    for (const [id, info] of Object.entries(installablesManifest())) {
        const feature = NICKELMENU_FEATURES.find((f) => f.id === id);
        if (feature && info.available) {
            feature.available = true;
            feature.version = info.version;
        }
    }

    setupCardRadios(stepNickelMenu, 'selection-card--selected');

    const NM_PRESET_TITLE_INSTALL = nmOptionPresetTitle.textContent;
    const NM_PRESET_TITLE_REINSTALL = 'Modify current setup (and customize)';

    let detectedOptionalCleanupFeatures = [];
    let detectedPresetConflictsList = [];
    let legacyItemsDetected = false;
    let legacyItemsWasOurs = false;
    let webuiPresetInstalled = false;
    let previousConfigurationApplied = false;
    let nmCustomizationDraft = cloneMenuCustomization(state.nickelMenuCustomization);
    let nmCustomizationSession = 0;
    let nmTabsDraft = cloneTabsCustomization(state.nickelMenuTabsCustomization);
    let nmFontsDraft = cloneFontsCustomization(state.nickelMenuFontsCustomization);

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
                if (webuiPresetInstalled && !previousConfigurationApplied) {
                    restorePreviousConfiguration(true, false);
                }
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
                // An install run that also removes things marks that list red,
                // so "will be removed" never reads like part of the install.
                keptCard.classList.toggle('review-summary--pending-removals', model.mode !== 'remove' && model.removedFeatures.length > 0);

                if (model.mode === 'remove') {
                    summary.textContent = TL.STATUS.NM_WILL_BE_REMOVED;
                    summary.hidden = false;
                    listLabel.textContent = TL.STATUS.NM_SELECTED_REMOVALS;
                    populateList(list, [TL.STATUS.NM_REMOVAL_NICKELMENU, ...model.removedFeatures.map((f) => (f.modifyCleanup || f.cleanup).title)]);
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
                    populateList(
                        keptList,
                        model.removedFeatures.map((f) => (f.modifyCleanup || f.cleanup).title),
                    );
                    keptLabel.textContent = 'These currently installed features will be removed:';
                    keptCard.hidden = model.removedFeatures.length === 0;
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
                    ejectWatch: $('nm-eject-watch'),
                    ejectWaiting: $('nm-eject-waiting'),
                    ejectWaitingText: $('nm-eject-waiting-text'),
                    ejectStatus: $('nm-eject-status'),
                    ejectDetail: $('nm-eject-detail'),
                    ejectGlitchNote: $('nm-eject-glitch-note'),
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

    // The summary chip shown next to a feature's customize action, per
    // customization type (the Toggle-menu icon/label, tabs, or fonts dialog).
    function customizationSummaryItem(type) {
        if (type === 'tabs') return getTabsCustomizationSummaryItem(state);
        if (type === 'fonts') return getFontsCustomizationSummaryItem(state);
        return getMenuCustomizationSummaryItem(state);
    }

    function renderFeatureCheckboxes() {
        const deviceInfo = state.device?.deviceInfo;
        // Hidden add-ons stay in the registry so existing installs can still be
        // detected and removed, but are omitted from the install catalogue.
        // Unavailable or disabled add-ons stay listed with an explanation.
        // Subitems are not rows at all: they are picked in their parent's dialog.
        const features = NICKELMENU_FEATURES.filter((f) => !f.hidden && !f.parent);

        if (state.selectedFeatureIds.length === 0) {
            state.selectedFeatureIds = features.filter((f) => (f.required || f.default) && !featureDisabledReason(f, deviceInfo)).map((f) => f.id);
        }

        const items = features.map((f) => {
            // Everything that can hold a feature back — a maintainer kill switch,
            // too-old firmware, a feature-owned device gate, an unbundled asset —
            // comes back as one reason string.
            const reason = featureDisabledReason(f, deviceInfo);
            return {
                name: 'nm-cfg-' + f.id,
                title: f.title + (f.required ? ' (required)' : ''),
                version: displayVersion(typeof f.version === 'function' ? f.version() : f.version),
                description: f.description,
                hint: f.hint,
                experimental: f.experimental === true,
                previouslySelected: state.previousNickelMenuFeatureIds.includes(f.id),
                currentlyInstalled: state.installedNickelMenuFeatureIds.includes(f.id),
                sectionTitle: f.section,
                sectionCollapsed: NM_COLLAPSED_SECTIONS.has(f.section),
                checked: state.selectedFeatureIds.includes(f.id) && !reason,
                disabled: f.required || Boolean(reason),
                disabledReason: reason,
                subItems: subFeatureItems(f, deviceInfo),
                actionLabel: f.customization?.actionLabel,
                actionAriaLabel: f.customization?.actionAriaLabel,
                onAction: f.customization
                    ? () => {
                          if (f.customization.type === 'tabs') {
                              nmTabsDraft = openTabsCustomizeDialog(state, tabsDialogDom);
                          } else if (f.customization.type === 'fonts') {
                              nmFontsDraft = openFontsCustomizeDialog(state, fontsDialogDom);
                          } else {
                              nmCustomizationSession++;
                              const session = nmCustomizationSession;
                              nmCustomizationDraft = openMenuCustomizeDialog(state, customizationDialogDom, () => session === nmCustomizationSession);
                          }
                      }
                    : undefined,
                ...(f.customization ? customizationSummaryItem(f.customization.type) : {}),
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
                refreshSubFeatureSelections();
            });
        }

        refreshSubFeatureSelections();
    }

    /**
     * The add-on checkboxes rendered under a feature's description. An add-on
     * installs inside its parent, so it is only selectable once the parent is
     * ticked or already on the device — said on the checkbox itself rather than
     * hidden, so the option is always visible.
     */
    function subFeatureItems(parent, deviceInfo) {
        return subFeatures(parent.id)
            .filter((f) => !f.hidden)
            .map((f) => {
                // Its own blockers are worth explaining; waiting on the feature
                // it sits under is not — it is greyed out directly beneath it.
                const reason = featureDisabledReason(f, deviceInfo);
                const disabled = Boolean(reason) || !parentIsCovered(parent.id, state);
                return {
                    name: 'nm-cfg-' + f.id,
                    label: subFeatureCheckboxLabel(f),
                    badge: subFeatureNoun(parent.id),
                    currentlyInstalled: state.installedNickelMenuFeatureIds.includes(f.id),
                    version: displayVersion(typeof f.version === 'function' ? f.version() : f.version),
                    hint: f.hint,
                    checked: state.selectedFeatureIds.includes(f.id) && !disabled,
                    disabled,
                    disabledReason: reason,
                    onChange: (checked) => {
                        if (checked) {
                            if (!state.selectedFeatureIds.includes(f.id)) state.selectedFeatureIds.push(f.id);
                        } else {
                            state.selectedFeatureIds = state.selectedFeatureIds.filter((id) => id !== f.id);
                        }
                    },
                };
            });
    }

    /**
     * Bring every add-on checkbox in line with its parent. An add-on installs
     * inside its parent, so it becomes selectable when the parent is ticked and
     * un-ticks itself when the parent goes away, rather than silently failing to
     * install. Patched in place rather than re-rendered, so the sections the
     * user opened stay open.
     */
    function refreshSubFeatureSelections() {
        const deviceInfo = state.device?.deviceInfo;

        for (const feature of NICKELMENU_FEATURES.filter((f) => f.parent && !f.hidden)) {
            const reason = featureDisabledReason(feature, deviceInfo);
            const disabled = Boolean(reason) || !parentIsCovered(feature.parent, state);

            const cb = $q(`input[name="nm-cfg-${feature.id}"]`);
            if (!cb) continue;
            if (disabled && cb.checked) cb.checked = false;
            if (disabled) state.selectedFeatureIds = state.selectedFeatureIds.filter((id) => id !== feature.id);
            setNmSubItemAvailability(cb, disabled, reason);
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

    const tabsDialogDom = {
        dialog: nmTabsDialog,
        status: nmTabsStatus,
        preview: nmTabsPreview,
        visibility: {
            stats: nmTabsVisStats,
            notes: nmTabsVisNotes,
            store: nmTabsVisStore,
        },
        labels: {
            books: nmTabsLabelBooks,
            stats: nmTabsLabelStats,
            notes: nmTabsLabelNotes,
        },
    };

    const fontsDialogDom = {
        dialog: nmFontsDialog,
        status: nmFontsStatus,
        save: btnNmFontsSave,
        lists: { core: nmFontsCoreList, extra: nmFontsExtraList },
        counts: { core: nmFontsCoreCount, extra: nmFontsExtraCount },
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
        state._nmEjectWatch?.stop();
        state._nmEjectWatch = null;
        detectedOptionalCleanupFeatures = [];
        detectedPresetConflictsList = [];
        legacyItemsDetected = false;
        legacyItemsWasOurs = false;
        nmOptionPresetTitle.textContent = NM_PRESET_TITLE_INSTALL;
        state.koboUserCount = undefined;
        state.nickelMenuOption = null;
        state.selectedFeatureIds = [];
        state.previousNickelMenuFeatureIds = [];
        state.previousNickelMenuConfiguration = null;
        state.installedNickelMenuFeatureIds = [];
        state.nmWebuiPresetInstalled = false;
        webuiPresetInstalled = false;
        previousConfigurationApplied = false;
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
        state.nickelMenuTabsCustomization = createDefaultTabsCustomization();
        nmTabsDraft = cloneTabsCustomization(state.nickelMenuTabsCustomization);
        state.nickelMenuFontsCustomization = createDefaultFontsCustomization();
        nmFontsDraft = cloneFontsCustomization(state.nickelMenuFontsCustomization);
        nmConfigOptions.innerHTML = '';
        nmPreviousConfigurationActions.hidden = true;
        $('nm-installed-features-note').hidden = true;
        updateMenuCustomizationSummary(state);
        updateTabsCustomizationSummary(state);
        updateFontsCustomizationSummary(state);
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

        const [installedState, previousConfiguration] = await Promise.all([
            probeCheckNickelMenuInstalled(state, {
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
            }),
            readPreviousNickelMenuConfiguration(state),
        ]);
        state.previousNickelMenuConfiguration = previousConfiguration;
        state.previousNickelMenuFeatureIds = previousConfiguration?.selectedFeatureIds || [];
        webuiPresetInstalled = installedState.webuiPresetPresent;
        // Only a setup this tool wrote can be modified: it is what makes the
        // feature list reflect reality, and so what makes an unticked box mean
        // "remove this". See `featuresToRemove` in selection.js.
        state.nmWebuiPresetInstalled = webuiPresetInstalled;
        state.installedNickelMenuFeatureIds = await detectInstalledNickelMenuFeatureIds(state, state.previousNickelMenuFeatureIds, webuiPresetInstalled);
        $('nm-installed-features-note').hidden = !installedState.installed;
        nmPreviousConfigurationActions.hidden = !previousConfiguration || webuiPresetInstalled;
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
        const sideloaded = supportedSideloadedModeFeature(NICKELMENU_FEATURES, firmware);
        if (!sideloaded) {
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

    /**
     * Seed the wizard from a previous run. With `useInstalledState` it seeds the
     * ticks from what is actually on the device (the modify case); otherwise it
     * seeds them from the manifest's recorded selection (the "Use last
     * configuration" button, offered when our preset is gone but its manifest
     * survives). Customizations come from the manifest either way.
     */
    function restorePreviousConfiguration(useInstalledState = false, render = true) {
        const previous = state.previousNickelMenuConfiguration;
        if (!previous && !useInstalledState) return false;

        const previousIds = new Set(useInstalledState ? state.installedNickelMenuFeatureIds : previous.selectedFeatureIds);
        state.selectedFeatureIds = NICKELMENU_FEATURES.filter((feature) => !feature.hidden && (feature.required || previousIds.has(feature.id))).map(
            (feature) => feature.id,
        );

        if (previous?.menuCustomization) {
            const previousIcon = previous.menuCustomization.icon;
            if (previousIcon?.type === 'upload' && previousIcon.data && !previousIcon.previewUrl) {
                previousIcon.previewUrl = URL.createObjectURL(new Blob([previousIcon.data], { type: previousIcon.mimeType }));
            }
            state.nickelMenuCustomization = cloneMenuCustomization(previous.menuCustomization);
            nmCustomizationDraft = cloneMenuCustomization(state.nickelMenuCustomization);
            nmCustomizationSession++;
        }
        if (previous?.tabsCustomization && previousIds.has('simplify-tabs')) {
            state.nickelMenuTabsCustomization = cloneTabsCustomization(previous.tabsCustomization);
            nmTabsDraft = cloneTabsCustomization(state.nickelMenuTabsCustomization);
        }
        if (previous?.fontsCustomization && previousIds.has('additional-fonts')) {
            state.nickelMenuFontsCustomization = cloneFontsCustomization(previous.fontsCustomization);
            nmFontsDraft = cloneFontsCustomization(state.nickelMenuFontsCustomization);
        }

        previousConfigurationApplied = true;
        if (render) renderFeatureCheckboxes();
        return true;
    }

    btnNmUsePreviousConfiguration.addEventListener('click', () => {
        restorePreviousConfiguration(false);
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

    // "Customize simplified tabs" dialog wiring.
    for (const input of [nmTabsVisStats, nmTabsVisNotes, nmTabsVisStore, nmTabsLabelBooks, nmTabsLabelStats, nmTabsLabelNotes]) {
        input.addEventListener('input', () => updateTabsCustomizationDialog(nmTabsDraft, tabsDialogDom));
    }
    btnNmTabsClose.addEventListener('click', () => nmTabsDialog.close());
    btnNmTabsCancel.addEventListener('click', () => nmTabsDialog.close());
    btnNmTabsReset.addEventListener('click', () => {
        nmTabsDraft = seedTabsCustomizeDialog(state, tabsDialogDom, createDefaultTabsCustomization());
        nmTabsStatus.textContent = 'Defaults restored.';
    });
    btnNmTabsSave.addEventListener('click', () => {
        updateTabsCustomizationDialog(nmTabsDraft, tabsDialogDom);
        state.nickelMenuTabsCustomization = {
            labels: { ...nmTabsDraft.labels },
            visibility: { ...nmTabsDraft.visibility },
        };
        updateTabsCustomizationSummary(state);
        nmTabsDialog.close();
    });

    // "Select additional fonts" dialog wiring.
    btnNmFontsClose.addEventListener('click', () => nmFontsDialog.close());
    btnNmFontsCancel.addEventListener('click', () => nmFontsDialog.close());
    btnNmFontsCoreAll.addEventListener('click', () => setFontsCollectionSelection(nmFontsDraft, fontsDialogDom, 'core', true));
    btnNmFontsCoreNone.addEventListener('click', () => setFontsCollectionSelection(nmFontsDraft, fontsDialogDom, 'core', false));
    btnNmFontsExtraAll.addEventListener('click', () => setFontsCollectionSelection(nmFontsDraft, fontsDialogDom, 'extra', true));
    btnNmFontsExtraNone.addEventListener('click', () => setFontsCollectionSelection(nmFontsDraft, fontsDialogDom, 'extra', false));
    btnNmFontsReset.addEventListener('click', () => {
        nmFontsDraft = seedFontsCustomizeDialog(fontsDialogDom, createDefaultFontsCustomization());
        nmFontsStatus.textContent = 'Defaults restored.';
    });
    btnNmFontsSave.addEventListener('click', () => {
        if (nmFontsDraft.families.length === 0) return;
        state.nickelMenuFontsCustomization = normalizedFontsCustomization(nmFontsDraft);
        updateFontsCustomizationSummary(state);
        nmFontsDialog.close();
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

export function supportedSideloadedModeFeature(features, firmware) {
    const feature = features.find((candidate) => candidate.id === 'sideloaded-mode');
    return feature && meetsMinimumVersion(firmware, feature.minimumVersion) ? feature : null;
}
