import JSZip from 'jszip';

// Font families bundled as runtime assets, downloaded and extracted into fonts/
// at install time. Each archive contains four .ttf weights named
// KF_<Family>-{Regular,Italic,Bold,BoldItalic}.ttf.
const FONT_ARCHIVES = [
    { name: 'KF Readerly', asset: '/assets/KF_Readerly.zip' },
    { name: 'KF Libron', asset: '/assets/KF_Libron.zip' },
    { name: 'KF Cartisse', asset: '/assets/KF_Cartisse.zip' },
];

export default {
    id: 'additional-fonts',
    section: 'Text and typography',
    title: 'Install additional fonts',
    description: 'Adds a few custom fonts, including Readerly, Libron and Cartisse. When reading a book, these new entries will be visible in the font dropdown menu.',
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
        const files = [];
        for (const archive of FONT_ARCHIVES) {
            ctx.progress(`Downloading ${archive.name} font...`);
            const resp = await fetch(archive.asset);
            if (!resp.ok) throw new Error(`Failed to download ${archive.name}: HTTP ${resp.status}`);
            const zip = await JSZip.loadAsync(await resp.arrayBuffer());

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
