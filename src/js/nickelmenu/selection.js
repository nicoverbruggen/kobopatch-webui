import { NICKELMENU_FEATURES } from './features/index.js';
import { meetsMinimumVersion } from '../kobo/version.js';

// Pure derivations of the NickelMenu flow's decisions. None of these touch the
// DOM: the choices live in a `NickelMenuSelection` (the checkboxes are a view
// that writes into it) and what the device already has lives in a
// `DetectedInstallation`, so "what gets installed / removed / reviewed" can be
// unit-tested without a browser. Mirrors the role PatchUI plays for the patches
// flow.
//
// These take the two objects rather than the session because that is all they
// read — narrowing them was the point of the Phase 3 split.

/**
 * The features that will actually be installed for the current session: the
 * required ones always, plus the user's selected ids, minus anything that is
 * hidden from the install catalogue, unavailable (asset not bundled), disabled
 * (a maintainer's temporary kill switch, `disabled: true` on the feature
 * module), needs a newer firmware than the connected device runs, or does not
 * support the connected device (a feature's `unsupportedDeviceReason`).
 */
export function featuresToInstall(selection, deviceInfo) {
    const firmware = deviceInfo?.firmware;
    return NICKELMENU_FEATURES.filter((f) => {
        if (f.hidden || f.available === false || f.disabled) return false;
        if (!meetsMinimumVersion(firmware, f.minimumVersion)) return false;
        if (f.unsupportedDeviceReason?.(deviceInfo)) return false;
        if (f.required) return true;
        return selection.selectedFeatureIds.includes(f.id);
    });
}

/**
 * Installed, user-visible features that will be removed by the desired setup.
 *
 * @param {object} selection - the user's NickelMenu choices
 * @param {string[]} installedFeatureIds - what the device probe found installed
 * @param {object} deviceInfo
 */
export function featuresToRemove(selection, installedFeatureIds, deviceInfo) {
    const desired = new Set(featuresToInstall(selection, deviceInfo).map((feature) => feature.id));
    const cleanupGroups = new Set();
    return NICKELMENU_FEATURES.filter(
        (feature) =>
            !feature.hidden &&
            feature.available !== false &&
            !feature.disabled &&
            meetsMinimumVersion(deviceInfo?.firmware, feature.minimumVersion) &&
            !feature.unsupportedDeviceReason?.(deviceInfo) &&
            installedFeatureIds?.includes(feature.id) &&
            !desired.has(feature.id) &&
            (feature.modifyCleanup || feature.cleanup),
    ).filter((feature) => {
        const cleanup = feature.modifyCleanup || feature.cleanup;
        if (cleanupGroups.has(cleanup)) return false;
        cleanupGroups.add(cleanup);
        return true;
    });
}

/**
 * The reason a feature's checkbox is disabled in the config step, or `undefined`
 * when it is selectable. Ordered by authority: a maintainer kill switch
 * (`disabled`) is global so it wins — a string value is shown verbatim, `true`
 * falls back to the generic text; then a too-old firmware, then a feature's own
 * device gate (`unsupportedDeviceReason`), then an unbundled asset. `required`
 * features have no reason (they are locked on, not unavailable).
 */
export function featureDisabledReason(feature, deviceInfo) {
    if (feature.disabled) return typeof feature.disabled === 'string' ? feature.disabled : 'Temporarily unavailable.';
    const firmware = deviceInfo?.firmware;
    if (!meetsMinimumVersion(firmware, feature.minimumVersion)) {
        return `Requires Kobo software ${feature.minimumVersion} or newer (this device runs ${firmware}).`;
    }
    const unsupported = feature.unsupportedDeviceReason?.(deviceInfo);
    if (unsupported) return unsupported;
    if (feature.available === false) return 'Temporarily unavailable.';
    return undefined;
}

/** Features whose cleanup always runs on removal, regardless of selection. */
export function alwaysCleanupFeatures() {
    return NICKELMENU_FEATURES.filter((f) => f.cleanup?.mode === 'always');
}

/** Of the detected optional cleanups, the ones the user checked for removal. */
export function optionalCleanupToRemove(selection, cleanupFeatures) {
    return cleanupFeatures.filter((f) => selection.optionalCleanupIds.includes(f.id));
}

/** Of the detected optional cleanups, the ones the user left unchecked (kept). */
export function optionalCleanupKept(selection, cleanupFeatures) {
    return cleanupFeatures.filter((f) => !selection.optionalCleanupIds.includes(f.id));
}

/** Review notices contributed by a set of features, for the connected device. */
export function featureReviewNotices(features, deviceInfo) {
    const ctx = { deviceInfo };
    const all = features.flatMap((feature) => (feature.reviewNotices ? feature.reviewNotices(ctx) : []));
    // De-duplicate identical notices: several generated features (the home-screen
    // hiders) can each contribute the same shared NickelHome notice, but it should
    // appear once.
    const seen = new Set();
    return all.filter((notice) => {
        const key = JSON.stringify(notice);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * The structured model the review step renders. Returns data (feature objects,
 * notices) rather than display strings — the flow maps those to copy and DOM.
 *
 * @param {object} selection - the user's NickelMenu choices
 * @param {object} detected - what probing the device turned up
 * @param {object} deviceInfo
 */
export function nmReviewModel(selection, detected, deviceInfo) {
    const cleanupFeatures = detected.optionalCleanupFeatures;
    if (selection.option === 'remove') {
        return {
            mode: 'remove',
            removedFeatures: optionalCleanupToRemove(selection, cleanupFeatures),
            keptFeatures: optionalCleanupKept(selection, cleanupFeatures),
        };
    }

    // The only remaining install option is the preset (the "NickelMenu only" barebones option was
    // removed); a preset install always carries its curated feature set.
    const installFeatures = featuresToInstall(selection, deviceInfo);
    return {
        mode: selection.option,
        installFeatures,
        removedFeatures: featuresToRemove(selection, detected.installedFeatureIds, deviceInfo),
        notices: featureReviewNotices(installFeatures, deviceInfo),
    };
}
