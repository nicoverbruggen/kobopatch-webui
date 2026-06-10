import { darkModeSupport } from '../../../kobo/dark-mode.js';

/**
 * Comment out the Dark Mode menu item (matched by its `:dark_mode` setting),
 * leaving an explanatory comment above it. Older devices have no Dark mode
 * setting, so the item would otherwise appear in the Tweak menu but do nothing.
 */
function commentOutDarkMode(items) {
    return items
        .split('\n')
        .flatMap(line =>
            /:dark_mode\b/.test(line) && !line.trimStart().startsWith('#')
                ? ['# Unsupported on your device so this line is commented out.', '# ' + line]
                : [line]
        )
        .join('\n');
}

const presetScripts = [
    {
        path: '.adds/scripts/legibility_status.sh',
        asset: 'scripts/legibility_status.sh',
    },
    {
        path: '.adds/scripts/toggle_wk_rendering.sh',
        asset: 'scripts/toggle_wk_rendering.sh',
    },
];

const customMenu = {
    id: 'custom-menu',
    section: 'Required components',
    title: 'Set up NickelMenu preset',
    description: 'Adds menu items for dark mode, screenshots, and more. A new tab will be added in the bottom navigation that is labelled "Tweak". (Preset made by the author of this website.)',
    default: true,
    required: true,
    cleanup: {
        mode: 'always',
        paths: presetScripts.map(script => script.path),
        removeParentDirsIfEmpty: [['.adds', 'scripts']],
    },

    // The preset's Dark Mode item only works on devices whose firmware has a
    // Dark mode setting. On older devices we drop the item (see postProcess) and
    // surface this notice instead.
    reviewNotices(ctx = {}) {
        if (darkModeSupport(ctx.deviceInfo) !== 'unsupported') return [];
        const model = ctx.deviceInfo?.model || 'your device';
        return [{
            type: 'warning',
            title: 'Dark Mode is not supported',
            paragraphs: [
                `${model} does not support Dark Mode, so it has been left out of the (...) menu for books on this device.`,
            ],
            link: {
                label: 'Kobo documentation on dark mode',
                href: 'https://help.kobo.com/hc/en-us/articles/360062231213-About-Dark-mode',
            },
        }];
    },

    async install(ctx) {
        return [
            { path: '.adds/nm/items', data: await ctx.asset('items') },
            { path: '.adds/nm/.cog.png', data: await ctx.asset('.cog.png') },
            ...await Promise.all(presetScripts.map(async script => ({
                path: script.path,
                data: await ctx.asset(script.asset),
            }))),
        ];
    },

    postProcess(files, ctx = {}) {
        if (darkModeSupport(ctx.deviceInfo) !== 'unsupported') return files;

        const items = files.find(f => f.path === '.adds/nm/items');
        if (items && typeof items.data === 'string') {
            items.data = commentOutDarkMode(items.data);
        }
        return files;
    },
};

export default customMenu;
