import { NICKELMENU_FEATURES } from './features/index.js';
import { meetsMinimumVersion } from '../kobo/version.js';

// Pure derivations of the NickelMenu flow's decisions from the session. None of
// these touch the DOM: selections live in the session (the checkboxes are a view
// that writes into it), so "what gets installed / removed / reviewed" can be
// unit-tested without a browser. Mirrors the role PatchUI plays for the patches
// flow.

/** The feature module with this id, or undefined. */
export function featureById(id) {
    return NICKELMENU_FEATURES.find((f) => f.id === id);
}

/**
 * The subitems of a feature: the features that declare it as their `parent`.
 * A subitem is an add-on installed inside its parent's directory (a KOReader
 * plugin, say), so it only makes sense next to that parent. Nesting is one level
 * deep — a subitem is never itself a parent.
 */
export function subFeatures(parentId) {
    return NICKELMENU_FEATURES.filter((f) => f.parent === parentId);
}

/**
 * The singular of a parent's add-on label, shown as a badge beside a subitem's
 * name ("plugin"). A trailing-"s" strip is enough: these labels are ours,
 * declared in the feature modules, not user input.
 */
export function subFeatureNoun(parentId) {
    const label = (featureById(parentId)?.subFeaturesLabel || 'add-ons').toLowerCase();
    return label.endsWith('s') ? label.slice(0, -1) : label;
}

/**
 * The label of a subitem's checkbox on its parent's row. The kind of add-on it
 * is ("plugin") is not said here — it renders as a badge beside the name, from
 * `subFeatureNoun`.
 */
export function subFeatureCheckboxLabel(feature) {
    // `shortTitle` because a `title` reads as an action ("Install KOReader"),
    // which does not sit inside another sentence.
    return `Install ${feature.shortTitle || feature.title}`;
}

/**
 * Whether a parent feature's app will be on the device: either it is part of
 * this install, or it was already detected on the connected Kobo (so its
 * subitems can be added without reinstalling the parent).
 *
 * This decides whether a parent's subitem group is shown at all. The group is
 * hidden until the parent is covered rather than shown greyed out, so there is
 * no "requires X" copy anywhere — the plugins simply are not offered until
 * there is something to plug them into.
 */
export function parentIsCovered(parentId, session, selectedIds = session.selectedFeatureIds || []) {
    if (session.installedParentFeatureIds?.includes(parentId)) return true;
    return selectedIds.includes(parentId);
}

/**
 * The features that will actually be installed for the current session: the
 * required ones always, plus the user's selected ids, minus anything that is
 * hidden from the install catalogue, unavailable (asset not bundled), disabled
 * (a maintainer's temporary kill switch, `disabled: true` on the feature
 * module), needs a newer firmware than the connected device runs, does not
 * support the connected device (a feature's `unsupportedDeviceReason`), or is a
 * subitem whose parent is neither being installed nor already on the device.
 */
export function featuresToInstall(session, deviceInfo) {
    const firmware = deviceInfo?.firmware;
    const selected = NICKELMENU_FEATURES.filter((f) => {
        if (f.hidden || f.available === false || f.disabled) return false;
        if (!meetsMinimumVersion(firmware, f.minimumVersion)) return false;
        if (f.unsupportedDeviceReason?.(deviceInfo)) return false;
        if (f.required) return true;
        return session.selectedFeatureIds.includes(f.id);
    });

    // Drop orphaned subitems last, so a parent that was itself filtered out
    // above (unavailable, too-old firmware, ...) takes its subitems with it.
    // The list hides a subitem whose parent is missing, but a stale id can still
    // sit in the session after the parent was unticked, so this is the real gate.
    const selectedIds = selected.map((f) => f.id);
    return selected.filter((f) => !f.parent || parentIsCovered(f.parent, session, selectedIds));
}

/**
 * Installed, user-visible features that will be removed by the desired setup.
 *
 * Only ever non-empty when this tool's own preset is on the device. That is the
 * condition under which the feature list is preselected from what is installed,
 * so an unticked box means the user deliberately unticked it. Without the preset
 * nothing is preselected, and treating "installed but unticked" as "remove it"
 * would delete things the user never touched — a device with a manually
 * installed KOReader, say, would lose it the moment they installed anything else.
 */
export function featuresToRemove(session, deviceInfo) {
    if (!session.nmWebuiPresetInstalled) return [];
    const desired = new Set(featuresToInstall(session, deviceInfo).map((feature) => feature.id));
    const cleanupGroups = new Set();
    return NICKELMENU_FEATURES.filter(
        (feature) =>
            !feature.hidden &&
            feature.available !== false &&
            !feature.disabled &&
            meetsMinimumVersion(deviceInfo?.firmware, feature.minimumVersion) &&
            !feature.unsupportedDeviceReason?.(deviceInfo) &&
            session.installedNickelMenuFeatureIds?.includes(feature.id) &&
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
 *
 * A subitem waiting on its parent is not a reason: its whole group is hidden
 * until the parent is covered, so it is never a row the user can look at.
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

/**
 * Of the detected optional cleanups, the ones the user checked for removal.
 * Subitems never appear here: `probes.js` does not detect them, because their
 * files sit inside their parent's directory and go when it does.
 */
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
 */
export function nmReviewModel(session, detected, deviceInfo) {
    if (session.nickelMenuOption === 'remove') {
        return {
            mode: 'remove',
            removedFeatures: optionalCleanupToRemove(session, detected),
            keptFeatures: optionalCleanupKept(session, detected),
        };
    }

    // The only remaining install option is the preset (the "NickelMenu only" barebones option was
    // removed); a preset install always carries its curated feature set.
    const installFeatures = featuresToInstall(session, deviceInfo);
    return {
        mode: session.nickelMenuOption,
        installFeatures,
        removedFeatures: featuresToRemove(session, deviceInfo),
        notices: featureReviewNotices(installFeatures, deviceInfo),
    };
}
