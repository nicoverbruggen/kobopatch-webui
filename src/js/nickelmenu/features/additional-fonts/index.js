import JSZip from 'jszip';
import { fetchWithProgress, downloadProgress } from '../../../shell/dom.js';
import { installableAssetUrl, installableSize } from '../../installables.js';

// Installs three bundled font families (Readerly, Libron, Cartisse) so they
// appear in the in-book font dropdown. Each family ships as a zip asset that is
// downloaded and extracted into fonts/ at install time; removal deletes the
// individual .ttf files again.
export default {
    id: 'additional-fonts',
    section: 'Text and typography',
    title: 'Install additional fonts',
    description:
        'Adds a few custom fonts, including Readerly, Libron and Cartisse. When reading a book, these new entries will be visible in the font dropdown menu.',
    default: true,

    cleanup: {
        mode: 'optional',
        title: 'Additional fonts',
        removeLabel: 'Remove the bundled fonts (Readerly, Libron, Cartisse)',
        description: 'Removes the Readerly, Libron and Cartisse font files from your device.',
        detect: [
            ['fonts', 'KF_Readerly-Regular.ttf'],
            ['fonts', 'KF_Libron-Regular.ttf'],
            ['fonts', 'KF_Cartisse-Regular.ttf'],
        ],
        paths: [
            { path: ['fonts', 'KF_Readerly-Regular.ttf'] },
            { path: ['fonts', 'KF_Readerly-Italic.ttf'] },
            { path: ['fonts', 'KF_Readerly-Bold.ttf'] },
            { path: ['fonts', 'KF_Readerly-BoldItalic.ttf'] },
            { path: ['fonts', 'KF_Libron-Regular.ttf'] },
            { path: ['fonts', 'KF_Libron-Italic.ttf'] },
            { path: ['fonts', 'KF_Libron-Bold.ttf'] },
            { path: ['fonts', 'KF_Libron-BoldItalic.ttf'] },
            { path: ['fonts', 'KF_Cartisse-Regular.ttf'] },
            { path: ['fonts', 'KF_Cartisse-Italic.ttf'] },
            { path: ['fonts', 'KF_Cartisse-Bold.ttf'] },
            { path: ['fonts', 'KF_Cartisse-BoldItalic.ttf'] },
        ],
    },

    async install(ctx) {
        // Each archive contains four .ttf weights named
        // KF_<Family>-{Regular,Italic,Bold,BoldItalic}.ttf.
        const archives = [
            { name: 'KF Readerly', id: 'readerly', file: 'KF_Readerly.zip' },
            { name: 'KF Libron', id: 'libron', file: 'KF_Libron.zip' },
            { name: 'KF Cartisse', id: 'cartisse', file: 'KF_Cartisse.zip' },
        ];

        const files = [];
        for (const archive of archives) {
            const label = `Downloading ${archive.name} font...`;
            ctx.progress(label);
            const zipBytes = await fetchWithProgress(
                installableAssetUrl(archive.id, archive.file),
                downloadProgress(ctx.progress, label, await installableSize(archive.id)),
                `Failed to download ${archive.name}`,
            );
            const zip = await JSZip.loadAsync(zipBytes);

            for (const [name, entry] of Object.entries(zip.files)) {
                if (entry.dir || !name.endsWith('.ttf')) continue;
                // Strip any directory prefix, place directly in fonts/
                const filename = name.split('/').pop();
                files.push({
                    path: 'fonts/' + filename,
                    data: new Uint8Array(await entry.async('arraybuffer')),
                });
            }
        }
        return files;
    },
};
