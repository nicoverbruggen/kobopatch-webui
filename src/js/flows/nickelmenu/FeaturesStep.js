/**
 * FeaturesStep.js — `step-nm-features`, the feature checkbox list for the preset
 * install, plus the "use previous configuration" restore and the sideload-mode
 * recommendation banner.
 */

import { $q, $qa, requireButton, requireElement } from '../../shell/dom.js';
import { renderNmCheckboxList } from '../../nickelmenu/checkbox-list.js';
import { NICKELMENU_FEATURES } from '../../nickelmenu/features/index.js';
import { featureDisabledReason } from '../../nickelmenu/selection.js';
import { getKoboUserCount as probeGetKoboUserCount } from '../../nickelmenu/probes.js';
import { meetsMinimumVersion } from '../../kobo/version.js';
import { NickelMenuStep } from './NickelMenuStep.js';

const COLLAPSED_SECTIONS = new Set(['Alternative reading apps', 'Advanced', 'Legacy']);

export class FeaturesStep extends NickelMenuStep {
    /** @param {import('./NickelMenuFlow.js').NickelMenuFlow} owner */
    constructor(owner) {
        super(owner, { id: 'features', domId: 'step-nm-features', navIndex: 3 });

        this.configOptions = requireElement('nm-config-options');
        this.previousConfigurationActions = requireElement('nm-previous-configuration-actions');
        this.btnUsePreviousConfiguration = requireButton('btn-nm-use-previous-configuration');
        this.btnBack = requireButton('btn-nm-features-back');
        this.btnNext = requireButton('btn-nm-features-next');
        this.sideloadedBanner = requireElement('nm-sideloaded-banner');
        this.installedFeaturesNote = requireElement('nm-installed-features-note');

        this.#wireListeners();
    }

    back(_ctx) {
        return 'config';
    }

    async onEnter(_ctx) {
        // Seed from what is on the device, once. `previousConfigurationApplied`
        // is also set by the "use previous configuration" button on this screen,
        // which is the point: an explicit restore by the user wins over the
        // automatic one, and re-entering this step must not overwrite it.
        if (this.owner.detected.webuiPresetInstalled && !this.owner.detected.previousConfigurationApplied) {
            // `render: false` because the next line renders unconditionally.
            this.restorePreviousConfiguration(true, false);
        }
        this.renderFeatureCheckboxes();
        // Fire and forget: awaiting it would hold up the step machine's focus
        // call behind a SQLite read, and a rejection would reach the global
        // unhandled-rejection handler and show the error screen mid-flow.
        this.updateSideloadedRecommendation().catch(() => {});
    }

    reset() {
        this.sideloadedBanner.hidden = true;
        this.configOptions.innerHTML = '';
        this.previousConfigurationActions.hidden = true;
        this.installedFeaturesNote.hidden = true;
    }

    /**
     * Show or hide the "some of these are already installed" note. Called by the
     * config step, whose probe decides it but whose markup does not contain it.
     *
     * @param {boolean} visible
     */
    showInstalledNote(visible) {
        this.installedFeaturesNote.hidden = !visible;
    }

    /**
     * Show or hide the "use previous configuration" action row. Also driven by
     * the config step's probe.
     *
     * @param {boolean} visible
     */
    showPreviousConfigActions(visible) {
        this.previousConfigurationActions.hidden = !visible;
    }

    /**
     * Apply the device's previous NickelMenu configuration to the selection.
     *
     * @param {boolean} [useInstalledState] - seed the selection from what the
     *   probe found installed rather than from the saved manifest. Also allows
     *   the restore to proceed when there is no saved manifest at all.
     * @param {boolean} [render] - re-render the checkbox list afterwards
     * @returns {boolean} whether anything was restored
     */
    restorePreviousConfiguration(useInstalledState = false, render = true) {
        const selection = this.owner.selection;
        const detected = this.owner.detected;
        const previous = detected.previousConfiguration;
        if (!previous && !useInstalledState) return false;

        // Note this filter checks neither `available`, `disabled`,
        // `minimumVersion` nor `unsupportedDeviceReason`, unlike the default
        // seeding in `renderFeatureCheckboxes`. Restoring can therefore select a
        // feature the default path would refuse. That asymmetry is baseline
        // behavior; harmonising the two filters changes what gets installed.
        const previousIds = new Set(useInstalledState ? detected.installedFeatureIds : previous.selectedFeatureIds);
        selection.selectedFeatureIds = NICKELMENU_FEATURES.filter((feature) => !feature.hidden && (feature.required || previousIds.has(feature.id))).map(
            (feature) => feature.id,
        );

        // Each dialog adopts its own slice, with its own gate — the menu has none,
        // tabs and fonts require their feature id. The object-URL rebuild for a
        // restored icon lives in the menu dialog, where the icon does.
        this.owner.dialogs.adoptPrevious(previous, previousIds);

        this.owner.detected.previousConfigurationApplied = true;
        if (render) this.renderFeatureCheckboxes();
        return true;
    }

