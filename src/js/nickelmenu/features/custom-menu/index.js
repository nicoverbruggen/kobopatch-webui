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
};

export default customMenu;
