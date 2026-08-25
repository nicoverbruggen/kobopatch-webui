/**
 * customization-dialog.js — The "Customize NickelMenu preset" dialog.
 *
 * Lets the user pick/upload an icon and edit the label for the Toggle tab, and
 * renders the live preview + summary. Pure image helpers (SVG sizing, raster
 * resizing, PNG rendering) live here alongside the dialog wiring.
 */

import { $, trapFocus } from '../shell/dom.js';
import {
    findPresetIcon,
    NM_MENU_PRESET_ICONS,
    createDefaultMenuCustomization,
    isValidMenuLabel,
    normalizeMenuLabel,
    sanitizeMenuLabel,
    NM_MENU_LABEL_MAX_LENGTH,
} from './customization.js';
import { CUSTOM_MENU_ICON_URL } from './features/custom-menu/index.js';

const NM_DEFAULT_ICON_ASSET = CUSTOM_MENU_ICON_URL;
const NM_PRESET_ICON_PNG_SIZE = 48;
const NM_UPLOAD_ICON_SIZE = 64;

export function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new window.Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not read that image.'));
        img.src = src;
    });
}

function parseSvgDimension(value) {
    const match = String(value || '')
        .trim()
        .match(/^(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : null;
}

function inferSvgViewBox(svg) {
    const width = parseSvgDimension(svg.getAttribute('width')) || NM_UPLOAD_ICON_SIZE;
    const height = parseSvgDimension(svg.getAttribute('height')) || NM_UPLOAD_ICON_SIZE;
    return `0 0 ${width} ${height}`;
}

export async function resizeRasterUpload(file) {
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

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
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

export async function resizeSvgUpload(file) {
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

export async function renderPresetSvgToPng(svg, size = NM_PRESET_ICON_PNG_SIZE) {
    const sourceUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
        const img = await loadImage(sourceUrl);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Could not prepare that preset icon.');
        return new Uint8Array(await blob.arrayBuffer());
    } finally {
        URL.revokeObjectURL(sourceUrl);
    }
}

export async function handleNmIconUpload(file, customizationDraft, updateDialog, shouldApply = () => true) {
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    const isSvg = file.type === 'image/svg+xml' || lowerName.endsWith('.svg');
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name);

    try {
        if (isSvg) {
            const resized = await resizeSvgUpload(file);
            if (!shouldApply()) return;
            customizationDraft.icon = {
                type: 'upload',
                name: file.name,
                ...resized,
            };
            updateDialog('SVG resized to 64x64.');
            return;
        }

        if (!isImage) {
            throw new Error('Choose an SVG, PNG, JPEG, WebP, or GIF image.');
        }

        const resized = await resizeRasterUpload(file);
        if (!shouldApply()) return;
        customizationDraft.icon = {
            type: 'upload',
            name: file.name,
            ...resized,
        };
        updateDialog('Image resized to 64x64 PNG.');
    } catch (err) {
        if (!shouldApply()) return;
        updateDialog(err.message);
    }
}

export function renderIconPreview(container, icon) {
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

function getGridColumns(grid) {
    if (grid.children.length < 2) return 1;
    const firstRect = grid.children[0].getBoundingClientRect();
    const secondRect = grid.children[1].getBoundingClientRect();
    return secondRect.top > firstRect.top ? 1 : grid.children.length;
}

function getGridIndex(grid, el) {
    return Array.prototype.indexOf.call(grid.children, el);
}

export function renderNmCustomizationPresets(container, onSelect) {
    container._onSelect = onSelect;
    if (container.children.length) return;

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
            await container._onSelect?.(icon);
        });
        container.appendChild(button);
    }

    const total = container.children.length;

    container.addEventListener('keydown', (e) => {
        const cols = getGridColumns(container);
        const idx = getGridIndex(container, document.activeElement);
        if (idx === -1) return;

        let target;
        switch (e.key) {
            case 'ArrowRight':
                target = Math.min(idx + 1, total - 1);
                break;
            case 'ArrowLeft':
                target = Math.max(idx - 1, 0);
                break;
            case 'ArrowDown':
                target = Math.min(idx + cols, total - 1);
                break;
            case 'ArrowUp':
                target = Math.max(idx - cols, 0);
                break;
            case 'Home':
                target = 0;
                break;
            case 'End':
                target = total - 1;
                break;
            default:
                return;
        }

        e.preventDefault();
        container.children[target].focus();
    });
}

