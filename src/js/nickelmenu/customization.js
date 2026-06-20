export const NM_MENU_DEFAULT_LABEL = 'Toggle';
export const NM_MENU_LABEL_MAX_LENGTH = 10;
export const NM_MENU_ICON_DEFAULT_PATH = '.adds/nm/.cog.png';
export const NM_MENU_ICON_CUSTOM_PNG_PATH = '.adds/nm/.custom-icon.png';
export const NM_MENU_ICON_CUSTOM_SVG_PATH = '.adds/nm/.custom-icon.svg';

// Preset SVG paths are sourced from Lucide (https://lucide.dev/icons/),
// released under the ISC License.
const SVG_PREFIX =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" role="img" aria-hidden="true" fill="none" stroke="#111827" stroke-width="1.0" stroke-linecap="round" stroke-linejoin="round">';
const SVG_SUFFIX = '</svg>';

export const NM_MENU_PRESET_ICONS = [
    {
        id: 'cog',
        title: 'Cog',
        svg: `${SVG_PREFIX}<path d="M11 10.27 7 3.34"/><path d="m11 13.73-4 6.93"/><path d="M12 22v-2"/><path d="M12 2v2"/><path d="M14 12h8"/><path d="m17 20.66-1-1.73"/><path d="m17 3.34-1 1.73"/><path d="M2 12h2"/><path d="m20.66 17-1.73-1"/><path d="m20.66 7-1.73 1"/><path d="m3.34 17 1.73-1"/><path d="m3.34 7 1.73 1"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="8"/>${SVG_SUFFIX}`,
    },
    {
        id: 'book',
        title: 'Book',
        svg: `${SVG_PREFIX}<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>${SVG_SUFFIX}`,
    },
    {
        id: 'spark',
        title: 'Spark',
        svg: `${SVG_PREFIX}<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>${SVG_SUFFIX}`,
    },
    {
        id: 'cat',
        title: 'Cat',
        svg: `${SVG_PREFIX}<path d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 1.4.58-.42 7-.42 7 .57 1.07 1 2.24 1 3.44C21 17.9 16.97 21 12 21s-9-3-9-7.56c0-1.25.5-2.4 1-3.44 0 0-1.89-6.42-.5-7 1.39-.58 4.72.23 6.5 2.23A9.04 9.04 0 0 1 12 5Z"/><path d="M8 14v.5"/><path d="M16 14v.5"/><path d="M11.25 16.25h1.5L12 17l-.75-.75Z"/>${SVG_SUFFIX}`,
    },
    {
        id: 'heart',
        title: 'Heart',
        svg: `${SVG_PREFIX}<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>${SVG_SUFFIX}`,
    },
    {
        id: 'flower',
        title: 'Flower',
        svg: `${SVG_PREFIX}<circle cx="12" cy="12" r="3"/><path d="M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5"/><path d="M12 7.5V9"/><path d="M7.5 12H9"/><path d="M16.5 12H15"/><path d="M12 16.5V15"/><path d="m8 8 1.88 1.88"/><path d="M14.12 9.88 16 8"/><path d="m8 16 1.88-1.88"/><path d="M14.12 14.12 16 16"/>${SVG_SUFFIX}`,
    },
    {
        id: 'moon',
        title: 'Moon',
        svg: `${SVG_PREFIX}<path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>${SVG_SUFFIX}`,
    },
    {
        id: 'sun',
        title: 'Sun',
        svg: `${SVG_PREFIX}<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>${SVG_SUFFIX}`,
    },
    {
        id: 'coffee',
        title: 'Coffee',
        svg: `${SVG_PREFIX}<path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/>${SVG_SUFFIX}`,
    },
    {
        id: 'smile',
        title: 'Smile',
        svg: `${SVG_PREFIX}<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>${SVG_SUFFIX}`,
    },
    {
        id: 'palette',
        title: 'Palette',
        svg: `${SVG_PREFIX}<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="#111827"/><circle cx="17.5" cy="10.5" r=".5" fill="#111827"/><circle cx="6.5" cy="12.5" r=".5" fill="#111827"/><circle cx="8.5" cy="7.5" r=".5" fill="#111827"/>${SVG_SUFFIX}`,
    },
    {
        id: 'gem',
        title: 'Gem',
        svg: `${SVG_PREFIX}<path d="M10.5 3 8 9l4 13 4-13-2.5-6"/><path d="M17 3a2 2 0 0 1 1.6.8l3 4a2 2 0 0 1 .013 2.382l-7.99 10.986a2 2 0 0 1-3.247 0l-7.99-10.986A2 2 0 0 1 2.4 7.8l2.998-3.997A2 2 0 0 1 7 3z"/><path d="M2 9h20"/>${SVG_SUFFIX}`,
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
