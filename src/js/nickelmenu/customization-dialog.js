import {
    findPresetIcon,
    NM_MENU_PRESET_ICONS,
} from './customization.js';

const NM_DEFAULT_ICON_ASSET = 'js/nickelmenu/features/custom-menu/.cog.png';
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

export function parseSvgDimension(value) {
    const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : null;
}

export function inferSvgViewBox(svg) {
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

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('Could not prepare that preset icon.');
        return new Uint8Array(await blob.arrayBuffer());
    } finally {
        URL.revokeObjectURL(sourceUrl);
    }
}

export async function handleNmIconUpload(file, customizationDraft, updateDialog) {
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    const isSvg = file.type === 'image/svg+xml' || lowerName.endsWith('.svg');
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name);

    try {
        if (isSvg) {
            const resized = await resizeSvgUpload(file);
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
        customizationDraft.icon = {
            type: 'upload',
            name: file.name,
            ...resized,
        };
        updateDialog('Image resized to 64x64 PNG.');
    } catch (err) {
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

export function renderNmCustomizationPresets(container, onSelect) {
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
            await onSelect(icon);
        });
        container.appendChild(button);
    }
}

export { NM_DEFAULT_ICON_ASSET, NM_PRESET_ICON_PNG_SIZE, NM_UPLOAD_ICON_SIZE };
