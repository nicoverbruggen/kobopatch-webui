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
import { $, $q, $qa, triggerDownload, renderNmCheckboxList, populateList, setupFeedback } from '../shell/dom.js';
import { showStep, setNavLabels, setNavStep } from '../shell/navigation.js';
import { CONF_DESC_DEFAULT, CONF_DESC_EXCLUDE_CALIBRE } from '../shell/instructions.js';
import { NICKELMENU_FEATURES, getExcludeSyncFoldersLine, revertableConfSettings } from '../nickelmenu/installer.js';
import {
    createDefaultMenuCustomization,
    findPresetIcon,
    isDefaultMenuCustomization,
    isValidMenuLabel,
    NM_MENU_DEFAULT_LABEL,
    NM_MENU_LABEL_MAX_LENGTH,
    NM_MENU_PRESET_ICONS,
    normalizeMenuLabel,
    sanitizeMenuLabel,
} from '../nickelmenu/customization.js';

/** The legacy NickelMenu config path that kobopatch-web-ui used before the rename to webui-preset. */
const NM_LEGACY_ITEMS_FILE = '.adds/nm/items';
import {
    executeNickelMenuRemoval,
    hasAddsDirectoriesRequiringSyncExclusions,
} from '../nickelmenu/uninstaller.js';
import { getConfSetting } from '../kobo/configuration.js';
import { AuditLog } from '../kobo/audit-log.js';
import { meetsMinimumVersion } from '../kobo/version.js';
import { countKoboUsers } from '../kobo/signin.js';
import { TL } from '../shell/strings.js';
import { isEnabled as analyticsEnabled, track } from '../shell/analytics.js';

const NM_REVIEW_BACKUP_PATHS = [
    ['.kobo', 'Kobo'],
    ['.kobo', 'markups'],
    ['.kobo', 'BookReader.sqlite'],
    ['.kobo', 'device.salt.conf'],
    ['.kobo', 'fonts.sqlite'],
    ['.kobo', 'KoboReader.sqlite'],
    ['.kobo', 'version'],
];

const NM_DEFAULT_ICON_ASSET = 'js/nickelmenu/features/custom-menu/.cog.png';
const NM_PRESET_ICON_PNG_SIZE = 48;
const NM_UPLOAD_ICON_SIZE = 64;

// Feature sections that start collapsed in the selection step — less-common
// options tucked away by default. The render order (and so which section appears
// last) follows NICKELMENU_FEATURES, where these sections come last.
const NM_COLLAPSED_SECTIONS = new Set(['Advanced', 'Legacy']);

// Add-ons whose presence indicates a prior, potentially conflicting mod setup
// that should block a preset install. NickelClock is intentionally absent: it
// coexists with NickelMenu and is now offered as an Advanced feature, so an
// existing install is managed rather than treated as a conflict.
const NM_PRESET_CONFLICTS = [
    { id: 'nickeldbus', path: ['.adds', 'nickeldbus'], label: 'nickeldbus (.adds/nickeldbus)' },
    { id: 'nickelseries', path: ['.adds', 'nickelseries'], label: 'nickelseries (.adds/nickelseries)' },
];

