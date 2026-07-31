/**
 * MenuIconImages.js — the image pipeline behind the Toggle tab's custom icon.
 *
 * Everything that turns a user's file or a preset SVG into the bytes NickelMenu
 * installs: SVG sizing, raster resizing to a square PNG, and rendering a preset
 * SVG to PNG. Icon-specific, so it lives with the feature that owns the icon
 * (`AGENTS.md` line 11) rather than at `nickelmenu/` level.
 */

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

/**
 * Turn the user's chosen file into the draft's icon.
 *
 * `shouldApply` is checked after every await and immediately before the draft is
 * mutated, so a slow resize cannot write into a dialog session that has since
 * moved on. Its default of `() => true` is why dropping the argument disables
 * the protection silently.
 */
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
