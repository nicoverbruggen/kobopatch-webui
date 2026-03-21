import JSZip from 'jszip';

export default {
    id: 'readerly-fonts',
    title: 'Install Readerly fonts',
    description: 'Adds the Readerly font family. These fonts are optically similar to Bookerly. When you are reading a book, you will be able to select this font from the dropdown as "KF Readerly".',
    default: true,

    async install(ctx) {
        ctx.progress('Downloading Readerly fonts...');
        const resp = await fetch('/readerly/KF_Readerly.zip');
        if (!resp.ok) throw new Error('Failed to download Readerly fonts: HTTP ' + resp.status);
        const zip = await JSZip.loadAsync(await resp.arrayBuffer());

        const files = [];
        for (const [name, entry] of Object.entries(zip.files)) {
            if (entry.dir || !name.endsWith('.ttf')) continue;
            // Strip any directory prefix, place directly in fonts/
            const filename = name.split('/').pop();
            files.push({
                path: 'fonts/' + filename,
                data: new Uint8Array(await entry.async('arraybuffer')),
            });
        }
        return files;
    },
};
