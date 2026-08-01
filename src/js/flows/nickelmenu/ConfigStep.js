/**
 * ConfigStep.js — `step-nickelmenu`, the "install preset / NickelMenu only /
 * remove" choice.
 *
 * It also runs the device probe for the whole flow: what is installed, what the
 * previous configuration was, which optional cleanups are present, and whether a
 * legacy `.adds/nm/items` file is in the way. Everything it learns goes into the
 * flow's `DetectedInstallation`.
 */

import { $q, $qa, requireButton, requireElement } from '../../shell/DOM.js';
import { setupCardRadios } from '../../shell/Navigation.js';
import { renderNmCheckboxList } from '../../nickelmenu/CheckboxList.js';
import {
    checkNickelMenuInstalled as probeCheckNickelMenuInstalled,
    detectInstalledNickelMenuFeatureIds,
    detectPresetConflicts as probeDetectPresetConflicts,
    readPreviousNickelMenuConfiguration,
} from '../../nickelmenu/Probes.js';
import { track } from '../../shell/Analytics.js';
import { NickelMenuStep } from './NickelMenuStep.js';

const PRESET_TITLE_REINSTALL = 'Modify current setup (and customize)';

export class ConfigStep extends NickelMenuStep {
    /** @param {import('./NickelMenuFlow.js').NickelMenuFlow} owner */
    constructor(owner) {
        super(owner, { id: 'config', domId: 'step-nickelmenu', navIndex: 3, recoveryStep: 'config' });

        this.root = requireElement('step-nickelmenu');
        this.uninstallOptions = requireElement('nm-uninstall-options');
        this.btnBack = requireButton('btn-nm-back');
        this.btnNext = requireButton('btn-nm-next');
        this.presetTitle = requireElement('nm-option-preset-title');
        this.removeOption = requireElement('nm-option-remove');
        this.removeRadio = $q('input[value="remove"]', this.removeOption);
        this.removeDesc = requireElement('nm-remove-desc');

        setupCardRadios(this.root, 'selection-card--selected', undefined, { signal: this.listeners.signal });

        // The "install" title is user copy read out of the markup, and the probe
        // overwrites the element with the "modify" title when a webui preset is
        // already on the device. Capture it before anything can retitle it, or
        // the reinstall title becomes permanent.
        this.presetTitleInstall = this.presetTitle.textContent;

        this.#wireListeners();
    }

    async onEnter(_ctx) {
        await this.#checkInstalledState();

        // On first arrival nothing is checked, and this synthetic `change` is the
        // only thing that sets `selection.option` — the radio handler
        // below does it, along with refreshing the breadcrumb labels. The two
        // lines after deliberately recompute what that handler just set.
        if (!$q('input[name="nm-option"]:checked', this.root)) {
            const presetRadio = $q('input[name="nm-option"][value="preset"]', this.root);
            presetRadio.checked = true;
            presetRadio.dispatchEvent(new Event('change'));
        }
        const currentOption = $q('input[name="nm-option"]:checked', this.root);
        this.uninstallOptions.hidden = !currentOption || currentOption.value !== 'remove' || this.owner.detected.optionalCleanupFeatures.length === 0;
        this.btnNext.disabled = !currentOption;
    }

    reset() {
        this.presetTitle.textContent = this.presetTitleInstall;
        this.uninstallOptions.hidden = true;
        this.uninstallOptions.innerHTML = '';
    }

    #wireListeners() {
        for (const radio of $qa('input[name="nm-option"]', this.root)) {
            radio.addEventListener(
                'change',
                () => {
                    if (!radio.checked) return;
                    this.owner.selection.option = radio.value;
                    this.uninstallOptions.hidden = radio.value !== 'remove' || this.owner.detected.optionalCleanupFeatures.length === 0;
                    this.owner.refreshNav();
                    this.btnNext.disabled = false;
                },
                { signal: this.listeners.signal },
            );
        }

        this.btnBack.addEventListener(
            'click',
            () => {
                this.nav.goToModeSelection();
            },
            { signal: this.listeners.signal },
        );

