/**
 * Wizard.js — The composition root, and the map of what leads where.
 *
 * Owns every shell screen and both flows, and is handed to each of them so they
 * can navigate. That duality is the flow-assembler pattern from `NickelMenuFlow`
 * raised one level: construct the cyclic set, hold each member in a named field,
 * and let them reach the others at event time. The rule that makes it safe is in
 * `Step`'s JSDoc — capture the owner, read its fields later. Every navigation
 * edge in the app fires from an event handler, never from a constructor, so no
 * field is ever read before it is assigned and none of them is ever null.
 *
 * **Not `Navigator`**: `window.Navigator` is a platform global, and a class of
 * that name shadows it in every module that imports it.
 *
 * This is a large object by construction — six screens, two flows — and what
 * bounds it is a rule rather than a line count:
 *
 *   **A `Wizard` method is a navigation edge. Anything else reaches the owning
 *   object by name.**
 *
 * So `configureFirmwareStep` and `updatePatchCount` are `nav.patches.…` calls,
 * not `Wizard` methods: they operate on another object's own state. The value of
 * the method list below is that it stays readable as a map of the wizard's
 * transitions, which is exactly what the four late-bound `session.goTo*`
 * callbacks it replaces could never be.
 */

import { ConnectInstructionsScreen } from './shell/ConnectInstructionsScreen.js';
import { ConnectScreen } from './shell/ConnectScreen.js';
import { DeviceScreen } from './shell/DeviceScreen.js';
import { ErrorScreen } from './shell/ErrorScreen.js';
import { ManualVersionScreen } from './shell/ManualVersionScreen.js';
import { ModeScreen } from './shell/ModeScreen.js';
import { NickelMenuFlow } from './flows/nickelmenu/NickelMenuFlow.js';
import { PatchesFlow } from './flows/patches/PatchesFlow.js';
import { track } from './shell/Analytics.js';
import { setNavLabels, setNavStep } from './shell/Navigation.js';
import { TL } from './shell/Strings.js';

export class Wizard {
    /** @param {import('./shell/Session.js').Session} session */
    constructor(session) {
        this.session = session;

        /**
         * The flow currently being navigated, or null after a return to mode
         * selection. Set from inside `createFlow`'s `go()` via `onActivate`, so
         * every navigation updates it including the ones that bypass the flow
         * classes' own wrappers. Read by the error screen to decide whether it
         * can offer a recovery target.
         *
         * @type {object|null}
         */
        this.activeFlow = null;

        // Constructed first: everything else needs its `showError`. Its
        // constructor is side-effect-free — the global handlers are installed
        // below, at the point `app.js` used to call `initErrorScreen`.
        this.errorScreen = new ErrorScreen(this);

        // Flows. Each captures `this` and reads its screen fields only at event
        // time, which is what lets the cycle close without a second pass.
        this.patches = new PatchesFlow(session, this);
        this.nickelMenu = new NickelMenuFlow(session, this);

        // Installed here, after both flows, to match exactly where `app.js`
        // called `initErrorScreen`. See `ErrorScreen.installGlobalHandlers`.
        this.errorScreen.installGlobalHandlers();

        // Shell screens. Each captures `this` and reads its sibling fields only
        // once its listeners fire, which is what lets `mode` reach `connect` and
        // `connect` reach `mode` without either existing first.
        this.connect = new ConnectScreen(this);
        this.connectInstructions = new ConnectInstructionsScreen(this);
        this.device = new DeviceScreen(this);
        this.manualVersion = new ManualVersionScreen(this);
        this.mode = new ModeScreen(this);
    }

    // ---- navigation edges ----

    /** Record which flow is being navigated. Called by the step machine, not by screens. */
    setActiveFlow(flow) {
        this.activeFlow = flow;
    }

    /** Forget the active flow, so the error screen stops offering its recovery target. */
    deactivateFlow() {
        this.activeFlow = null;
    }

    /** Show the error screen. See `ErrorScreen.showError` for the options. */
    showError(message, log, options) {
        this.errorScreen.showError(message, log, options);
    }

    /** Show the landing screen. */
    start() {
        setNavLabels(TL.NAV_DEFAULT);
        setNavStep(1);
        this.connect.show();
    }

    /** Back to the landing screen. */
    goToConnectStep() {
        this.connect.show();
    }

    /** Forward from the landing screen to the plug-it-in instructions. */
    showConnectInstructions() {
        this.connectInstructions.show();
    }

    /** Open the browser's directory prompt and show what was found. */
    async connectDevice() {
        await this.device.connectAndShow();
    }

    /** Back to the device summary, with the default breadcrumb. */
    goBackToDeviceStep() {
        this.device.goBack();
    }

    /** Back to the device summary, leaving the breadcrumb to the caller. */
    goToDeviceStep() {
        this.device.show();
    }

    /**
     * Throw away everything learned from the device being left.
     *
     * The five are independent — every statement in the four `resetDeviceContext`
     * bodies is a plain value assignment with no getters and no side effects — so
     * the order is not load-bearing, only the completeness is.
     */
    resetDeviceContext() {
        this.session.resetDeviceContext();
        this.device.resetDeviceContext();
        this.nickelMenu.resetDeviceContext();
        this.patches.resetDeviceContext();
        this.session.device.reset();
    }

    /** The shared re-entry point: pick what to do with the connected Kobo. */
    goToModeSelection() {
        this.mode.goToModeSelection();
    }

    /** Re-show the manual version screen without repopulating it. */
    goToManualVersionStep() {
        this.manualVersion.goToStep();
    }

    /** Populate and show the manual version screen. */
    async enterManualVersionSelection() {
        await this.manualVersion.enterSelection();
    }

    /** Switch to manual mode from the landing screen. */
    startManualMode() {
        this.session.manualMode = true;
        track('flow-start', { method: 'manual' });
        this.goToModeSelection();
    }

    /** Enter the custom-patches flow at its patch-selection screen. */
    goToPatches() {
        this.patches.goToPatches();
    }

    /** Jump straight to the build screen — the "restore original" shortcut. */
    goToBuild() {
        this.patches.goToBuild();
    }

    /** Enter the NickelMenu flow at its first screen. */
    async goToNickelMenuConfig() {
        await this.nickelMenu.goToNickelMenuConfig();
    }

    /** Tear down every screen and flow. */
    destroy() {
        this.errorScreen.destroy();
        this.connect.destroy();
        this.connectInstructions.destroy();
        this.device.destroy();
        this.manualVersion.destroy();
        this.mode.destroy();
        this.patches.destroy();
        this.nickelMenu.destroy();
    }
}
