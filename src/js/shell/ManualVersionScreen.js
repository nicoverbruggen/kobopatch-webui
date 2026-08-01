/**
 * ManualVersionScreen.js — Manual (no direct connection) software selection.
 *
 * Owns `step-manual-version`: picking a software version and firmware channel by
 * hand, loading the matching patch set, and routing into the patches flow. Used
 * when the browser cannot connect to a Kobo directly, or the user opts for a
 * manual download.
 */

import { getChannelsForVersion } from '../kobo/SoftwareURLs.js';
import { populateSelect, requireButton, requireElement, requireSelect } from './DOM.js';
import { setNavStep } from './Navigation.js';
import { TL } from './Strings.js';
import { latestPatchVersionForFamily } from '../patches/Catalog.js';
import { ShellScreen } from './ShellScreen.js';

export class ManualVersionScreen extends ShellScreen {
    /** @param {import('../Wizard.js').Wizard} nav */
    constructor(nav) {
        super(nav, 'step-manual-version');

        this.btnConfirm = requireButton('btn-manual-confirm');
        this.btnBack = requireButton('btn-manual-version-back');
        this.version = requireSelect('manual-version');
        this.model = requireSelect('manual-model');
        this.modelHint = requireElement('manual-model-hint');

        this.#wireListeners(this.listeners.signal);
    }

    /** Show the screen without repopulating it — the shared re-entry point. */
    goToStep() {
        setNavStep(2);
        this.show();
    }

    /** Populate the version list from the patch catalogue, then show the screen. */
    async enterSelection() {
        const session = this.session;
        await Promise.all([session.softwareUrlsReady, session.availablePatchesReady]);
        populateSelect(
            this.version,
            '-- Select software version --',
            session.availablePatches.map((p) => ({ value: p.version, text: p.version, data: { filename: p.filename } })),
        );
        populateSelect(this.model, '-- Select firmware channel --', []);
        this.model.hidden = true;
        this.btnConfirm.disabled = true;
        setNavStep(2);
        this.show();
    }

    #selectedChannelLabel() {
        return this.model.selectedOptions[0]?.textContent || this.session.selectedChannel;
    }

    async #loadPatchesForVersion(version, available) {
        const session = this.session;
        const match = available.find((p) => p.version === version);
        if (!match) return false;

        await Promise.all([
            session.patchUI.loadFromURL('patches/' + match.filename, {
                version: match.version,
                patchConfig: match.patches,
                testedFirmwareVersion: latestPatchVersionForFamily(available, match.version),
            }),
            session.blacklistReady,
        ]);
        // `patch-container` belongs to `step-patches`, so the patches flow renders
        // into it rather than this screen binding an element it does not own.
        this.nav.patches.renderPatchList();
        this.nav.patches.updatePatchCount();
        session.patchesLoaded = true;
        return true;
    }

    #wireListeners(signal) {
        this.version.addEventListener(
            'change',
            () => {
                const version = this.version.value;
                this.session.selectedChannel = null;

                if (!version) {
                    this.model.hidden = true;
                    this.modelHint.hidden = true;
                    this.btnConfirm.disabled = true;
                    return;
                }

                const channels = getChannelsForVersion(version);
                populateSelect(
                    this.model,
                    '-- Select firmware channel --',
                    channels.map((d) => ({ value: d.channel, text: d.label })),
                );
                this.model.hidden = false;
                this.modelHint.hidden = false;
                this.btnConfirm.disabled = true;
            },
            { signal },
        );

        this.model.addEventListener(
            'change',
            () => {
                this.session.selectedChannel = this.model.value || null;
                this.btnConfirm.disabled = !this.version.value || !this.model.value;
            },
            { signal },
        );

        this.btnConfirm.addEventListener(
            'click',
            async () => {
                const version = this.version.value;
                if (!version || !this.session.selectedChannel) return;

                try {
                    const loaded = await this.#loadPatchesForVersion(version, this.session.availablePatches);
                    if (!loaded) {
                        this.nav.showError(TL.ERROR.LOAD_PATCHES_FAILED(version), null);
                        return;
                    }
                    this.nav.patches.configureFirmwareStep(version, this.session.selectedChannel, this.#selectedChannelLabel());
                    this.nav.goToPatches();
                } catch (err) {
                    this.nav.showError(err.message, null);
                }
            },
            { signal },
        );

        this.btnBack.addEventListener('click', () => this.nav.goToModeSelection(), { signal });
    }
}