export function initNickelMenu(state) {
    // --- DOM references (scoped to this flow) ---

    const stepNickelMenu = $('step-nickelmenu');
    const stepNmManualRemove = $('step-nm-manual-remove');
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
    const nmManualBackupInstructions = $('nm-manual-backup-instructions');
    const nmPresetConflictSummary = $('nm-preset-conflict-summary');
    const nmPresetConflictList = $('nm-preset-conflict-list');
    const nmPresetConflictAck = $('nm-preset-conflict-ack');
    const nmCustomizeDialog = $('nm-customize-dialog');
    const nmCustomizeLabel = $('nm-customize-label');
    const nmCustomizeCounter = $('nm-customize-counter');
    const nmCustomizeStatus = $('nm-customize-status');
    const nmCustomizePresets = $('nm-customize-presets');
    const nmCustomizeUpload = $('nm-customize-upload');
    const nmCustomizeUploadPreview = $('nm-customize-upload-preview');
    const nmCustomizeUploadName = $('nm-customize-upload-name');
    const btnNmCustomizeClose = $('btn-nm-customize-close');
    const btnNmCustomizeCancel = $('btn-nm-customize-cancel');
    const btnNmCustomizeReset = $('btn-nm-customize-reset');
    const btnNmCustomizeSave = $('btn-nm-customize-save');

    // Features detected on the device that can optionally be cleaned up during
    // removal (e.g. KOReader). Populated by checkNickelMenuInstalled().
    let detectedOptionalCleanupFeatures = [];
    let detectedPresetConflicts = [];
    let nmBackupChoice = null;

    // Whether a legacy `.adds/nm/items` file exists on the connected device,
    // and whether it appears to have been generated by a previous version of
    // this tool (heuristically: contains "Legibility Status" or "Toggle Typography").
    let legacyItemsDetected = false;
    let legacyItemsWasOurs = false;
    const LEGACY_ITEMS_HEURISTIC_PATTERNS = ['Legibility Status', 'Toggle Typography'];
    let nmCustomizationDraft = cloneMenuCustomization(state.nickelMenuCustomization);

    // --- Feature checkboxes ---
    // Renders one checkbox per available feature from NICKELMENU_FEATURES.
    // Required features are checked and disabled; others use their default.

    function renderFeatureCheckboxes() {
        // A connected device's firmware gates features that declare a
        // minimumVersion. In manual mode the version is unknown, so nothing is
        // gated (meetsMinimumVersion treats an unknown version as meeting it).
        const firmware = state.device?.deviceInfo?.firmware;
        const items = NICKELMENU_FEATURES
            .filter(f => f.available !== false)
            .map(f => {
                const meetsMinimum = meetsMinimumVersion(firmware, f.minimumVersion);
                return {
                    name: 'nm-cfg-' + f.id,
                    title: f.title + (f.required ? ' (required)' : ''),
                    version: f.version,
                    description: f.description,
                    hint: f.hint,
                    sectionTitle: f.section,
                    sectionCollapsed: NM_COLLAPSED_SECTIONS.has(f.section),
                    checked: meetsMinimum && (f.required || f.default),
                    disabled: f.required || !meetsMinimum,
                    disabledReason: meetsMinimum
                        ? undefined
                        : `Requires Kobo software ${f.minimumVersion} or newer (this device runs ${firmware}).`,
                    actionLabel: f.customization?.actionLabel,
                    actionAriaLabel: f.customization?.actionAriaLabel,
                    onAction: f.customization ? openNmCustomizeDialog : undefined,
                    ...(f.customization ? getNmCustomizationSummaryItem() : {}),
                };
            });
        renderNmCheckboxList(nmConfigOptions, items);
    }

    function getNmCustomizationSummaryItem() {
        const summary = getNmCustomizationSummary(state.nickelMenuCustomization);
        return {
            summaryId: 'nm-custom-menu-summary',
            summaryLabel: summary.label,
            summaryIconHtml: summary.iconHtml,
            summaryIconSrc: summary.iconSrc,
        };
    }

    function getNmCustomizationSummary(customization) {
        const icon = customization?.icon;
        const summary = {
            label: normalizeMenuLabel(customization?.label),
            iconHtml: '',
            iconSrc: '',
        };

        if (icon?.type === 'preset') {
            const preset = findPresetIcon(icon.id);
            if (preset) summary.iconHtml = preset.svg;
            return summary;
        }

        if (icon?.type === 'upload' && icon.previewUrl) {
            summary.iconSrc = icon.previewUrl;
            return summary;
        }

        summary.iconSrc = NM_DEFAULT_ICON_ASSET;
        return summary;
    }

    function updateNmFeatureSummary() {
        const container = $('nm-custom-menu-summary');
        if (!container) return;
        const summary = getNmCustomizationSummary(state.nickelMenuCustomization);
        const icon = $q('.nm-config-summary-icon', container);
        const label = $q('.nm-config-summary-label', container);

        if (icon) {
            icon.innerHTML = '';
            if (summary.iconHtml) {
                icon.innerHTML = summary.iconHtml;
            } else if (summary.iconSrc) {
                const img = document.createElement('img');
                img.alt = '';
                img.src = summary.iconSrc;
                icon.appendChild(img);
            }
        }

        if (label) label.textContent = summary.label;
    }

    function cloneMenuCustomization(customization) {
        const fallback = createDefaultMenuCustomization();
        const source = customization || fallback;
        return {
            label: source.label || fallback.label,
            icon: { ...(source.icon || fallback.icon) },
        };
    }

    function renderIconPreview(container, icon) {
        container.innerHTML = '';

        if (icon?.type === 'preset') {
            const preset = findPresetIcon(icon.id);
            if (preset) {
                container.innerHTML = preset.svg;
                return;
            }
        }

        if (icon?.type === 'upload' && icon.previewUrl) {
            const img = document.createElement('img');
            img.alt = '';
            img.src = icon.previewUrl;
            container.appendChild(img);
            return;
        }

        const img = document.createElement('img');
        img.alt = '';
        img.src = NM_DEFAULT_ICON_ASSET;
        container.appendChild(img);
    }

    function renderNmCustomizationPresets() {
        if (nmCustomizePresets.children.length) return;

        for (const icon of NM_MENU_PRESET_ICONS) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'nm-icon-choice';
            button.dataset.iconId = icon.id;
            button.setAttribute('aria-label', `Use ${icon.title} icon`);
            button.title = icon.title;

            const image = document.createElement('span');
            image.className = 'nm-icon-choice-image';
            if (icon.id === 'cog') {
                const img = document.createElement('img');
                img.alt = '';
                img.src = NM_DEFAULT_ICON_ASSET;
                image.appendChild(img);
            } else {
                image.innerHTML = icon.svg;
            }

            const title = document.createElement('span');
            title.className = 'nm-icon-choice-title';
            title.textContent = icon.title;

            button.append(image, title);
            button.addEventListener('click', async () => {
                if (icon.id === 'cog') {
                    nmCustomizationDraft.icon = { type: 'default' };
                    updateNmCustomizationDialog();
                    return;
                }

                try {
                    nmCustomizeStatus.textContent = 'Preparing preset icon...';
                    const data = await renderPresetSvgToPng(icon.svg, NM_PRESET_ICON_PNG_SIZE);
                    nmCustomizationDraft.icon = {
                        type: 'preset',
                        id: icon.id,
                        mimeType: 'image/png',
                        data,
                    };
                    updateNmCustomizationDialog('Preset icon prepared as 48x48 PNG.');
                } catch (err) {
                    nmCustomizeStatus.textContent = err.message;
                }
            });
            nmCustomizePresets.appendChild(button);
        }
    }

    function updateNmCustomizationDialog(message = '') {
        const label = sanitizeMenuLabel(nmCustomizeLabel.value);
        if (label !== nmCustomizeLabel.value) {
            nmCustomizeLabel.value = label;
        }

        nmCustomizationDraft.label = label;
        nmCustomizeCounter.textContent = `${label.length}/${NM_MENU_LABEL_MAX_LENGTH}`;

        for (const button of $qa('.nm-icon-choice', nmCustomizePresets)) {
            button.classList.toggle(
                'nm-icon-choice--selected',
                (nmCustomizationDraft.icon?.type === 'preset' && button.dataset.iconId === nmCustomizationDraft.icon.id)
                    || (nmCustomizationDraft.icon?.type === 'default' && button.dataset.iconId === 'cog')
            );
        }

        const hasUpload = nmCustomizationDraft.icon?.type === 'upload';
        nmCustomizeUploadPreview.classList.toggle('nm-upload-preview--selected', hasUpload);
        if (hasUpload) {
            renderIconPreview(nmCustomizeUploadPreview, nmCustomizationDraft.icon);
            nmCustomizeUploadName.textContent = nmCustomizationDraft.icon.name || 'Uploaded image';
        } else {
            nmCustomizeUploadPreview.innerHTML = '';
            nmCustomizeUploadName.textContent = 'No uploaded image selected';
        }

        const valid = isValidMenuLabel(label);
        btnNmCustomizeSave.disabled = !valid;
        nmCustomizeStatus.textContent = valid
            ? message
            : `Use 1-${NM_MENU_LABEL_MAX_LENGTH} letters or numbers.`;
    }

    function openNmCustomizeDialog() {
        renderNmCustomizationPresets();
        nmCustomizationDraft = cloneMenuCustomization(state.nickelMenuCustomization);
        nmCustomizeLabel.value = sanitizeMenuLabel(nmCustomizationDraft.label);
        updateNmCustomizationDialog();
        nmCustomizeDialog.showModal();
        nmCustomizeLabel.focus();
        nmCustomizeLabel.select();
    }

    function closeNmCustomizeDialog() {
        nmCustomizeDialog.close();
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new window.Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Could not read that image.'));
            img.src = src;
        });
    }

    async function resizeRasterUpload(file) {
        const sourceUrl = URL.createObjectURL(file);
        try {
            const img = await loadImage(sourceUrl);
            const canvas = document.createElement('canvas');
            canvas.width = NM_UPLOAD_ICON_SIZE;
            canvas.height = NM_UPLOAD_ICON_SIZE;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, NM_UPLOAD_ICON_SIZE, NM_UPLOAD_ICON_SIZE);
            const scale = Math.min(NM_UPLOAD_ICON_SIZE / img.naturalWidth, NM_UPLOAD_ICON_SIZE / img.naturalHeight);
            const width = Math.round(img.naturalWidth * scale);
            const height = Math.round(img.naturalHeight * scale);
            const x = Math.floor((NM_UPLOAD_ICON_SIZE - width) / 2);
            const y = Math.floor((NM_UPLOAD_ICON_SIZE - height) / 2);
            ctx.drawImage(img, x, y, width, height);

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('Could not resize that image.');
            return {
                data: new Uint8Array(await blob.arrayBuffer()),
                mimeType: 'image/png',
                previewUrl: URL.createObjectURL(blob),
            };
        } finally {
            URL.revokeObjectURL(sourceUrl);
        }
    }

    async function resizeSvgUpload(file) {
        const svgText = await file.text();
        const doc = new window.DOMParser().parseFromString(svgText, 'image/svg+xml');
        const svg = doc.documentElement;

        if (doc.querySelector('parsererror') || svg?.localName?.toLowerCase() !== 'svg') {
            throw new Error('Choose a valid SVG file.');
        }

        const viewBox = svg.getAttribute('viewBox') || inferSvgViewBox(svg);
        svg.setAttribute('xmlns', svg.getAttribute('xmlns') || 'http://www.w3.org/2000/svg');
        svg.setAttribute('width', String(NM_UPLOAD_ICON_SIZE));
        svg.setAttribute('height', String(NM_UPLOAD_ICON_SIZE));
        svg.setAttribute('viewBox', viewBox);

        const data = new TextEncoder().encode(new window.XMLSerializer().serializeToString(svg));
        const blob = new Blob([data], { type: 'image/svg+xml' });
        return {
            data,
            mimeType: 'image/svg+xml',
            previewUrl: URL.createObjectURL(blob),
        };
    }

    function inferSvgViewBox(svg) {
        const width = parseSvgDimension(svg.getAttribute('width')) || NM_UPLOAD_ICON_SIZE;
        const height = parseSvgDimension(svg.getAttribute('height')) || NM_UPLOAD_ICON_SIZE;
        return `0 0 ${width} ${height}`;
    }

    function parseSvgDimension(value) {
        const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)/);
        return match ? Number(match[1]) : null;
    }

    async function renderPresetSvgToPng(svg, size) {
        const sourceUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        try {
            const img = await loadImage(sourceUrl);
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(img, 0, 0, size, size);

            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('Could not prepare that preset icon.');
            return new Uint8Array(await blob.arrayBuffer());
        } finally {
            URL.revokeObjectURL(sourceUrl);
        }
    }

    async function handleNmIconUpload(file) {
        if (!file) return;
        const lowerName = file.name.toLowerCase();
        const isSvg = file.type === 'image/svg+xml' || lowerName.endsWith('.svg');
        const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name);

        try {
            if (isSvg) {
                const resized = await resizeSvgUpload(file);
                nmCustomizationDraft.icon = {
                    type: 'upload',
                    name: file.name,
                    ...resized,
                };
                updateNmCustomizationDialog('SVG resized to 64x64.');
                return;
            }

            if (!isImage) {
                throw new Error('Choose an SVG, PNG, JPEG, WebP, or GIF image.');
            }

            const resized = await resizeRasterUpload(file);
            nmCustomizationDraft.icon = {
                type: 'upload',
                name: file.name,
                ...resized,
            };
            updateNmCustomizationDialog('Image resized to 64x64 PNG.');
        } catch (err) {
            nmCustomizeStatus.textContent = err.message;
        } finally {
            nmCustomizeUpload.value = '';
        }
    }

    // --- Uninstall checkboxes ---
    // When removing NickelMenu, shows checkboxes for any detected extras
    // (like KOReader) so the user can opt into cleaning those up too.

    function renderCleanupCheckboxes() {
        if (detectedOptionalCleanupFeatures.length === 0) {
            nmUninstallOptions.innerHTML = '';
            return;
        }
        const items = detectedOptionalCleanupFeatures.map(f => ({
            name: 'nm-uninstall-' + f.id,
            // Each feature declares how its own removal is phrased.
            title: f.cleanup.removeLabel ?? ('Remove ' + f.cleanup.title),
            description: f.cleanup.description,
            checked: true,
        }));
        renderNmCheckboxList(nmUninstallOptions, items);
    }

    /** Clear removal state when returning to mode selection. */
    function resetNickelMenuState() {
        detectedOptionalCleanupFeatures = [];
        detectedPresetConflicts = [];
        legacyItemsDetected = false;
        legacyItemsWasOurs = false;
        state.koboUserCount = undefined;
        $('nm-sideloaded-banner').hidden = true;
        nmUninstallOptions.hidden = true;
        nmUninstallOptions.innerHTML = '';
        nmPresetConflictList.innerHTML = '';
        nmPresetConflictAck.checked = false;
        btnNmPresetConflictNext.disabled = true;
        nmBackupChoice = null;
        state.nickelMenuCustomization = createDefaultMenuCustomization();
        nmCustomizationDraft = cloneMenuCustomization(state.nickelMenuCustomization);
        updateNmFeatureSummary();
        btnNmBackupNext.disabled = true;
        btnNmBackupNext.textContent = 'Continue ›';
        btnNmBackupBack.disabled = false;
        for (const radio of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
            radio.checked = false;
            radio.closest('.selection-card')?.classList.remove('selection-card--selected');
            radio.disabled = false;
        }
    }

    /** Return only the optional cleanup features whose checkboxes are checked. */
    function getSelectedOptionalCleanupFeatures() {
        return detectedOptionalCleanupFeatures.filter(f => {
            const cb = $q(`input[name="nm-uninstall-${f.id}"]`);
            return cb && cb.checked;
        });
    }

    /** Detected optional features the user chose NOT to remove (kept on device). */
    function getKeptOptionalCleanupFeatures() {
        return detectedOptionalCleanupFeatures.filter(f => {
            const cb = $q(`input[name="nm-uninstall-${f.id}"]`);
            return cb && !cb.checked;
        });
    }

    function getAlwaysCleanupFeatures() {
        return NICKELMENU_FEATURES.filter(f => f.cleanup?.mode === 'always');
    }

    /**
     * Whether an optional cleanup feature is present on the connected device,
     * detected by its files (cleanup.detect) or by a Kobo eReader.conf setting it
     * applied — its revertable confSettings, matched against the already-read conf
     * content.
     */
    async function isOptionalCleanupPresent(feature, conf) {
        for (const detectPath of feature.cleanup.detect || []) {
            if (await state.device.pathExists(detectPath)) return true;
        }
        const ctx = { deviceInfo: state.device?.deviceInfo, features: [] };
        for (const { section, key, value } of revertableConfSettings(feature, ctx)) {
            if (getConfSetting(conf, section, key) === value) return true;
        }
        return false;
    }

    async function hasAddsDirectoriesRequiringSyncExclusionsOnDevice() {
        const entries = await state.device.listDirectory(['.adds']);
        return hasAddsDirectoriesRequiringSyncExclusions(entries);
    }

    /** Return all features the user has selected for installation. */
    function getSelectedFeatures() {
        const firmware = state.device?.deviceInfo?.firmware;
        return NICKELMENU_FEATURES.filter(f => {
            if (f.available === false) return false;
            // Never install a feature the device's Kobo software is too old for,
            // even if it is otherwise required/default.
            if (!meetsMinimumVersion(firmware, f.minimumVersion)) return false;
            if (f.required) return true;
            const checkbox = $q(`input[name="nm-cfg-${f.id}"]`);
            return checkbox && checkbox.checked;
        });
    }

    /**
     * Collect review notices for the given features. A feature declares
     * `reviewNotices` as a `(ctx)` function returning its notices, resolved
     * against device context so it can adapt to the connected Kobo (e.g.
     * custom-menu's Dark Mode warning only applies to older hardware).
     */
    function getFeatureReviewNotices(features) {
        const ctx = { deviceInfo: state.device.deviceInfo };
        return features.flatMap(feature =>
            feature.reviewNotices ? feature.reviewNotices(ctx) : []
        );
    }

    /**
     * Collect declarative Kobo eReader.conf settings from the selected features.
     * The installer applies these directly on a connected device; in manual
     * download mode they are surfaced as copy-paste instructions instead.
     */
    function getFeatureConfSettings(features) {
        const ctx = { deviceInfo: state.device.deviceInfo ?? null, features };
        return features.flatMap(feature =>
            feature.confSettings ? feature.confSettings(ctx) : []
        );
    }

    /** Render feature conf settings as per-section copy-paste lines. */
    function renderDownloadConfSettings(container, settings) {
        container.innerHTML = '';

        // Group settings by conf section, preserving first-seen order.
        const sections = new Map();
        for (const { section, key, value } of settings) {
            if (!sections.has(section)) sections.set(section, []);
            sections.get(section).push(`${key}=${value}`);
        }

        for (const [section, lines] of sections) {
            const intro = document.createElement('p');
            const sectionCode = document.createElement('code');
            sectionCode.textContent = `[${section}]`;
            intro.append('In the ', sectionCode, ' section (add it if it is missing):');
            container.appendChild(intro);

            for (const line of lines) {
                const lineCode = document.createElement('code');
                lineCode.textContent = line;
                container.append(lineCode, document.createElement('br'));
            }
        }
    }

    function renderReviewNotices(container, notices) {
        container.innerHTML = '';
        container.hidden = notices.length === 0;

        for (const notice of notices) {
            const banner = document.createElement('div');
            banner.className = `banner banner--${notice.type || 'info'}`;

            if (notice.title) {
                const heading = document.createElement('div');
                heading.className = 'banner-heading';
                heading.textContent = notice.title;
                banner.appendChild(heading);
            }

            for (const paragraphText of notice.paragraphs || []) {
                const paragraph = document.createElement('p');
                paragraph.textContent = paragraphText;
                banner.appendChild(paragraph);
            }

            if (notice.link) {
                const paragraph = document.createElement('p');
                const link = document.createElement('a');
                link.href = notice.link.href;
                link.target = '_blank';
                link.rel = 'noopener';
                link.textContent = notice.link.label;
                paragraph.append('See ', link, ' for details.');
                banner.appendChild(paragraph);
            }

            container.appendChild(banner);
        }
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
            : 'Manual mode cannot create a backup for you, but it is worth making a backup of some important device files first.';
        nmBackupOptions.hidden = !canCreateBackup;
        nmBackupLocalNote.hidden = !canCreateBackup;
        nmManualBackupInstructions.hidden = canCreateBackup;
        setNavStep(4);

        // Show the "keep legacy config" checkbox when a legacy items file exists
        // and the user is about to install a preset (which writes a new config).
        const keepConfigOption = $('nm-keep-config-option');
        const keepConfigCheckbox = $('nm-keep-items');
        const keepConfigTitle = $('nm-keep-config-title');
        const keepConfigDesc = $('nm-keep-config-desc');
        if (legacyItemsDetected && state.nickelMenuOption === 'preset') {
            keepConfigCheckbox.checked = legacyItemsWasOurs ? false : true;
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
    // Probes the connected device for a NickelMenu config file (either the legacy
    // .adds/nm/items or the current .adds/nm/webui-preset) to determine if
    // NickelMenu is currently installed. Enables or disables the "Remove" radio
    // option accordingly. Also scans for removable extras (e.g. KOReader).

    async function checkNickelMenuInstalled() {
        const removeOption = $('nm-option-remove');
        const removeRadio = $q('input[value="remove"]', removeOption);
        const removeDesc = $('nm-remove-desc');

        if (state.manualMode) {
            removeRadio.disabled = false;
            removeOption.classList.remove('selection-card--disabled');
            removeOption.classList.remove('selection-card--danger');
            removeDesc.textContent = TL.STATUS.NM_REMOVAL_MANUAL_HINT;
            return;
        }

        removeOption.classList.add('selection-card--danger');
        if (state.device.directoryHandle) {
            try {
                const addsDir = await state.device.directoryHandle.getDirectoryHandle('.adds');
                const nmDir = await addsDir.getDirectoryHandle('nm');
                // Check for either the legacy items or the new webui-preset file.
                try {
                    await nmDir.getFileHandle('items');
                } catch {
                    await nmDir.getFileHandle('webui-preset');
                }
                // NickelMenu is installed — enable removal option.
                removeRadio.disabled = false;
                removeOption.classList.remove('selection-card--disabled');
                removeDesc.textContent = TL.STATUS.NM_REMOVAL_HINT;

                // Scan for removable extras (only once per session). A feature is
                // detectable by file paths (cleanup.detect) and/or by the Kobo
                // eReader.conf settings it applied (its revertable confSettings).
                if (detectedOptionalCleanupFeatures.length === 0) {
                    const conf = await state.device.readFile(['.kobo', 'Kobo', 'Kobo eReader.conf']) || '';
                    for (const feature of NICKELMENU_FEATURES) {
                        if (feature.cleanup?.mode !== 'optional') continue;
                        if (await isOptionalCleanupPresent(feature, conf)) {
                            detectedOptionalCleanupFeatures.push(feature);
                        }
                    }
                    renderCleanupCheckboxes();
                }

                // Check if the old `items` config was generated by a previous
                // version of this tool (so we can offer to keep or replace it).
                await detectLegacyItemsFile(nmDir, addsDir);
                return;
            } catch {
                // .adds/nm not found — NickelMenu is not installed.
            }
        }

        // NickelMenu not found — disable removal.
        removeRadio.disabled = true;
        removeOption.classList.add('selection-card--disabled');
        removeOption.classList.add('selection-card--danger');
        removeDesc.textContent = TL.STATUS.NM_REMOVAL_DISABLED;
        if (removeRadio.checked) {
            const presetRadio = $q('input[value="preset"]', stepNickelMenu);
            presetRadio.checked = true;
            presetRadio.dispatchEvent(new Event('change'));
        }
    }

    /** Detect whether a legacy `.adds/nm/items` exists and whether it was generated by this tool. */
    async function detectLegacyItemsFile(nmDir) {
        try {
            const legacyFile = await nmDir.getFileHandle('items');
            const file = await legacyFile.getFile();
            const text = await file.text();
            legacyItemsDetected = true;
            legacyItemsWasOurs = LEGACY_ITEMS_HEURISTIC_PATTERNS.some(p => text.includes(p));
        } catch {
            legacyItemsDetected = false;
            legacyItemsWasOurs = false;
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

    function updateNmNavLabelsForOption(option) {
        if (option === 'remove' && state.manualMode) {
            setNavLabels(TL.NAV_NICKELMENU_MANUAL_REMOVE);
        } else if (option === 'remove') {
            setNavLabels(TL.NAV_NICKELMENU_REMOVE);
        } else {
            setNavLabels(TL.NAV_NICKELMENU);
        }
        setNavStep(3);
    }

    // --- Step: NM config ---
    // Radio buttons for the three NM options: preset, nickelmenu-only, remove.
    // Toggling "remove" shows/hides the uninstall checkboxes.

    for (const radio of $qa('input[name="nm-option"]', stepNickelMenu)) {
        radio.addEventListener('change', () => {
            nmUninstallOptions.hidden = radio.value !== 'remove' || !radio.checked || detectedOptionalCleanupFeatures.length === 0;
            updateNmNavLabelsForOption(radio.value);
            btnNmNext.disabled = false;
        });
    }

    /** Entry point into the NickelMenu flow. Probes the device, then shows the config step. */
    async function goToNickelMenuConfig() {
        await checkNickelMenuInstalled();

        // Default to "Install with preset" so it is preselected, but only when the
        // user hasn't already chosen an option (so back-navigation keeps their
        // choice). Dispatching change reuses the card-selected styling and the
        // option's own handler (nav labels, enabling Continue).
        if (!$q('input[name="nm-option"]:checked', stepNickelMenu)) {
            const presetRadio = $q('input[name="nm-option"][value="preset"]', stepNickelMenu);
            presetRadio.checked = true;
            presetRadio.dispatchEvent(new Event('change'));
        }

        const currentOption = $q('input[name="nm-option"]:checked', stepNickelMenu);
        nmUninstallOptions.hidden = !currentOption || currentOption.value !== 'remove' || detectedOptionalCleanupFeatures.length === 0;
        btnNmNext.disabled = !currentOption;
        updateNmNavLabelsForOption(currentOption?.value);
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

        if (state.nickelMenuOption === 'remove' && state.manualMode) {
            setNavLabels(TL.NAV_NICKELMENU_MANUAL_REMOVE);
            setNavStep(4);
            showStep(stepNmManualRemove);
            track('flow-end', { result: 'nm-remove-manual' });
            return;
        }

        // "preset" goes to feature selection; other options skip to review.
        if (state.nickelMenuOption === 'preset') {
            if (await maybeShowPresetConflictStep()) {
                return;
            }
            await goToNmFeatures();
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

    btnNmPresetConflictNext.addEventListener('click', async () => {
        if (!nmPresetConflictAck.checked) return;
        await goToNmFeatures();
    });

    // --- Step: Features ---
    // Checkboxes are rendered lazily on first visit, then preserved
    // so selections survive back-navigation.

    async function goToNmFeatures() {
        if (!nmConfigOptions.children.length) {
            renderFeatureCheckboxes();
        }
        setNavStep(3);
        showStep(stepNmFeatures);
        // The Sideload-mode hint depends on a (now range-read, but still I/O)
        // KoboReader.sqlite lookup. Fire it after the step is shown so it never
        // blocks navigation; updateSideloadedRecommendation does its own DOM
        // updates when the count resolves. Best-effort — a failure just leaves
        // the hint hidden.
        updateSideloadedRecommendation().catch(() => {});
    }

    // Cached user-row count for the connected device (undefined = not checked
    // yet, null = couldn't be read). A factory-reset Kobo that was never signed
    // in reads 0, which is when we recommend Sideload Mode.
    async function getKoboUserCount() {
        if (state.koboUserCount !== undefined) return state.koboUserCount;
        if (state.manualMode || !state.device?.directoryHandle) {
            state.koboUserCount = null;
        } else {
            state.koboUserCount = await countKoboUsers(state.device);
        }
        return state.koboUserCount;
    }

    // Show the "not signed in → enable Sideload Mode" banner when the device
    // reads zero user rows, but only if Sideload Mode is actually available on
    // this firmware. When shown, expand the Advanced section so the option the
    // banner points at is visible.
    async function updateSideloadedRecommendation() {
        const banner = $('nm-sideloaded-banner');
        const firmware = state.device?.deviceInfo?.firmware;
        const sideloaded = NICKELMENU_FEATURES.find(f => f.id === 'sideloaded-mode');
        if (!meetsMinimumVersion(firmware, sideloaded?.minimumVersion)) {
            banner.hidden = true;
            return;
        }

        const userCount = await getKoboUserCount();
        banner.hidden = userCount !== 0;

        if (userCount === 0) {
            for (const section of $qa('.nm-config-section', nmConfigOptions)) {
                const title = $q('.nm-config-section-title', section);
                if (title && title.textContent === sideloaded.section) section.open = true;
            }
        }
    }

    btnNmFeaturesBack.addEventListener('click', async () => {
        await goToNickelMenuConfig();
    });

    btnNmFeaturesNext.addEventListener('click', async () => {
        await showNmBackupStep();
    });

    nmCustomizeLabel.addEventListener('input', () => updateNmCustomizationDialog());
    nmCustomizeUpload.addEventListener('change', () => handleNmIconUpload(nmCustomizeUpload.files?.[0]));
    btnNmCustomizeClose.addEventListener('click', closeNmCustomizeDialog);
    btnNmCustomizeCancel.addEventListener('click', closeNmCustomizeDialog);
    btnNmCustomizeReset.addEventListener('click', () => {
        nmCustomizationDraft = createDefaultMenuCustomization();
        nmCustomizeLabel.value = NM_MENU_DEFAULT_LABEL;
        updateNmCustomizationDialog(isDefaultMenuCustomization(state.nickelMenuCustomization) ? '' : 'Defaults restored.');
    });
    btnNmCustomizeSave.addEventListener('click', () => {
        const label = sanitizeMenuLabel(nmCustomizeLabel.value).trim();
        if (!isValidMenuLabel(label)) {
            updateNmCustomizationDialog();
            return;
        }

        state.nickelMenuCustomization = {
            ...nmCustomizationDraft,
            label,
        };
        updateNmFeatureSummary();
        closeNmCustomizeDialog();
    });

    for (const radio of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
        radio.addEventListener('change', () => {
            nmBackupChoice = radio.value;
            btnNmBackupNext.disabled = false;
            for (const other of $qa('input[name="nm-backup-option"]', stepNmBackup)) {
                other.closest('.selection-card')?.classList.toggle('selection-card--selected', other.checked);
            }
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
        // The summary card holds an optional descriptive paragraph, a bold label
        // introducing the list, then the list of items that will be applied.
        const summary = $('nm-review-summary');
        const listLabel = $('nm-review-list-label');
        const list = $('nm-review-list');
        const keptCard = $('nm-review-kept');
        const keptLabel = $('nm-review-kept-label');
        const keptList = $('nm-review-kept-list');
        const reviewNotices = $('nm-review-notices');

        // Removal is destructive, so colour the action button and list markers red.
        $('step-nm-review').classList.toggle('review--removal', state.nickelMenuOption === 'remove');

        if (state.nickelMenuOption === 'remove') {
            // Describe what removal does, then label the list — NickelMenu plus
            // any optional features the user also chose to uninstall.
            summary.textContent = TL.STATUS.NM_WILL_BE_REMOVED;
            summary.hidden = false;
            listLabel.textContent = TL.STATUS.NM_SELECTED_REMOVALS;
            const optionalCleanupFeatures = getSelectedOptionalCleanupFeatures();
            populateList(list, [
                TL.STATUS.NM_REMOVAL_NICKELMENU,
                ...optionalCleanupFeatures.map(f => f.cleanup.title),
            ]);
            // Surface any detected optional features the user chose to keep in a
            // separate card, so it's clear they won't be touched.
            const keptFeatures = getKeptOptionalCleanupFeatures();
            populateList(keptList, keptFeatures.map(f => f.cleanup.title));
            keptLabel.textContent = TL.STATUS.NM_KEPT_FEATURES;
            keptCard.hidden = keptFeatures.length === 0;
            btnNmWrite.hidden = state.manualMode;
            btnNmWrite.textContent = TL.BUTTON.REMOVE_FROM_KOBO;
            btnNmDownload.hidden = true;
            renderReviewNotices(reviewNotices, []);
        } else {
            // "nickelmenu-only" or "preset" — both install NickelMenu. The label
            // doubles as the description here, so no separate paragraph is shown.
            summary.hidden = true;
            summary.textContent = '';
            keptCard.hidden = true;
            listLabel.textContent = TL.STATUS.NM_WILL_BE_INSTALLED;
            const items = [TL.STATUS.NM_NICKEL_ROOT_TGZ];
            let features = [];
            if (state.nickelMenuOption === 'preset') {
                features = getSelectedFeatures();
                for (const feature of features) {
                    items.push(feature.title);
                }
            }
            populateList(list, items);
            btnNmWrite.hidden = false;
            btnNmWrite.textContent = TL.BUTTON.WRITE_TO_KOBO;
            btnNmDownload.hidden = false;
            renderReviewNotices(reviewNotices, getFeatureReviewNotices(features));
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
                await executeNickelMenuRemoval({
                    device: state.device,
                    installer: state.nmInstaller,
                    cleanupFeatures: [
                        ...getAlwaysCleanupFeatures(),
                        ...getSelectedOptionalCleanupFeatures(),
                    ],
                    shouldRemoveSyncExclusions: async () => !await hasAddsDirectoriesRequiringSyncExclusionsOnDevice(),
                    onProgress: progressFn,
                    audit: new AuditLog('remove-nickelmenu', new Date(), state.device),
                });
                showNmDone('remove');
                return;
            }

            // Install flow: either write directly to device or build a ZIP for download.
            const features = state.nickelMenuOption === 'preset' ? getSelectedFeatures() : [];
            // Addon/feature installs: fire only when actually part of the
            // install, so each event counts a real install.
            if (features.some(f => f.id === 'koreader')) track('add-koreader');
            if (features.some(f => f.id === 'nickelclock')) track('add-nickelclock');
            if (features.some(f => f.id === 'cadmus')) track('add-cadmus');
            if (features.some(f => f.id === 'additional-fonts')) track('add-fonts');
            if (features.some(f => f.id === 'screensaver')) track('add-screensaver');
            if (features.some(f => ['hide-recommendations', 'hide-row2col2', 'hide-notices'].includes(f.id))) track('add-minimal-home');
            if (features.some(f => f.id === 'simplify-tabs')) track('add-basic-tabs');
            if (features.some(f => f.id === 'sideloaded-mode')) track('add-sideloaded-mode');

            if (writeToDevice && state.device.directoryHandle) {
                // If a legacy `.adds/nm/items` exists and the user chose not to
                // keep it, remove it before writing the new config file.
                if (legacyItemsDetected && state.nickelMenuOption === 'preset') {
                    const keepConfig = $('nm-keep-items').checked;
                    if (!keepConfig) {
                        try {
                            await state.device.removeEntry(NM_LEGACY_ITEMS_FILE.split('/'));
                        } catch {
                            // best-effort — a removal failure shouldn't abort the install
                        }
                    }
                }
                // Best-effort: clean up the old toggle_typography.sh from .adds/scripts/
                // that previous versions always installed. All toggle scripts now live
                // under .adds/nm/scripts/ regardless of selected features.
                try {
                    const legacyScriptPath = ['.adds', 'scripts', 'toggle_typography.sh'];
                    if (await state.device.pathExists(legacyScriptPath)) {
                        await state.device.removeEntry(legacyScriptPath);
                    }
                } catch {
                    // best-effort
                }
                await state.nmInstaller.installToDevice(state.device, features, progressFn, {
                    audit: new AuditLog('install-nickelmenu', new Date(), state.device),
                    menuCustomization: state.nickelMenuCustomization,
                });
                showNmDone('written');
            } else {
                state.resultNmZip = await state.nmInstaller.buildDownloadZip(features, progressFn, state.device.deviceInfo, {
                    menuCustomization: state.nickelMenuCustomization,
                    isPreset: state.nickelMenuOption === 'preset',
                });
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
            $('nm-download-conf-line').textContent = getExcludeSyncFoldersLine(features);
            $('nm-download-conf-desc').textContent = hasExcludeCalibre
                ? CONF_DESC_EXCLUDE_CALIBRE
                : CONF_DESC_DEFAULT;
            // Feature-declared conf settings (e.g. better-typography) can't be
            // written to a device in manual mode, so show them as instructions.
            const confSettings = getFeatureConfSettings(features);
            renderDownloadConfSettings($('nm-download-conf-settings'), confSettings);
            $('nm-download-conf-settings-step').hidden = confSettings.length === 0;
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
