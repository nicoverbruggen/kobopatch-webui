/**
 * manual-flow.js — Manual (no direct connection) software selection.
 *
 * Owns step-manual-version: picking a software version and firmware channel by hand,
 * loading the matching patch set, and routing into the patches flow. Used when
 * the browser can't connect to a Kobo directly, or the user opts for manual
 * download.
 */

import { getChannelsForVersion } from '../kobo/software-urls.js';
import { $, collect, populateSelect } from '../shell/dom.js';
import { setNavStep, showStep } from '../shell/navigation.js';
import { TL } from '../shell/strings.js';
import { track } from '../shell/analytics.js';

export function initManualFlow(state, { patches }) {
    const {
        'step-manual-version': stepManualVersion,
        'btn-manual': btnManual,
        'btn-manual-confirm': btnManualConfirm,
        'btn-manual-version-back': btnManualVersionBack,
        'manual-version': manualVersion,
        'manual-model': manualModel,
        'patch-container': patchContainer,
    } = collect(['step-manual-version', 'btn-manual', 'btn-manual-confirm', 'btn-manual-version-back', 'manual-version', 'manual-model', 'patch-container']);

    state.goToManualVersionStep = () => {
        setNavStep(2);
        showStep(stepManualVersion);
    };

    btnManual.addEventListener('click', () => {
        state.manualMode = true;
        track('flow-start', { method: 'manual' });
        state.goToModeSelection();
    });

    manualVersion.addEventListener('change', () => {
        const version = manualVersion.value;
        state.selectedChannel = null;

        const modelHint = $('manual-model-hint');
        if (!version) {
            manualModel.hidden = true;
            modelHint.hidden = true;
            btnManualConfirm.disabled = true;
            return;
        }

        const channels = getChannelsForVersion(version);
        populateSelect(
            manualModel,
            '-- Select firmware channel --',
            channels.map((d) => ({ value: d.channel, text: d.label })),
        );
        manualModel.hidden = false;
        modelHint.hidden = false;
        btnManualConfirm.disabled = true;
    });

    manualModel.addEventListener('change', () => {
        state.selectedChannel = manualModel.value || null;
        btnManualConfirm.disabled = !manualVersion.value || !manualModel.value;
    });

    btnManualConfirm.addEventListener('click', async () => {
        const version = manualVersion.value;
        if (!version || !state.selectedChannel) return;

        try {
            const loaded = await loadPatchesForVersion(version, state.availablePatches);
            if (!loaded) {
                state.showError(TL.ERROR.LOAD_PATCHES_FAILED(version));
                return;
            }
            patches.configureFirmwareStep(version, state.selectedChannel, selectedManualChannelLabel());
            patches.goToPatches();
        } catch (err) {
            state.showError(err.message);
        }
    });

    btnManualVersionBack.addEventListener('click', () => {
        state.goToModeSelection();
    });

    async function loadPatchesForVersion(version, available) {
        const match = available.find((p) => p.version === version);
        if (!match) return false;

        await Promise.all([state.patchUI.loadFromURL('patches/' + match.filename), state.blacklistReady]);
        state.patchUI.render(patchContainer);
        patches.updatePatchCount();
        state.patchesLoaded = true;
        return true;
    }

    async function enterManualVersionSelection() {
        await Promise.all([state.softwareUrlsReady, state.availablePatchesReady]);
        populateSelect(
            manualVersion,
            '-- Select software version --',
            state.availablePatches.map((p) => ({ value: p.version, text: p.version, data: { filename: p.filename } })),
        );
        populateSelect(manualModel, '-- Select firmware channel --', []);
        manualModel.hidden = true;
        btnManualConfirm.disabled = true;
        setNavStep(2);
        showStep(stepManualVersion);
    }

    function selectedManualChannelLabel() {
        return manualModel.selectedOptions[0]?.textContent || state.selectedChannel;
    }

    return { enterManualVersionSelection };
}
