import { appendToNickelHomeConfig } from '../helpers.js';
import { loadBundledAsset } from '../assets.js';
import { parseTarGz } from '../../archive.js';
import { fetchWithProgress, downloadProgress } from '../../../shell/dom.js';
import { installableAvailable, installableVersion, installableAssetUrl, installableSize } from '../../installables.js';

export const TOGGLE_HIDDEN_HOME_SCRIPT_URL = new URL('./scripts/toggle_hidden_home.sh', import.meta.url).href;

// The home-screen hiders are near-identical: each one writes a single
// hide_home_*_enabled:1 line to NickelHome's config and shares ONE on-device
// toggle — the "Minimal Home" Toggle-menu item plus a script that flips every
// hide_home_*_enabled flag at once. The hiding is done by the NickelHome mod (a
// standalone sibling of NickelMenu); this UI writes NickelHome's config, folds the
// NickelHome KoboRoot.tgz into the combined archive, and installs the NickelMenu
// toggle that flips it. Rather than repeat that across three feature files, we
// generate the features from a table below. Each generated feature owns the shared
// toggle, and the installer de-duplicates the identical menu item (by id), script
// (by path), and merged tar entries (by path) so each lands exactly once regardless
// of how many hiders are selected.

// The NickelHome mod is a shared dependency of every home-content hider. Fetch and
// parse its KoboRoot.tgz once (memoised) so selecting several hiders doesn't download
// it three times; the installer also de-duplicates the merged tar entries by path.
// Contributes nothing when the deployment doesn't ship the NickelHome asset.
let nickelHomeEntriesPromise = null;
function nickelHomeKoboRootEntries(ctx) {
    if (!installableAvailable('nickelhome')) return Promise.resolve([]);
    if (!nickelHomeEntriesPromise) {
        nickelHomeEntriesPromise = (async () => {
            const version = installableVersion('nickelhome');
            const label = 'Downloading NickelHome ' + version + '...';
            ctx.progress(label);
            const tgz = await fetchWithProgress(
                installableAssetUrl('nickelhome', 'NickelHome.tgz'),
                downloadProgress(ctx.progress, label, await installableSize('nickelhome')),
                'Failed to download NickelHome',
            );
            ctx.progress('Merging NickelHome into KoboRoot.tgz...');
            return parseTarGz(tgz);
        })().catch((err) => {
            nickelHomeEntriesPromise = null; // clear so a later attempt can retry
            throw err;
        });
    }
    return nickelHomeEntriesPromise;
}

function makeHider({ id, title, description, flag }) {
    return {
        id,
        section: 'Interface Tweaks',
        title,
        description,
        default: false,

        // Ship the shared toggle script (de-duplicated by path in the installer,
        // so it lands once however many hiders are selected). It goes under
        // .adds/nm/scripts so NickelMenu removal's recursive delete cleans it up.
        // The Vite-tracked URL goes through the installer's per-run asset cache,
        // so the script is fetched exactly once even when several hiders are selected.
        async install(ctx = {}) {
            const data = ctx.bundledAsset ? await ctx.bundledAsset(TOGGLE_HIDDEN_HOME_SCRIPT_URL) : await loadBundledAsset(TOGGLE_HIDDEN_HOME_SCRIPT_URL);
            return [{ path: '.adds/nm/scripts/toggle_hidden_home.sh', data }];
        },

        // Contribute the shared Toggle item. Every hider returns this identical
        // entry and the installer collapses the duplicates (by id); its position
        // (after the power items) is set by 'toggle-hidden-home' in ../menu-order.js.
        menuItems() {
            return [
                {
                    id: 'toggle-hidden-home',
                    lines: ['menu_item :main :Minimal Home :cmd_output :7000 :/mnt/onboard/.adds/nm/scripts/toggle_hidden_home.sh'],
                },
            ];
        },

        // Write this hider's flag to NickelHome's config (shared across hiders).
        postProcess: appendToNickelHomeConfig(`${flag}:1`),

        // Fold the NickelHome mod (which does the actual hiding) into the combined
        // KoboRoot.tgz. Shared across hiders: fetched once and de-duplicated by path.
        koboRootEntries: nickelHomeKoboRootEntries,

        // One shared NickelHome notice for the review step. Every hider returns the
        // identical entry; featureReviewNotices de-duplicates it so it shows once.
        reviewNotices() {
            return [
                {
                    type: 'info',
                    title: 'NickelHome',
                    paragraphs: [
                        'NickelHome hides the home-screen widgets you selected. Applied on the reboot after install. You can turn the minimal home on or off any time with the "Minimal Home" menu item.',
                    ],
                    link: {
                        label: 'NickelHome on GitHub',
                        href: 'https://github.com/nicoverbruggen/NickelHome',
                    },
                },
            ];
        },
    };
}

const HIDERS = [
    {
        id: 'hide-recommendations',
        title: 'Hide home screen recommendations',
        description: 'Hides the recommendations next to your current read on the home screen.',
        flag: 'hide_home_row1col2_enabled',
    },
    {
        id: 'hide-row2col2',
        title: 'Hide suggestions next to My Books',
        description: 'Hides the suggestions shown next to My Books on the second row of the home screen.',
        flag: 'hide_home_row2col2_enabled',
    },
    {
        id: 'hide-notices',
        title: 'Hide home screen notices',
        description:
            'Hides the third row on the home screen that shows notices below your books, such as reading time, release notes for updates, and Kobo Plus or Store promotions.',
        flag: 'hide_home_row3_enabled',
    },
];

export const homeHiders = HIDERS.map(makeHider);
