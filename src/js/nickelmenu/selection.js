import { NICKELMENU_FEATURES } from './features/index.js';
import { meetsMinimumVersion } from '../kobo/version.js';

// Pure derivations of the NickelMenu flow's decisions from the session. None of
// these touch the DOM: selections live in the session (the checkboxes are a view
// that writes into it), so "what gets installed / removed / reviewed" can be
// unit-tested without a browser. Mirrors the role PatchUI plays for the patches
// flow.

/**
 * The features that will actually be installed for the current session: the
 * required ones always, plus the user's selected ids, minus anything that is
 * unavailable (asset not bundled), disabled (a maintainer's temporary
 * kill switch, `disabled: true` on the feature module), needs a newer firmware
 * than the connected device runs, or does not support the connected device
 * (a feature's `unsupportedDeviceReason`).
 */
export function featuresToInstall(session, deviceInfo) {
    const firmware = deviceInfo?.firmware;
    return NICKELMENU_FEATURES.filter((f) => {
        if (f.available === false || f.disabled) return false;
        if (!meetsMinimumVersion(firmware, f.minimumVersion)) return false;
        if (f.unsupportedDeviceReason?.(deviceInfo)) return false;
        if (f.required) return true;
        return session.selectedFeatureIds.includes(f.id);
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
export function optionalCleanupToRemove(session, detected) {
    return detected.filter((f) => session.nmOptionalCleanupIds.includes(f.id));
}

/** Of the detected optional cleanups, the ones the user left unchecked (kept). */
export function optionalCleanupKept(session, detected) {
    return detected.filter((f) => !session.nmOptionalCleanupIds.includes(f.id));
}

/** Review notices contributed by a set of features, for the connected device. */
export function featureReviewNotices(features, deviceInfo) {
    const ctx = { deviceInfo };
    return features.flatMap((feature) => (feature.reviewNotices ? feature.reviewNotices(ctx) : []));
}

/**
 * The structured model the review step renders. Returns data (feature objects,
 * notices) rather than display strings — the flow maps those to copy and DOM.
 */
export function nmReviewModel(session, detected, deviceInfo) {
    if (session.nickelMenuOption === 'remove') {
        return {
            mode: 'remove',
            removedFeatures: optionalCleanupToRemove(session, detected),
            keptFeatures: optionalCleanupKept(session, detected),
        };
    }

    const installFeatures = session.nickelMenuOption === 'preset' ? featuresToInstall(session, deviceInfo) : [];
    return {
        mode: session.nickelMenuOption,
        installFeatures,
        notices: featureReviewNotices(installFeatures, deviceInfo),
    };
}
