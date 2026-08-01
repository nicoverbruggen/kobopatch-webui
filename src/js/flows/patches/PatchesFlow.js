/**
 * PatchesFlow.js — Assembles the Custom Patches wizard.
 *
 * Owns the shared terminal, constructs the four screens, and hands them to the
 * step machine. Per-screen behavior lives in the step classes; what stays here
 * is assembly and the small public surface the connect, manual and mode flows
 * call into.
 */

import { requireElement } from '../../shell/DOM.js';
import { createFlow } from '../../shell/StepMachine.js';
import { createTerminal } from '../../shell/Terminal.js';
import { PatchesBuild } from './PatchesBuild.js';
import { PatchesStep } from './PatchesStep.js';
import { FirmwareStep } from './FirmwareStep.js';
import { BuildingStep } from './BuildingStep.js';
import { DoneStep } from './DoneStep.js';

export class PatchesFlow {
    /**
     * @param {object} session - the shared wizard session
     * @param {import('../../Wizard.js').Wizard} nav - the wizard, for cross-flow navigation
     */
    constructor(session, nav) {
        this.session = session;
        this.nav = nav;

        // `step-done` is looked up here for the terminal; `DoneStep` reaches the
        // same element through its `domId` and the step machine, so this is the
        // only `requireElement` for that id.
        this.terminal = createTerminal({
            doneStep: requireElement('step-done'),
            showError: (...args) => nav.showError(...args),
        });

        this.build = new PatchesBuild();

        // Steps. Each captures `this` and reads the rest of it only once its
        // listeners fire or it is entered, so nothing here depends on a sibling
        // step or on `this.flow` existing yet.
        this.patches = new PatchesStep(this);
        this.firmware = new FirmwareStep(this);
        this.building = new BuildingStep(this);
        this.done = new DoneStep(this);
        this.steps = [this.patches, this.firmware, this.building, this.done];

        this.flow = createFlow({ id: 'patches', steps: this.steps, onActivate: (flow) => nav.setActiveFlow(flow) });

        // Assigned last: the callback reaches a step, so every step must exist.
        // Nothing calls it during construction.
        session.patchUI.onChange = () => this.patches.updatePatchCount();
    }

    /**
     * Navigate to one of this flow's steps.
     * @param {string} stepId
     * @param {object} [options] - passed through to the step machine, e.g. `{ skipHistory: true }`
     */
    go(stepId, options) {
        return this.flow.go(stepId, this.session, options);
    }

    /** Follow the step machine's back target, if there is one. */
    async goBack() {
        const target = this.flow.back(this.session);
        if (target) await this.go(target);
    }

    /** Enter the flow at the patch-selection screen. */
    goToPatches() {
        this.flow.go('patches', this.session);
    }

    /**
     * Jump straight to the build confirmation, skipping patch selection. Used by
     * the "restore original" shortcut on the device screen.
     *
     * Named for where it leads the user rather than for the step id: it goes to
     * `firmware`, which is the screen with the Build button on it.
     */
    goToBuild() {
        this.flow.go('firmware', this.session, { skipHistory: true });
    }

    /** Refresh the patch-selection screen's counts, buttons and hints. */
    updatePatchCount() {
        this.patches.updatePatchCount();
    }

    /**
     * Render the patch list into its container. Forwarded so the connect and
     * manual screens do not bind `patch-container`, which is `step-patches`'.
     */
    renderPatchList() {
        this.patches.renderPatchList();
    }

    /**
     * Record the firmware a build will use and show it on the confirmation
     * screen. Called by the connect and manual flows.
     *
     * @param {string} version
     * @param {string|null} channel
     * @param {string} [deviceLabel] - defaults to the channel, in `configure`
     */
    configureFirmwareStep(version, channel, deviceLabel) {
        this.firmware.configure(version, channel, deviceLabel);
    }

    /**
     * Forget what this flow produced for the previously connected device.
     *
     * Called from the device screen's Back button alongside
     * `Session.resetDeviceContext()`. `PatchesBuild.clear()` drops the built
     * KoboRoot.tgz **and** the Additional File entries together — before Phase 3
     * only the tgz was cleared, and nothing enforced the pairing.
     */
    resetDeviceContext() {
        this.build.clear();
        this.patches.reloadBanner.clear();
    }

    /** Detach every listener this flow's screens attached. */
    destroy() {
        for (const step of this.steps) step.destroy();
    }
}