        this.btnNext.addEventListener(
            'click',
            async () => {
                const selected = $q('input[name="nm-option"]:checked', this.root);
                if (!selected) return;
                const selection = this.owner.selection;
                selection.option = selected.value;
                track('nm-option', { option: selection.option });

                if (selection.option === 'remove' && this.session.manualMode) {
                    this.owner.terminal.end('nm-remove-manual');
                    await this.owner.go('manual-remove');
                    return;
                }

                if (selection.option === 'preset') {
                    if (await this.#detectHasPresetConflicts()) {
                        await this.owner.go('preset-conflict');
                        return;
                    }
                    await this.owner.go('features');
                } else {
                    await this.owner.go('backup');
                }
            },
            { signal: this.listeners.signal },
        );
    }

    /**
     * Probe the device and record everything the rest of the flow needs.
     *
     * Runs on every arrival at this screen, including back-navigation, so the
     * optional-cleanup detection is gated on the collected list still being
     * empty — see `DetectedInstallation.needsOptionalCleanupDetection`.
     */
    async #checkInstalledState() {
        const session = this.session;
        const detected = this.owner.detected;

        const [installedState, previousConfiguration] = await Promise.all([
            probeCheckNickelMenuInstalled(session, {
                presetTitleEl: this.presetTitle,
                removeOption: this.removeOption,
                removeRadio: this.removeRadio,
                removeDesc: this.removeDesc,
                presetTitleInstall: this.presetTitleInstall,
                presetTitleReinstall: PRESET_TITLE_REINSTALL,
                // Detect only on the first visit so back-navigation preserves the
                // user's cleanup checkbox selections (re-rendering would wipe
                // them, and they drive what gets removed from the device).
                onOptionalCleanupDetected: detected.needsOptionalCleanupDetection
                    ? (found) => {
                          detected.optionalCleanupFeatures.push(...found);
                          this.renderCleanupCheckboxes();
                      }
                    : undefined,
                onLegacyItemsDetected: ({ detected: legacyDetected, wasOurs }) => {
                    detected.legacyItemsDetected = legacyDetected;
                    detected.legacyItemsWasOurs = wasOurs;
                },
            }),
            readPreviousNickelMenuConfiguration(session),
        ]);

        detected.previousConfiguration = previousConfiguration;
        detected.previousFeatureIds = previousConfiguration?.selectedFeatureIds || [];
        detected.webuiPresetInstalled = installedState.webuiPresetPresent;
        detected.installedFeatureIds = await detectInstalledNickelMenuFeatureIds(session, detected.previousFeatureIds, detected.webuiPresetInstalled);

        // Both of these live on `step-nm-features`, so the features step owns them.
        this.owner.features.showInstalledNote(installedState.installed);
        this.owner.features.showPreviousConfigActions(Boolean(previousConfiguration) && !detected.webuiPresetInstalled);
    }

    /**
     * Refresh the preset-conflict list. Deliberately has no first-visit guard,
     * unlike the optional-cleanup detection: the list feeds a read-only
     * acknowledgement screen, so re-probing it costs nothing.
     */
    async #detectHasPresetConflicts() {
        this.owner.detected.presetConflicts = await probeDetectPresetConflicts(this.session);
        return this.owner.detected.presetConflicts.length > 0;
    }

    /**
     * Render the "what should we also remove" checkboxes from what the probe
     * found, and seed the session's removal list from them.
     *
     * Destructive by design: it rebuilds the list with every box checked and
     * reassigns `selection.optionalCleanupIds` to the full set. That is why the
     * probe is only asked to detect while the list is still empty — running this
     * again would silently re-select cleanups the user had unchecked.
     */
    renderCleanupCheckboxes() {
        const features = this.owner.detected.optionalCleanupFeatures;
        if (features.length === 0) {
            this.uninstallOptions.innerHTML = '';
            return;
        }
        const items = features.map((f) => ({
            name: 'nm-uninstall-' + f.id,
            title: f.cleanup.removeLabel ?? 'Remove ' + f.cleanup.title,
            description: f.cleanup.description,
            checked: true,
        }));
        renderNmCheckboxList(this.uninstallOptions, items);

        // Checkboxes default to checked (remove). Seed the session from that and
        // keep it in sync as the source of truth for what gets removed.
        const selection = this.owner.selection;
        selection.optionalCleanupIds = features.map((f) => f.id);
        for (const f of features) {
            const cb = $q(`input[name="nm-uninstall-${f.id}"]`);
            if (!cb) continue;
            cb.addEventListener(
                'change',
                () => {
                    if (cb.checked) {
                        if (!selection.optionalCleanupIds.includes(f.id)) {
                            selection.optionalCleanupIds.push(f.id);
                        }
                    } else {
                        selection.optionalCleanupIds = selection.optionalCleanupIds.filter((id) => id !== f.id);
                    }
                },
                { signal: this.listeners.signal },
            );
        }
    }
}
