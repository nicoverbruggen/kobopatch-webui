import { NICKELMENU_FEATURES } from './installer.js';
import { meetsMinimumVersion } from '../kobo/version.js';

// Pure derivations of the NickelMenu flow's decisions from the session. None of
// these touch the DOM: selections live in the session (the checkboxes are a view
// that writes into it), so "what gets installed / removed / reviewed" can be
// unit-tested without a browser. Mirrors the role PatchUI plays for the patches
// flow.

/**
 * The features that will actually be installed for the current session: the
 * required ones always, plus the user's selected ids, minus anything that is
 * unavailable or needs a newer firmware than the connected device runs.
 */
export function featuresToInstall(session, deviceInfo) {
    const firmware = deviceInfo?.firmware;
    return NICKELMENU_FEATURES.filter((f) => {
        if (f.available === false) return false;
        if (!meetsMinimumVersion(firmware, f.minimumVersion)) return false;
        if (f.required) return true;
        return session.selectedFeatureIds.includes(f.id);
    });
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
