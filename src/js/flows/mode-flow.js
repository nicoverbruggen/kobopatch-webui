/**
 * mode-flow.js — The "what do you want to do" selection step.
 *
 * Owns step-mode: choosing between custom patches and NickelMenu, gating the
 * patches option when none are available, and dispatching into the chosen
 * flow. Exposes `state.goToModeSelection()` as the shared re-entry point used
 * by the connect, manual, and NickelMenu flows.
 */

import { $, $q, $qa, collect } from '../shell/dom.js';
import { setNavLabels, setNavStep, showStep, setupCardRadios } from '../shell/navigation.js';
import { deactivateFlow } from '../shell/step-machine.js';
import { TL } from '../shell/strings.js';

export function initModeFlow(state, { patches, nm, manual }) {
    const {
        'step-mode': stepMode,
        'step-connect': stepConnect,
        'step-device': stepDevice,
        'btn-mode-back': btnModeBack,
        'btn-mode-next': btnModeNext,
    } = collect(['step-mode', 'step-connect', 'step-device', 'btn-mode-back', 'btn-mode-next']);

    // The mode cards lead into two different flows with different step lists, so
    // reflect the chosen mode in the progress bar live (NickelMenu is the
    // recommended flow and acts as the placeholder until a choice is made).
    const navLabelsForMode = (mode) => (mode === 'patches' ? TL.NAV_PATCHES : TL.NAV_NICKELMENU);
    const applyModeNav = (mode) => {
        setNavLabels(navLabelsForMode(mode));
        setNavStep(2);
    };

    setupCardRadios(stepMode, 'selection-card--selected', (radio) => {
        btnModeNext.disabled = false;
        applyModeNav(radio.value);
    });

    function goToModeSelection() {
        deactivateFlow();
        nm.resetNickelMenuState();
        btnModeNext.disabled = true;

        for (const radio of $qa('input[name="mode"]', stepMode)) {
            radio.checked = false;
            radio.closest('.selection-card')?.classList.remove('selection-card--selected');
        }

        const patchesRadio = $q('input[value="patches"]', stepMode);
        const patchesCard = patchesRadio.closest('.selection-card');
        const autoModeNoPatchesAvailable = !state.manualMode && (!state.patchesLoaded || !state.firmwareURL);

        const patchesHint = $('mode-patches-hint');
        if (autoModeNoPatchesAvailable) {
            patchesRadio.disabled = true;
            patchesCard.classList.add('selection-card--disabled');
            patchesHint.textContent =
                state.patchesUnavailableReason ||
                'Custom patches are not available for your software version. You can still install NickelMenu and choose what you want to do with your Kobo.';
            patchesHint.hidden = false;
            const nmRadio = $q('input[value="nickelmenu"]', stepMode);
            nmRadio.checked = true;
            nmRadio.dispatchEvent(new Event('change'));
        } else {
            patchesRadio.disabled = false;
            patchesCard.classList.remove('selection-card--disabled');
            patchesHint.hidden = true;
        }

        // Before a choice is made, show the default placeholder steps; the card
        // change handler swaps them to the chosen mode's flow.
        setNavLabels(TL.NAV_DEFAULT);
        setNavStep(2);
        showStep(stepMode);
    }

    state.goToModeSelection = goToModeSelection;

    btnModeBack.addEventListener('click', () => {
        setNavStep(1);
        if (state.manualMode) {
            showStep(stepConnect);
        } else {
            showStep(stepDevice);
        }
    });

    btnModeNext.addEventListener('click', async () => {
        const selected = $q('input[name="mode"]:checked', stepMode);
        if (!selected) return;
        state.selectedMode = selected.value;

        if (state.selectedMode === 'nickelmenu') {
            setNavLabels(TL.NAV_NICKELMENU);
            await nm.goToNickelMenuConfig();
        } else if (state.manualMode && !state.patchesLoaded) {
            setNavLabels(TL.NAV_PATCHES);
            await manual.enterManualVersionSelection();
        } else {
            setNavLabels(TL.NAV_PATCHES);
            patches.goToPatches();
        }
    });
}