export function cloneMenuCustomization(customization) {
    const fallback = createDefaultMenuCustomization();
    const source = customization || fallback;
    return {
        label: source.label || fallback.label,
        icon: { ...(source.icon || fallback.icon) },
    };
}

export function getMenuCustomizationSummary(customization) {
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

export function getMenuCustomizationSummaryItem(state) {
    const summary = getMenuCustomizationSummary(state.nickelMenuCustomization);
    return {
        summaryId: 'nm-custom-menu-summary',
        summaryLabel: summary.label,
        summaryIconHtml: summary.iconHtml,
        summaryIconSrc: summary.iconSrc,
    };
}

export function updateMenuCustomizationSummary(state) {
    const container = $('nm-custom-menu-summary');
    if (!container) return;
    const summary = getMenuCustomizationSummary(state.nickelMenuCustomization);
    const icon = container.querySelector('.nm-config-summary-icon');
    const label = container.querySelector('.nm-config-summary-label');

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

export function updateMenuCustomizationDialog(draft, dialogDom, message = '') {
    const label = sanitizeMenuLabel(dialogDom.labelInput.value);
    if (label !== dialogDom.labelInput.value) {
        dialogDom.labelInput.value = label;
    }

    draft.label = label;
    dialogDom.counter.textContent = `${label.length}/${NM_MENU_LABEL_MAX_LENGTH}`;

    for (const button of dialogDom.presets.querySelectorAll('.nm-icon-choice')) {
        button.classList.toggle(
            'nm-icon-choice--selected',
            (draft.icon?.type === 'preset' && button.dataset.iconId === draft.icon.id) || (draft.icon?.type === 'default' && button.dataset.iconId === 'cog'),
        );
    }

    const hasUpload = draft.icon?.type === 'upload';
    dialogDom.uploadPreview.classList.toggle('nm-upload-preview--selected', hasUpload);
    if (hasUpload) {
        renderIconPreview(dialogDom.uploadPreview, draft.icon);
        dialogDom.uploadName.textContent = draft.icon.name || 'Uploaded image';
    } else {
        dialogDom.uploadPreview.innerHTML = '';
        dialogDom.uploadName.textContent = 'No uploaded image selected';
    }

    const valid = isValidMenuLabel(label);
    dialogDom.save.disabled = !valid;
    dialogDom.status.textContent = valid ? message : `Use 1-${NM_MENU_LABEL_MAX_LENGTH} letters or numbers.`;
}

export function openMenuCustomizeDialog(state, dialogDom, shouldApply = () => true) {
    const draft = cloneMenuCustomization(state.nickelMenuCustomization);
    const session = Symbol('menu-customization-session');
    dialogDom._menuCustomizationSession = session;
    const isCurrent = () => dialogDom._menuCustomizationSession === session && shouldApply();

    renderNmCustomizationPresets(dialogDom.presets, async (icon) => {
        if (icon.id === 'cog') {
            draft.icon = { type: 'default' };
            updateMenuCustomizationDialog(draft, dialogDom);
            return;
        }

        try {
            dialogDom.status.textContent = 'Preparing preset icon...';
            const data = await renderPresetSvgToPng(icon.svg);
            if (!isCurrent()) return;
            draft.icon = {
                type: 'preset',
                id: icon.id,
                mimeType: 'image/png',
                data,
            };
            updateMenuCustomizationDialog(draft, dialogDom, 'Preset icon prepared as 48x48 PNG.');
        } catch (err) {
            if (!isCurrent()) return;
            dialogDom.status.textContent = err.message;
        }
    });

    dialogDom.labelInput.value = sanitizeMenuLabel(draft.label);
    updateMenuCustomizationDialog(draft, dialogDom);
    dialogDom.dialog.showModal();
    dialogDom.labelInput.focus();
    dialogDom.labelInput.select();
    return draft;
}

// Trap Tab inside the dialog once the DOM is ready. Returning focus to whatever
// opened it needs no code: the browser restores it when a modal <dialog> closes.
function wireDialog() {
    const dlg = $('nm-customize-dialog');
    if (dlg) trapFocus(dlg);
}

document.addEventListener('DOMContentLoaded', wireDialog, { once: true });
if (document.readyState !== 'loading') wireDialog();
