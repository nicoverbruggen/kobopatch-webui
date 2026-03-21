export default {
    id: 'custom-menu',
    title: 'Set up custom menu',
    description: 'Adds menu items for dark mode, screenshots, and more. A new tab will be added in the bottom navigation that is labelled "Tweak".',
    default: true,
    required: true,

    async install(ctx) {
        return [
            { path: '.adds/nm/items', data: await ctx.asset('items') },
            { path: '.adds/nm/.cog.png', data: await ctx.asset('.cog.png') },
            { path: '.adds/scripts/legibility_status.sh', data: await ctx.asset('scripts/legibility_status.sh') },
            { path: '.adds/scripts/toggle_wk_rendering.sh', data: await ctx.asset('scripts/toggle_wk_rendering.sh') },
        ];
    },
};
