/**
 * features/index.js — the NickelMenu feature registry.
 *
 * The single ordered list of every available feature module. The flow renders
 * and selects from it, and probes/selection read it to reason about what can be
 * installed or cleaned up. The installer is given a chosen subset of these and
 * never reads the registry itself, so the catalog lives here, separate from the
 * install mechanics.
 */

import customMenu from './custom-menu/index.js';
import nickelclock from './nickelclock/index.js';
import additionalFonts from './additional-fonts/index.js';
import betterTypography from './better-typography/index.js';
import cadmus from './cadmus/index.js';
import koreader from './koreader/index.js';
import simplifyTabs from './simplify-tabs/index.js';
import { homeHiders } from './hide-home-content/index.js';
import screensaver from './screensaver/index.js';
import excludeCalibre from './exclude-calibre/index.js';
import sideloadedMode from './sideloaded-mode/index.js';
import nickelCoverFix from './nickel-cover-fix/index.js';
import nickelDissolve from './nickel-dissolve/index.js';

/**
 * All available NickelMenu features in display order.
 * Features with `required: true` are always included in the preset.
 * Features with `postProcess` modify files produced by other features.
 */
export const NICKELMENU_FEATURES = [
    customMenu,
    simplifyTabs, // postProcess must run before sideloadedMode (home-tab override)
    ...homeHiders,
    // "Reading Experience" section.
    additionalFonts,
    betterTypography,
    nickelclock, // merges its own KoboRoot.tgz payload via koboRootEntries
    nickelDissolve, // sits below NickelClock in Reading Experience; merges its own KoboRoot.tgz payload
    // "Alternative reading apps" section — collapsed by default.
    koreader,
    cadmus,
    // "Advanced" section — less common power-user options, collapsed by default
    // in the feature selection step.
    sideloadedMode, // postProcess comments out the home-tab override added by simplifyTabs
    nickelCoverFix, // merges its own KoboRoot.tgz payload via koboRootEntries
    // "Legacy" section — older tweaks, rendered last and collapsed by default.
    screensaver,
    excludeCalibre,
];

/**
 * Deduped analytics event names for a set of selected features. Every feature
 * declares an `analyticsEvent` (a name to track when it is installed, or null
 * for features where tracking carries no signal) — a unit test enforces the
 * key exists so a new feature can't be added without deciding on tracking.
 * Related features may share one event (the home-content hiders all map to
 * 'add-minimal-home'), which is why this dedupes.
 */
export function featureAnalyticsEvents(features) {
    return [...new Set(features.map((feature) => feature.analyticsEvent).filter(Boolean))];
}
