/**
 * NickelMenuFlow.js — Assembles the NickelMenu wizard.
 *
 * Owns the flow-scoped collaborators (what the device probe found, the three
 * customization drafts, the dialogs, the shared terminal), constructs the eight
 * screens, and hands them to the step machine. Per-screen behavior lives in the
 * step classes; the only logic here is what genuinely spans screens: entering
 * the flow, and tearing it down when the user leaves for mode selection.
 */

import { requireElement } from '../../shell/dom.js';
import { createFlow } from '../../shell/step-machine.js';
import { createTerminal } from '../../shell/terminal.js';
import { NICKELMENU_FEATURES } from '../../nickelmenu/features/index.js';
import { installablesManifest } from '../../nickelmenu/installables.js';
import { DetectedInstallation } from './DetectedInstallation.js';
import { NickelMenuSelection } from './NickelMenuSelection.js';
import { NickelMenuOutcome } from './NickelMenuOutcome.js';
import { CustomizationDrafts } from './CustomizationDrafts.js';
import { CustomizationDialogs } from './CustomizationDialogs.js';
import { ConfigStep } from './ConfigStep.js';
import { PresetConflictStep } from './PresetConflictStep.js';
import { FeaturesStep } from './FeaturesStep.js';
import { BackupStep } from './BackupStep.js';
import { ReviewStep } from './ReviewStep.js';
import { InstallingStep } from './InstallingStep.js';
import { DoneStep } from './DoneStep.js';
import { ManualRemoveStep } from './ManualRemoveStep.js';

export class NickelMenuFlow {
    /**
     * @param {object} session - the shared wizard session
     * @param {import('../../Wizard.js').Wizard} nav - the wizard, for cross-flow navigation
     */
    constructor(session, nav) {
        this.session = session;
        this.nav = nav;
        // One of the two lifetime scopes (the other is the step). Components this
        // flow owns borrow this signal rather than carrying their own controller
        // — see `Step` for why there is no destroy() cascade.
        this.listeners = new AbortController();

        // Gate runtime-available installables (reading apps, NickelClock, ...) on
        // the baked-in manifest; add-ons whose asset is not bundled stay
        // `available: false` and are listed as "Temporarily unavailable" in the
        // feature list. This mutates the shared registry, so it must run exactly
        // once, before any screen renders it.
        for (const [id, info] of Object.entries(installablesManifest())) {
            const feature = NICKELMENU_FEATURES.find((f) => f.id === id);
            if (feature && info.available) {
                feature.available = true;
                feature.version = info.version;
            }
        }

        // Collaborators that depend on nothing in this flow. The terminal needs
        // the done step's element; DoneStep declares that element's id as its
        // `domId` and the step machine resolves it separately, so looking it up
        // here is the flow's only `requireElement` for it.
        this.terminal = createTerminal({
            doneStep: requireElement('step-nm-done'),
            showError: (...args) => nav.showError(...args),
        });
        this.detected = new DetectedInstallation();
        this.selection = new NickelMenuSelection();
        this.outcome = new NickelMenuOutcome();
        this.drafts = new CustomizationDrafts(this.selection);
        this.dialogs = new CustomizationDialogs(session, this.selection, this.drafts, this.listeners.signal);

        // Steps. These fields fill in one at a time, so for the whole of
        // `ConfigStep`'s constructor `this.features` is still undefined — see the
        // rule in `Step`: no step may read a sibling until every constructor has
        // returned. `ConfigStep` reaches `owner.features` from `onEnter`, which
        // is why that works. `this.flow` is assigned after all of them for the
        // same reason.
        this.config = new ConfigStep(this);
        this.presetConflict = new PresetConflictStep(this);
        this.features = new FeaturesStep(this);
        this.backup = new BackupStep(this);
        this.review = new ReviewStep(this);
        this.installing = new InstallingStep(this);
        this.done = new DoneStep(this);
        this.manualRemove = new ManualRemoveStep(this);
        this.steps = [this.config, this.presetConflict, this.features, this.backup, this.review, this.installing, this.done, this.manualRemove];

        this.flow = createFlow({ id: 'nickelmenu', steps: this.steps });
    }

    /**
     * Detach every listener this flow's screens and dialogs attached.
     *
     * The app never calls this — it builds one flow at boot and keeps it. It
     * exists because the steps and the dialogs wire listeners onto markup that
     * outlives them, so anything that constructs a second flow (a test, a future
     * restart) must be able to discard the first one's wiring.
     */
    destroy() {
        for (const step of this.steps) step.destroy();
        this.listeners.abort();
    }

    /**
     * Navigate to one of this flow's steps.
     * @param {string} stepId
     */
    go(stepId) {
        return this.flow.go(stepId, this.session);
    }

    /** Follow the step machine's back target, if there is one. */
    async goBack() {
        const target = this.flow.back(this.session);
        if (target) await this.go(target);
    }

    /** Re-apply the current step's breadcrumb labels and index. */
    refreshNav() {
        this.flow.refreshNav(this.session);
    }

    /** Enter the flow at its first screen. Called by the mode selection screen. */
    async goToNickelMenuConfig() {
        await this.go('config');
    }

    /**
     * Tear the wizard back down to its initial state.
     *
     * Called by `mode-flow` on every mode switch, so it has to undo everything
     * the flow may have written: the probe results, the user's selection, each
     * screen's DOM, and the three customization drafts.
     *
     * **The statement order is load-bearing and mirrors the baseline
     * `resetNickelMenuState` (`nickelmenu-flow.js:584-628` at `e18299f`).** Two
     * things in particular:
     *
     * - `drafts.reset()` runs *after* `selection.resetCustomizations()`, because
     *   it re-clones the drafts from those very values. Swap them and the drafts
     *   come back holding the customization the user just discarded, so the next
     *   dialog opens seeded with it.
     * - The selection is reset in two halves, around `features.reset()` and
     *   `presetConflict.reset()`, rather than in one call at the top. That split
     *   is the baseline's, kept because nothing in those two screen resets reads
     *   a selection field — collapsing it would be an invisible reordering.
     */
    resetNickelMenuState() {
        const session = this.session;

        this.detected.reset();
        this.config.reset();

        session.koboUserCount = undefined; // `undefined`, not null — it is what re-arms the probe
        this.selection.resetProbeDependentChoices();

        this.features.reset();
        this.presetConflict.reset();

        this.selection.resetCustomizations();
        this.drafts.reset(this.selection);

        // No summary-chip refresh here. `features.reset()` above emptied the
        // feature list, and `renderFeatureCheckboxes` mints each chip from
        // `dialogs.summaryItem(type)` when it rebuilds — so the chips come back
        // from the reset selection by construction. The three calls that used to
        // sit here were provably inert at this one site; removing them is not a
        // behavior change. `flow-reset.test.js` pins the outcome a user sees.
        this.backup.reset();
    }

    /**
     * Forget what this flow learned from the device, keeping what the user chose.
     *
     * Called from the device screen's Back button alongside
     * `Session.resetDeviceContext()`. The selection is deliberately untouched:
     * reconnecting a device must not discard the options the user already picked.
     */
    resetDeviceContext() {
        this.detected.resetDeviceContext();
        this.outcome.clear();
    }
}
