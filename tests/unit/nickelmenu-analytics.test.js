import test from 'node:test';
import assert from 'node:assert/strict';

import { NICKELMENU_FEATURES, featureAnalyticsEvents } from '../../src/js/nickelmenu/features/index.js';

// Every feature must decide on tracking explicitly: an 'add-*' event name, or
// null when an install event would carry no signal (e.g. required features).
// This is what makes it impossible to add a feature and forget analytics — a
// missing key fails here, not silently in the dashboard.
test('every feature declares an analyticsEvent (string or explicit null)', () => {
    for (const feature of NICKELMENU_FEATURES) {
        assert.ok(Object.hasOwn(feature, 'analyticsEvent'), `feature "${feature.id}" must declare analyticsEvent ('add-...' or null)`);
        const event = feature.analyticsEvent;
        assert.ok(event === null || (typeof event === 'string' && event.startsWith('add-')), `feature "${feature.id}" has invalid analyticsEvent "${event}"`);
    }
});

// Pins the full catalog-to-event mapping so renaming an event (which would
// break dashboard continuity) is a deliberate act. Adding a feature means
// adding its event here — the failure is the reminder.
test('the full catalog maps to the expected event set', () => {
    assert.deepEqual(featureAnalyticsEvents(NICKELMENU_FEATURES).sort(), [
        'add-basic-tabs',
        'add-cadmus',
        'add-exclude-calibre',
        'add-fonts',
        'add-koreader',
        'add-minimal-home',
        'add-nickelclock',
        'add-nickelcoverfix',
        'add-nickeldissolve',
        'add-nickeltypefix',
        'add-screensaver',
        'add-sideloaded-mode',
        'add-simpleui',
    ]);
});

test('the home-content hiders share the add-minimal-home event', () => {
    const hiders = NICKELMENU_FEATURES.filter((f) => f.analyticsEvent === 'add-minimal-home');
    assert.equal(hiders.length, 3);
    assert.deepEqual(featureAnalyticsEvents(hiders), ['add-minimal-home']);
});

test('featureAnalyticsEvents dedupes and skips untracked features', () => {
    const byId = new Map(NICKELMENU_FEATURES.map((f) => [f.id, f]));
    const selection = [
        byId.get('custom-menu'), // analyticsEvent: null — must not appear
        byId.get('hide-recommendations'),
        byId.get('hide-notices'), // same event as the previous hider
        byId.get('koreader'),
    ];
    assert.deepEqual(featureAnalyticsEvents(selection).sort(), ['add-koreader', 'add-minimal-home']);
});

test('an empty selection produces no events', () => {
    assert.deepEqual(featureAnalyticsEvents([]), []);
});
