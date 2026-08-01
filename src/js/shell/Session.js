/**
 * Session.js — The shared wizard state.
 *
 * What is left here is genuinely shared: the long-lived services, the async
 * handles, and ten data fields that more than one flow reads. Everything that
 * belonged to a single flow has
 * moved into that flow's own object — `DetectedInstallation`,
 * `NickelMenuSelection`, `NickelMenuOutcome`, `PatchesBuild`, `ReloadBanner` —
 * so this file is now an accurate list of what is shared rather than a bag of
 * everything.
 *
 * Every field is declared here, so the object's full shape really is
 * discoverable from this file. That claim used to be false: two fields
 * (`_nmDoneMode`, `additionalFileEntries`) were written by flow code and never
 * declared, which is what motivated the split.
 *
 * There are no navigation callbacks on it any more either. `showError` and the
 * three `goTo*` were assigned onto it by four different modules after
 * construction, which made each of them nullable at every call site; `Wizard`
 * owns those edges now.
 */

// Each async resource is started at boot and awaited much later, in whichever
// screen needs it. In between, a rejection has nobody watching: the browser
// fires `unhandledrejection`, the global safety net reads that as the app
// crashing, and the user gets "Something went wrong" during boot for a resource
// they had not asked for yet. `held` attaches an empty catch purely to mark the
// rejection handled — the promise still rejects for whoever awaits it, so the
// screen that actually needs the resource still reports the failure with a
// message that means something.
const held = (promise) => (promise.catch(() => {}), promise);

export class Session {
    /**
     * Everything a session needs is passed in. Nothing is assigned onto it
     * afterwards — the services used to arrive via `Object.assign` and the
     * navigation callbacks via four separate modules, which made every one of
     * them nullable at every call site.
     *
     * @param {object} services
     * @param {object} services.device
     * @param {object} services.patchUI
     * @param {object} services.runner
     * @param {object} services.nmInstaller
     * @param {Function} services.getSoftwareUrl
     * @param {Promise} services.softwareUrlsReady
     * @param {Promise} services.blacklistReady
     */
    constructor({ device, patchUI, runner, nmInstaller, getSoftwareUrl, softwareUrlsReady, blacklistReady }) {
        // Long-lived services.
        this.device = device;
        this.patchUI = patchUI;
        this.runner = runner;
        this.nmInstaller = nmInstaller;
        this.getSoftwareUrl = getSoftwareUrl;

        // Async resource handles. `availablePatchesReady` is started separately
        // because it resolves by writing back here — see `startAvailablePatchesLoad`.
        this.softwareUrlsReady = held(softwareUrlsReady);
        this.blacklistReady = held(blacklistReady);
        this.availablePatchesReady = null;
        this.availablePatches = null;

        this.#initializeData();
    }

    /**
     * Start the patch-catalogue load.
     *
     * A method rather than a constructor argument because it is the one load
     * whose result belongs on this object: passing the promise in would still
     * leave `availablePatches` to be assigned from outside.
     *
     * @param {() => Promise<object[]>} scan
     */
    startAvailablePatchesLoad(scan) {
        this.availablePatchesReady = held(
            scan().then((patches) => {
                this.availablePatches = patches;
            }),
        );
    }

    /**
     * The initial values of every data field.
     *
     * Private, and named for what it is: the constructor calls it and nothing
     * else ever did. It stays a named method rather than being inlined because
     * the grouping is what makes the data-field list discoverable, which is the
     * claim this file's header makes. There is no "restart the wizard" flow, and
     * if one is ever added it will need more than this does — so this is not the
     * API to build it on. `resetDeviceContext` is the only reset the running app
     * performs, and it stays public.
     */
    #initializeData() {
        this.manualMode = false;
        this.selectedMode = null;
        this.selectedChannel = null;
        this.firmwareURL = null;
        this.firmwareVersion = null;
        this.deviceModelLabel = null;
        this.patchesUnavailableReason = null;
        this.patchesLoaded = false;
        this.isRestore = false;
        // Tri-state, and all three values are load-bearing: `undefined` means not
        // yet probed, `null` means manual mode or no device, a number is the
        // count. `getKoboUserCount` returns early on anything but `undefined`, so
        // `undefined` is the only value that re-arms the probe.
        this.koboUserCount = undefined;
    }

    /**
     * Throw away what we learned from the connected device, keeping what the user
     * chose. Fired from the device screen's Back button.
     *
     * Each flow and the device screen have their own counterpart, which
     * `Wizard.resetDeviceContext()` calls alongside this one. They are
     * independent of each other.
     */
    resetDeviceContext() {
        this.selectedChannel = null;
        this.patchesLoaded = false;
        this.firmwareURL = null;
        this.firmwareVersion = null;
        this.deviceModelLabel = null;
        this.patchesUnavailableReason = null;
        this.koboUserCount = undefined;
    }
}
