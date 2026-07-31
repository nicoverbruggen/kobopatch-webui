/**
 * FirmwareStep.js — `step-firmware`, the confirmation screen that lists what is
 * about to be built and starts the build.
 *
 * Owns the firmware labels, the selected-patches summary, and the Build button.
 * The build itself runs from here: it drives the transient building screen's
 * elements (which `BuildingStep` owns) and hands off to `done`.
 */

import { formatBytes, populateList, requireButton, requireElement } from '../../shell/dom.js';
import { TL } from '../../shell/strings.js';
import { appendLog, downloadFirmware, extractOriginalTgz, runPatcher } from '../patches-execute.js';
import { buildAdditionalFilesTgz, mergeAdditionalFilesIntoTgz } from '../../patches/additional-files.js';
import { Step } from '../Step.js';

const WAIT_HINT_RESTORE = 'Please wait while the original software is being downloaded and extracted...';
const WAIT_HINT_NO_PATCHES = 'Please wait while KoboRoot.tgz is being built...';
const WAIT_HINT_PATCHED = 'Please wait while the patch is being applied...';

export class FirmwareStep extends Step {
    /** @param {import('./PatchesFlow.js').PatchesFlow} owner */
    constructor(owner) {
        super(owner, { id: 'firmware', domId: 'step-firmware', navLabels: TL.NAV_PATCHES, navIndex: 4, recoveryStep: 'patches' });

        this.versionLabel = requireElement('firmware-version-label');
        this.deviceLabel = requireElement('firmware-device-label');
        this.description = requireElement('firmware-description');
        this.downloadDetails = requireElement('firmware-download-details');
        this.downloadUrl = requireElement('firmware-download-url');
        this.selectedPatchesList = requireElement('selected-patches-list');
        this.selectedPatchesHeading = requireElement('selected-patches-heading');
        this.selectedAdditionalFilesList = requireElement('selected-additional-files-list');
        this.selectedAdditionalFilesHeading = requireElement('selected-additional-files-heading');
        this.btnBack = requireButton('btn-build-back');
        this.btnBuild = requireButton('btn-build');

        this.#wireListeners();
    }

    /** Restoring skips the patches screen, so fall through to history instead. */
    back(ctx) {
        return ctx.isRestore ? null : 'patches';
    }

    async onEnter(_ctx) {
        const session = this.session;
        const additionalFilesOnly = !session.isRestore && session.patchUI.getEnabledCount() === 0;
        if (session.isRestore) {
            this.description.textContent = TL.STATUS.RESTORE_ORIGINAL;
            this.btnBuild.textContent = TL.BUTTON.RESTORE_ORIGINAL;
        } else if (additionalFilesOnly) {
            this.description.textContent = TL.STATUS.ADDITIONAL_FILES_ONLY;
            this.btnBuild.textContent = TL.BUTTON.BUILD_ADDITIONAL_FILES;
        } else {
            this.description.textContent = TL.STATUS.FIRMWARE_WILL_BE_DOWNLOADED;
            this.btnBuild.textContent = TL.BUTTON.BUILD_PATCHED;
        }
        // The download URL is only relevant when the firmware is actually fetched.
        this.downloadDetails.hidden = additionalFilesOnly;
        this.#populateSelectedPatchesList();
    }

    /**
     * Record the firmware the build will use and show it on this screen.
     *
     * Called by the connect and manual flows once a version is known, which is
     * why it reaches this step from outside through `PatchesFlow`.
     *
     * @param {string} version - firmware version, e.g. `4.45.23646`
     * @param {string|null} channel - firmware channel id, or null when unknown
     * @param {string} [deviceLabel] - display name for the device; defaults to the channel
     */
    configure(version, channel, deviceLabel = channel) {
        const session = this.session;
        session.selectedChannel = channel;
        session.firmwareURL = channel ? session.getSoftwareUrl(channel, version) : null;
        session.firmwareVersion = version;
        session.deviceModelLabel = deviceLabel;
        this.versionLabel.textContent = version;
        this.deviceLabel.textContent = session.deviceModelLabel;
        this.downloadUrl.textContent = session.firmwareURL || '';
    }

    /** List the patches and Additional Files this build will include. */
    #populateSelectedPatchesList() {
        const patchUI = this.session.patchUI;
        const enabled = patchUI.getEnabledPatches();
        populateList(this.selectedPatchesList, enabled);
        const hasPatches = enabled.length > 0;
        this.selectedPatchesList.hidden = !hasPatches;
        this.selectedPatchesHeading.hidden = !hasPatches;

