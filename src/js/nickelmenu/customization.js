import { BookOpen, Cat, Coffee, Cog, Flower, Gem, Heart, Moon, Palette, Smile, Sparkles, Sun } from 'lucide';

export const NM_MENU_DEFAULT_LABEL = 'Toggle';
export const NM_MENU_LABEL_MAX_LENGTH = 10;
export const NM_MENU_ICON_DEFAULT_PATH = '.adds/nm/.cog.png';
export const NM_MENU_ICON_CUSTOM_PNG_PATH = '.adds/nm/.custom-icon.png';
export const NM_MENU_ICON_CUSTOM_SVG_PATH = '.adds/nm/.custom-icon.svg';

// Preset icons are sourced from Lucide (https://lucide.dev/icons/).
const SVG_PREFIX =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" role="img" aria-hidden="true" fill="none" stroke="#111827" stroke-width="1.0" stroke-linecap="round" stroke-linejoin="round">';
const SVG_SUFFIX = '</svg>';

function iconAttrs(attrs) {
    return Object.entries(attrs)
        .map(([key, value]) => ` ${key}="${String(value).replace(/"/g, '&quot;')}"`)
        .join('');
}

function lucideSvg(icon) {
    return SVG_PREFIX + icon.map(([tag, attrs]) => `<${tag}${iconAttrs(attrs)}/>`).join('') + SVG_SUFFIX;
}

export const NM_MENU_PRESET_ICONS = [
    {
        id: 'cog',
        title: 'Cog',
        svg: lucideSvg(Cog),
    },
    {
        id: 'book',
        title: 'Book',
        svg: lucideSvg(BookOpen),
    },
    {
        id: 'spark',
        title: 'Spark',
        svg: lucideSvg(Sparkles),
    },
    {
        id: 'cat',
        title: 'Cat',
        svg: lucideSvg(Cat),
    },
    {
        id: 'heart',
        title: 'Heart',
        svg: lucideSvg(Heart),
    },
    {
        id: 'flower',
        title: 'Flower',
        svg: lucideSvg(Flower),
    },
    {
        id: 'moon',
        title: 'Moon',
        svg: lucideSvg(Moon),
    },
    {
        id: 'sun',
        title: 'Sun',
        svg: lucideSvg(Sun),
    },
    {
        id: 'coffee',
        title: 'Coffee',
        svg: lucideSvg(Coffee),
    },
    {
        id: 'smile',
        title: 'Smile',
        svg: lucideSvg(Smile),
    },
    {
        id: 'palette',
        title: 'Palette',
        svg: lucideSvg(Palette),
    },
    {
        id: 'gem',
        title: 'Gem',
        svg: lucideSvg(Gem),
    },
];

export function createDefaultMenuCustomization() {
    return {
        label: NM_MENU_DEFAULT_LABEL,
        icon: { type: 'default' },
    };
}

export function sanitizeMenuLabel(value) {
    return String(value ?? '')
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, NM_MENU_LABEL_MAX_LENGTH);
}

export function normalizeMenuLabel(value) {
    const label = sanitizeMenuLabel(value).trim();
    return label || NM_MENU_DEFAULT_LABEL;
}

export function isValidMenuLabel(value) {
    const label = String(value ?? '');
    return label === sanitizeMenuLabel(label) && label.trim().length > 0 && label.length <= NM_MENU_LABEL_MAX_LENGTH;
}

export function findPresetIcon(id) {
    return NM_MENU_PRESET_ICONS.find((icon) => icon.id === id) || null;
}

export function isDefaultMenuCustomization(customization = null) {
    return (
        !customization || (normalizeMenuLabel(customization.label) === NM_MENU_DEFAULT_LABEL && (!customization.icon || customization.icon.type === 'default'))
    );
}

export function resolveMenuCustomization(customization = null) {
    const label = normalizeMenuLabel(customization?.label);
    const icon = customization?.icon;

    if (icon?.type === 'preset') {
        if (icon.id === 'cog') {
            return {
                label,
                iconPath: NM_MENU_ICON_DEFAULT_PATH,
                iconFile: null,
            };
        }

        if (icon.data) {
            const data = icon.data instanceof Uint8Array ? icon.data : new Uint8Array(icon.data);
            return {
                label,
                iconPath: NM_MENU_ICON_CUSTOM_PNG_PATH,
                iconFile: { path: NM_MENU_ICON_CUSTOM_PNG_PATH, data },
            };
        }

        const preset = findPresetIcon(icon.id);
        if (preset) {
            return {
                label,
                iconPath: NM_MENU_ICON_CUSTOM_SVG_PATH,
                iconFile: { path: NM_MENU_ICON_CUSTOM_SVG_PATH, data: new TextEncoder().encode(preset.svg) },
            };
        }
    }

    if (icon?.type === 'upload' && icon.data) {
        const path = icon.mimeType === 'image/svg+xml' ? NM_MENU_ICON_CUSTOM_SVG_PATH : NM_MENU_ICON_CUSTOM_PNG_PATH;
        const data = icon.data instanceof Uint8Array ? icon.data : new Uint8Array(icon.data);
        return {
            label,
            iconPath: path,
            iconFile: { path, data },
        };
    }

    return {
        label,
        iconPath: NM_MENU_ICON_DEFAULT_PATH,
        iconFile: null,
    };
}
