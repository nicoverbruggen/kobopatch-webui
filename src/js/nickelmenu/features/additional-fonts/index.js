import JSZip from 'jszip';
import { fetchWithProgress, downloadProgress } from '../../../shell/Transfer.js';
import { installableAssetUrl, installableSize } from '../../Installables.js';
import { FONT_FAMILIES } from './FontCatalogue.js';
import { fontCollectionsToDownload, selectedFontFamilies } from './FontsCustomization.js';

// Installs font families from the ebook-fonts collection (the Kobo-optimized KF
// builds) so they appear in the in-book font dropdown. The collection ships as
// two archives — the curated "core" set (installed by default) and the larger
// "extra" set — and the user picks families via the "Select fonts" dialog (see
// ./customization.js and ./customization-dialog.js). Only the archives the
// selection needs are downloaded, and only the selected families' .ttf files
// are extracted into fonts/; removal deletes the individual .ttf files again.
export default {
    id: 'additional-fonts',
    section: 'Reading Experience',
    analyticsEvent: 'add-fonts',
    title: 'Install additional fonts',
    description: "Adds fonts from the ebook-fonts collection, such as Libron, Sourcerer and Cartisse. You can choose what fonts you'd like to install.",
    default: true,
    customization: {
        type: 'fonts',
        actionLabel: 'Select fonts',
        actionAriaLabel: 'Select which additional fonts are installed',
    },

    cleanup: {
        mode: 'optional',
        title: 'Additional fonts',
        removeLabel: 'Remove the additional fonts',
        description: 'Removes the ebook-fonts font files (such as Libron, Sourcerer and Cartisse) from your device.',
        // Any family's Regular weight marks an install (also matches fonts from
        // older app versions, whose file names are part of the catalogue too).
        detect: FONT_FAMILIES.map((family) => ['fonts', family.files[0]]),
        paths: FONT_FAMILIES.flatMap((family) => family.files.map((file) => ({ path: ['fonts', file] }))),
    },

    async reconcile(ctx) {
        const previousFamilies = new Set(ctx.previousConfiguration?.fontsCustomization?.families || []);
        const desiredFamilies = new Set(selectedFontFamilies(ctx.fontsCustomization).map((family) => family.id));
        const staleFamilies = FONT_FAMILIES.filter((family) => previousFamilies.has(family.id) && !desiredFamilies.has(family.id));

        for (const family of staleFamilies) {
            for (const file of family.files) {
                try {
                    await ctx.device.removeEntry(['fonts', file]);
                    ctx.audit?.record(`Removed fonts/${file}`);
                } catch (error) {
                    if (error?.name !== 'NotFoundError') throw error;
                }
            }
        }
    },

    async install(ctx) {
        const selected = selectedFontFamilies(ctx.fontsCustomization);

        const files = [];
        for (const collection of fontCollectionsToDownload(ctx.fontsCustomization)) {
            const label = `Downloading ${collection.title.toLowerCase()}...`;
            ctx.progress(label);
            const zipBytes = await fetchWithProgress(
                installableAssetUrl(collection.installable, collection.asset),
                downloadProgress(ctx.progress, label, await installableSize(collection.installable)),
                `Failed to download the ${collection.title.toLowerCase()}`,
            );
            const zip = await JSZip.loadAsync(zipBytes);

            const wanted = new Set(selected.filter((f) => f.collection === collection.id).flatMap((f) => f.files));
            for (const [name, entry] of Object.entries(zip.files)) {
                if (entry.dir) continue;
                // Strip any directory prefix, place directly in fonts/
                const filename = name.split('/').pop();
                if (!wanted.has(filename)) continue;
                wanted.delete(filename);
                files.push({
                    path: 'fonts/' + filename,
                    data: new Uint8Array(await entry.async('arraybuffer')),
                });
            }
            // The committed catalogue is generated from these archives, so a
            // missing file means the deployment's archive and catalogue drifted.
            if (wanted.size > 0) {
                throw new Error(`The ${collection.title.toLowerCase()} archive is missing: ${[...wanted].join(', ')}`);
            }
        }
        return files;
    },
};