        const additionalFiles = patchUI.getAdditionalFiles().map((file) => `${file.name} -> ${file.validation.path || file.destination}`);
        populateList(this.selectedAdditionalFilesList, additionalFiles);
        const hasAdditionalFiles = additionalFiles.length > 0;
        this.selectedAdditionalFilesList.hidden = !hasAdditionalFiles;
        this.selectedAdditionalFilesHeading.hidden = !hasAdditionalFiles;
    }

    /**
     * Download, patch, and merge — the whole build, driving the transient
     * building screen as it goes.
     *
     * Navigating to `building` comes first, before the log is cleared, and
     * `skipHistory` keeps the transient screen off the back stack. There are two
     * early exits that leave the user on `building` behind an error screen: an
     * additional-files-only build returns straight after going to `done`, and a
     * missing firmware URL reports an expected error and does not navigate at
     * all — recovery goes back to `patches`.
     */
    async #build() {
        const session = this.session;
        const build = this.owner.build;
        const building = this.owner.building;

        await this.owner.go('building', { skipHistory: true });
        building.log.textContent = '';
        building.progress.textContent = TL.STATUS.BUILDING_STARTING;
        building.waitHint.textContent = session.isRestore
            ? WAIT_HINT_RESTORE
            : session.patchUI.getEnabledCount() === 0
              ? WAIT_HINT_NO_PATCHES
              : WAIT_HINT_PATCHED;

        try {
            const log = (msg) => appendLog(building.log, msg);

            // No patches selected, only additional files: build a KoboRoot.tgz
            // containing just those files. The firmware and patched libraries are
            // not needed, so skip the download and the patcher entirely.
            if (!session.isRestore && session.patchUI.getEnabledCount() === 0) {
                build.additionalFileEntries = await session.patchUI.readAdditionalFileEntries();
                building.progress.textContent = 'Building KoboRoot.tgz...';
                log(
                    `Building KoboRoot.tgz with ${build.additionalFileEntries.length} additional file${build.additionalFileEntries.length === 1 ? '' : 's'} (no patches selected)...`,
                );
                build.tgz = await buildAdditionalFilesTgz(build.additionalFileEntries);
                for (const entry of build.additionalFileEntries) {
                    log(`  ADD ${entry.sourceName} -> ${entry.path}`);
                }
                await this.owner.go('done');
                return;
            }

            if (!session.firmwareURL) {
                this.nav.showError(TL.STATUS.NO_FIRMWARE_URL, null); // no firmware mapping for this version
                return;
            }

            const firmwareBytes = await downloadFirmware(session.firmwareURL, building.progress);
            log('Download complete: ' + formatBytes(firmwareBytes.length));

            build.tgz = session.isRestore
                ? await extractOriginalTgz(firmwareBytes, building.progress, log)
                : await runPatcher(
                      session.runner,
                      session.patchUI.generateConfig(),
                      firmwareBytes,
                      session.patchUI.getPatchFileBytes(),
                      building.progress,
                      log,
                  );

            // A restore explicitly clears the entries rather than leaving the
            // previous build's list stale.
            build.additionalFileEntries = session.isRestore ? [] : await session.patchUI.readAdditionalFileEntries();
            if (build.additionalFileEntries.length > 0) {
                log(`Adding ${build.additionalFileEntries.length} additional file${build.additionalFileEntries.length === 1 ? '' : 's'}...`);
                build.tgz = await mergeAdditionalFilesIntoTgz(build.tgz, build.additionalFileEntries);
                for (const entry of build.additionalFileEntries) {
                    log(`  ADD ${entry.sourceName} -> ${entry.path}`);
                }
            }

            await this.owner.go('done');
        } catch (err) {
            this.nav.showError('Build failed: ' + err.message, building.log.textContent);
        }
    }

    #wireListeners() {
        const { signal } = this.listeners;

        this.btnBack.addEventListener(
            'click',
            async () => {
                // A restore reached this screen straight from the device step, so
                // it goes back there rather than through the flow's own history.
                if (this.session.isRestore) {
                    this.session.isRestore = false;
                    this.nav.goBackToDeviceStep();
                } else {
                    await this.owner.goBack();
                }
            },
            { signal },
        );

        this.btnBuild.addEventListener('click', () => this.#build(), { signal });
    }
}
