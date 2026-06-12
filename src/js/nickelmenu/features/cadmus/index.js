import { parseTarGz } from '../../archive.js';

// Installs Cadmus, an alternative Kobo reader app, from its Kobo tarball.
// The upstream archive is rooted at the app directory contents, so each file is
// written under .adds/cadmus/ and launched from Cadmus' own cadmus.sh script.
export default {
    id: 'cadmus',
    section: 'Reading Apps',
    title: 'Install Cadmus',
    description: 'Installs Cadmus, an alternative e-book reader based on Plato, focused on a clean reading experience. You can launch Cadmus from the Toggle menu; it does not replace the built-in reader functionality.',
    default: false,
    available: false, // set to true at runtime if Cadmus assets exist
    directories: ['.adds/cadmus'],

    cleanup: {
        mode: 'optional',
        title: 'Cadmus',
        removeLabel: 'Remove the Cadmus app (.adds/cadmus)',
        description: 'Removes the Cadmus app directory (.adds/cadmus/).',
        detect: [['.adds', 'cadmus']],
        paths: [
            { path: ['.adds', 'cadmus'], recursive: true },
        ],
    },

    async install(ctx) {
        ctx.progress('Fetching Cadmus release info...');
        const metaResp = await fetch('/assets/cadmus-release.json');
        if (!metaResp.ok) throw new Error('Cadmus assets not available (run npm run setup:installables)');
        const meta = await metaResp.json();

        ctx.progress('Downloading Cadmus ' + meta.version + '...');
        const tarResp = await fetch('/assets/cadmus-kobo.tar.gz');
        if (!tarResp.ok) throw new Error('Failed to download Cadmus: HTTP ' + tarResp.status);

        ctx.progress('Extracting Cadmus...');
        return (await parseTarGz(new Uint8Array(await tarResp.arrayBuffer())))
            .map(file => ({
                path: '.adds/cadmus/' + file.path,
                data: file.data,
            }));
    },

    menuItems() {
        return [{
            id: 'cadmus',
            lines: ['menu_item:main:Open Cadmus:cmd_spawn:quiet:exec /mnt/onboard/.adds/cadmus/cadmus.sh'],
        }];
    },
};
