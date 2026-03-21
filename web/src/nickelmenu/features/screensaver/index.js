export default {
    id: 'screensaver',
    title: 'Copy screensaver',
    description: 'Copies a screensaver to .kobo/screensaver. Depending on your configuration, it will now be displayed instead of your current read. You can always add your own in the .kobo/screensaver folder, and choosing Tweak > Screensaver will let you toggle it off.',
    default: false,

    uninstall: {
        title: 'Screensaver',
        description: 'Removes the custom screensaver image (moon.png).',
        detect: [['.kobo', 'screensaver', 'moon.png']],
        paths: [
            { path: ['.kobo', 'screensaver', 'moon.png'] },
        ],
    },

    async install(ctx) {
        return [
            { path: '.kobo/screensaver/moon.png', data: await ctx.asset('moon.png') },
        ];
    },
};