    /** Render the feature checkbox list from the registry and the session's selection. */
    renderFeatureCheckboxes() {
        const session = this.session;
        const selection = this.owner.selection;
        const detected = this.owner.detected;
        const deviceInfo = session.device?.deviceInfo;
        const firmware = deviceInfo?.firmware;
        // Hidden add-ons stay in the registry so existing installs can still be
        // detected and removed, but are omitted from the install catalogue.
        // Unavailable or disabled add-ons stay listed with an explanation.
        const features = NICKELMENU_FEATURES.filter((f) => !f.hidden);

        if (selection.selectedFeatureIds.length === 0) {
            selection.selectedFeatureIds = features
                .filter(
                    (f) =>
                        f.available !== false &&
                        !f.disabled &&
                        meetsMinimumVersion(firmware, f.minimumVersion) &&
                        !f.unsupportedDeviceReason?.(deviceInfo) &&
                        (f.required || f.default),
                )
                .map((f) => f.id);
        }

        const items = features.map((f) => {
            const unavailable = f.available === false || Boolean(f.disabled);
            const meetsMinimum = meetsMinimumVersion(firmware, f.minimumVersion);
            // A feature-owned device gate (e.g. NickelDissolve's allowlist):
            // a returned string disables the checkbox and is shown as the reason.
            const unsupportedReason = f.unsupportedDeviceReason?.(deviceInfo) || undefined;
            return {
                name: 'nm-cfg-' + f.id,
                title: f.title + (f.required ? ' (required)' : ''),
                version: typeof f.version === 'function' ? f.version() : f.version,
                description: f.description,
                hint: f.hint,
                experimental: f.experimental === true,
                previouslySelected: detected.previousFeatureIds.includes(f.id),
                currentlyInstalled: detected.installedFeatureIds.includes(f.id),
                sectionTitle: f.section,
                sectionCollapsed: COLLAPSED_SECTIONS.has(f.section),
                checked: selection.selectedFeatureIds.includes(f.id),
                disabled: f.required || !meetsMinimum || Boolean(unsupportedReason) || unavailable,
                disabledReason: featureDisabledReason(f, deviceInfo),
                actionLabel: f.customization?.actionLabel,
                actionAriaLabel: f.customization?.actionAriaLabel,
                onAction: f.customization ? (triggerEl) => this.owner.dialogs.open(f.customization.type, triggerEl) : undefined,
                ...(f.customization ? this.owner.dialogs.summaryItem(f.customization.type) : {}),
            };
        });
        renderNmCheckboxList(this.configOptions, items);

        for (const feature of features) {
            const cb = $q(`input[name="nm-cfg-${feature.id}"]`);
            if (!cb) continue;
            cb.addEventListener(
                'change',
                () => {
                    if (cb.checked) {
                        if (!selection.selectedFeatureIds.includes(feature.id)) {
                            selection.selectedFeatureIds.push(feature.id);
                        }
                    } else {
                        selection.selectedFeatureIds = selection.selectedFeatureIds.filter((id) => id !== feature.id);
                    }
                },
                { signal: this.listeners.signal },
            );
        }
    }

    /**
     * Show the sideload-mode banner when the device has no Kobo account, and
     * open the section that feature lives in so the recommendation is visible.
     *
     * Must run after `renderFeatureCheckboxes`: the section loop queries nodes
     * that render creates, and a later re-render would reset `section.open`.
     */
    async updateSideloadedRecommendation() {
        const banner = this.sideloadedBanner;
        const firmware = this.session.device?.deviceInfo?.firmware;
        const sideloaded = NICKELMENU_FEATURES.find((f) => f.id === 'sideloaded-mode');
        if (!meetsMinimumVersion(firmware, sideloaded?.minimumVersion)) {
            banner.hidden = true;
            return;
        }

        // No local try/catch: the caller's `.catch` is the only handler, and
        // adding one here would swallow the section-opening tail below as well.
        // A device read that fails already comes back as `null` rather than as a
        // rejection, because `countTableRows` catches its own errors.
        const userCount = await probeGetKoboUserCount(this.session);
        banner.hidden = userCount !== 0;

        if (userCount === 0) {
            for (const section of $qa('.nm-config-section', this.configOptions)) {
                const title = $q('.nm-config-section-title', section);
                if (title && title.textContent === sideloaded.section) section.open = true;
            }
        }
    }

    /**
     * The summary chip shown next to a feature's customize action, per
     * customization type (the Toggle-menu icon/label, tabs, or fonts dialog).
     */

    #wireListeners() {
        this.btnBack.addEventListener(
            'click',
            async () => {
                await this.owner.goBack();
            },
            { signal: this.listeners.signal },
        );

        this.btnUsePreviousConfiguration.addEventListener(
            'click',
            () => {
                this.restorePreviousConfiguration(false);
            },
            { signal: this.listeners.signal },
        );

        this.btnNext.addEventListener(
            'click',
            async () => {
                await this.owner.go('backup');
            },
            { signal: this.listeners.signal },
        );
    }
}
