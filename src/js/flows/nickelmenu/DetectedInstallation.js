/**
 * DetectedInstallation.js — What probing the device turned up about an existing
 * NickelMenu install.
 *
 * Flow-scoped: written by the config screen's probe, read by the features,
 * backup and review screens, and cleared when the wizard restarts. It is not on
 * `Session` because none of it survives a flow restart and none of it is read
 * outside this flow.
 */

export class DetectedInstallation {
    constructor() {
        /** @type {object[]} features whose optional cleanup is present on the device */
        this.optionalCleanupFeatures = [];
        /** @type {object[]} preset entries that clash with what we would write */
        this.presetConflicts = [];
        /** A pre-existing `.adds/nm/items` file was found. */
        this.legacyItemsDetected = false;
        /** That legacy file looks like one an earlier Web UI release wrote. */
        this.legacyItemsWasOurs = false;
        /** `.adds/nm/webui-preset` exists, so this is a modify rather than a fresh install. */
        this.webuiPresetInstalled = false;
        /** The previous configuration has already been applied to the selection once. */
        this.previousConfigurationApplied = false;

        // The three below come off the device in the same probe as the six above,
        // but they are also what a *reconnect* invalidates, so they are the only
        // ones `resetDeviceContext` clears. See the note there.

        /** @type {string[]} feature ids the previous install's manifest recorded */
        this.previousFeatureIds = [];
        /** @type {object|null} the full previous preset configuration, if one is readable */
        this.previousConfiguration = null;
        /** @type {string[]} feature ids detected as currently installed on the device */
        this.installedFeatureIds = [];
    }

    /**
     * Whether the config screen should ask the probe to detect optional cleanups.
     *
     * This is an emptiness test, not a "have I already run" flag, and the
     * difference is the whole point. A visit that finds zero optional cleanups
     * leaves the list empty and detects again next time; a boolean would probe
     * once and never again. Baseline: `detectedOptionalCleanupFeatures.length === 0`
     * at `nickelmenu-flow.js:646` in `e18299f`.
     *
     * Re-detecting when the list is already populated is what must not happen:
     * `renderCleanupCheckboxes` rebuilds every checkbox as checked and reassigns
     * `selection.optionalCleanupIds` to the full list, so it would silently undo
     * the user's choice to keep a file — on a device-removal path.
     */
    get needsOptionalCleanupDetection() {
        return this.optionalCleanupFeatures.length === 0;
    }

    /** Forget everything probed, so restarting the wizard re-detects. */
    reset() {
        this.optionalCleanupFeatures = [];
        this.presetConflicts = [];
        this.legacyItemsDetected = false;
        this.legacyItemsWasOurs = false;
        this.webuiPresetInstalled = false;
        this.previousConfigurationApplied = false;
        this.resetDeviceContext();
    }

    /**
     * Forget only what a *different device* would invalidate.
     *
     * There are two reset methods rather than one, and the asymmetry is today's
     * behavior rather than a design choice. These three fields lived on `Session`
     * and were cleared by `Session.resetDeviceContext()`. The other six were
     * flow-local `let` bindings at baseline, so a device reconnect could not
     * reach them — they are cleared on the way back in instead, because
     * `mode-flow.js` calls `resetNickelMenuState()` on every mode switch.
     *
     * Do not merge the two: `reset()` clears all nine, this clears three, and a
     * reconnect must not discard the optional-cleanup checkboxes the user has
     * already been shown.
     */
    resetDeviceContext() {
        this.previousFeatureIds = [];
        this.previousConfiguration = null;
        this.installedFeatureIds = [];
    }
}
