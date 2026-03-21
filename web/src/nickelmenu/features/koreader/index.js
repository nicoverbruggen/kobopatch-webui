import JSZip from 'jszip';

export default {
    id: 'koreader',
    title: 'Install KOReader',
    description: 'Installs KOReader, an alternative e-book reader with advanced features like PDF reflow, customizable fonts, and more.',
    default: false,
    available: false, // set to true at runtime if KOReader assets exist

    uninstall: {
        title: 'KOReader',
        description: 'Removes the KOReader app directory (.adds/koreader/).',
        detect: [['.adds', 'koreader']],
        paths: [
            { path: ['.adds', 'koreader'], recursive: true },
        ],
    },

    async install(ctx) {
        ctx.progress('Fetching KOReader release info...');
        const metaResp = await fetch('/koreader/release.json');
        if (!metaResp.ok) throw new Error('KOReader assets not available (run koreader/setup.sh)');
        const meta = await metaResp.json();

        ctx.progress('Downloading KOReader ' + meta.version + '...');
        const zipResp = await fetch('/koreader/koreader-kobo.zip');
        if (!zipResp.ok) throw new Error('Failed to download KOReader: HTTP ' + zipResp.status);
        const zip = await JSZip.loadAsync(await zipResp.arrayBuffer());

        ctx.progress('Extracting KOReader...');
        const files = [];
        for (const [relativePath, entry] of Object.entries(zip.files)) {
            if (entry.dir) continue;
            const devicePath = relativePath.startsWith('koreader/')
                ? '.adds/' + relativePath
                : '.adds/koreader/' + relativePath;
            files.push({
                path: devicePath,
                data: new Uint8Array(await entry.async('arraybuffer')),
            });
        }

        // Add NickelMenu launcher config
        files.push({
            path: '.adds/nm/koreader',
            data: 'menu_item:main:KOReader:cmd_spawn:quiet:exec /mnt/onboard/.adds/koreader/koreader.sh\n',
        });

        return files;
    },
};
