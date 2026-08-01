/**
 * ModeScreen.js — The "what do you want to do" selection screen.
 *
 * Owns `step-mode`: choosing between custom patches and NickelMenu, gating the
 * patches option when none are available, and dispatching into the chosen flow.
 * `goToModeSelection()` is the shared re-entry point the connect, manual and
 * NickelMenu flows all come back to.
 */

import { $q, $qa, requireButton, requireElement } from './DOM.js';
import { setNavLabels, setNavStep, setupCardRadios } from './Navigation.js';
import { TL } from './Strings.js';
import { ShellScreen } from './ShellScreen.js';

export class ModeScreen extends ShellScreen {
    /** @param {import('../Wizard.js').Wizard} nav */
    constructor(nav) {
        super(nav, 'step-mode');

        this.btnBack = requireButton('btn-mode-back');
        this.btnNext = requireButton('btn-mode-next');
        this.patchesHint = requireElement('mode-patches-hint');

        this.#wireListeners(this.listeners.signal);
    }

    /**
     * Show the mode screen, clearing any previous choice and gating the patches
     * card when the connected device has none available.
     */
    goToModeSelection() {
        this.nav.deactivateFlow();
        this.nav.nickelMenu.resetNickelMenuState();
        this.btnNext.disabled = true;

        for (const radio of $qa('input[name="mode"]', this.root)) {
            radio.checked = false;
            radio.closest('.selection-card')?.classList.remove('selection-card--selected');
        }

        const session = this.session;
        const patchesRadio = $q('input[value="patches"]', this.root);
        const patchesCard = patchesRadio.closest('.selection-card');
        const autoModeNoPatchesAvailable = !session.manualMode && (!session.patchesLoaded || !session.firmwareURL);

        if (autoModeNoPatchesAvailable) {
            patchesRadio.disabled = true;
            patchesCard.classList.add('selection-card--disabled');
            this.patchesHint.textContent =
                session.patchesUnavailableReason ||
                'Custom patches are not available for your software version. You can still install NickelMenu and choose what you want to do with your Kobo.';
            this.patchesHint.hidden = false;
            const nmRadio = $q('input[value="nickelmenu"]', this.root);
            nmRadio.checked = true;
            // A synthetic `change`, not a direct call: `setupCardRadios`' handler
            // is what applies the selected-card class *and* sets the breadcrumb.
            // Setting `checked` and calling `applyModeNav` by hand loses the class.
            nmRadio.dispatchEvent(new Event('change'));
        } else {
            patchesRadio.disabled = false;
            patchesCard.classList.remove('selection-card--disabled');
            this.patchesHint.hidden = true;
        }

        // Before a choice is made, show the default placeholder steps; the card
        // change handler swaps them to the chosen mode's flow.
        setNavLabels(TL.NAV_DEFAULT);
        setNavStep(2);
        this.show();
    }

    // The mode cards lead into two different flows with different step lists, so
    // reflect the chosen mode in the progress bar live (NickelMenu is the
    // recommended flow and acts as the placeholder until a choice is made).
    #applyModeNav(mode) {
        setNavLabels(mode === 'patches' ? TL.NAV_PATCHES : TL.NAV_NICKELMENU);
        setNavStep(2);
    }

    #wireListeners(signal) {
        setupCardRadios(
            this.root,
            'selection-card--selected',
            (radio) => {
                this.btnNext.disabled = false;
                this.#applyModeNav(radio.value);
            },
            { signal },
        );

        this.btnBack.addEventListener(
            'click',
            () => {
                // Set before showing: `showStep(step-connect)` hides the breadcrumb,
                // and the next thing to reveal it (`btn-connect`'s `showNav()`) does
                // not set the step, so the value written here is what shows then.
                setNavStep(1);
                if (this.session.manualMode) {
                    this.nav.goToConnectStep();
                } else {
                    this.nav.goToDeviceStep();
                }
            },
            { signal },
        );

        this.btnNext.addEventListener(
            'click',
            async () => {
                const selected = $q('input[name="mode"]:checked', this.root);
                if (!selected) return;
                this.session.selectedMode = selected.value;

                if (this.session.selectedMode === 'nickelmenu') {
                    setNavLabels(TL.NAV_NICKELMENU);
                    await this.nav.goToNickelMenuConfig();
                } else if (this.session.manualMode && !this.session.patchesLoaded) {
                    setNavLabels(TL.NAV_PATCHES);
                    await this.nav.enterManualVersionSelection();
                } else {
                    setNavLabels(TL.NAV_PATCHES);
                    this.nav.goToPatches();
                }
            },
            { signal },
        );
    }
}
