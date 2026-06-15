import { parseTarGz } from '../../archive.js';
import { fetchWithProgress, downloadProgress } from '../../../shell/dom.js';
import { installableVersion, installableAssetUrl } from '../../installables.js';

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
    hint: 'https://github.com/OGKevin/cadmus',

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
        const version = installableVersion('cadmus');
        if (!version) throw new Error('Cadmus assets not available (run npm run setup:installables)');

        const label = 'Downloading Cadmus ' + version + '...';
        ctx.progress(label);
        const tarBytes = await fetchWithProgress(
            installableAssetUrl('cadmus', 'cadmus-kobo.tar.gz'),
            downloadProgress(ctx.progress, label),
            'Failed to download Cadmus',
        );

        ctx.progress('Extracting Cadmus...');
        return (await parseTarGz(tarBytes))
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
