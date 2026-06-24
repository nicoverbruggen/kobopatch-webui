import test from 'node:test';
import assert from 'node:assert/strict';

import { isFsaBlockedName } from '../../src/js/kobo/blocked-extensions.js';

test('flags extensions the File System Access API refuses to create', () => {
    assert.equal(isFsaBlockedName('settings.ini'), true);
    assert.equal(isFsaBlockedName('.adds/nickelclock/settings.ini'), true);
    assert.equal(isFsaBlockedName('SETTINGS.INI'), true, 'matching is case-insensitive');
    assert.equal(isFsaBlockedName('something.cfg'), true);
});

test('allows ordinary onboard payload names', () => {
    // Extensionless (the generated NickelMenu items file) and common asset types.
    assert.equal(isFsaBlockedName('.adds/nm/webui-preset'), false);
    assert.equal(isFsaBlockedName('.adds/nm/scripts/toggle_nickelclock.sh'), false);
    assert.equal(isFsaBlockedName('.adds/nm/.cog.png'), false);
    assert.equal(isFsaBlockedName('font.ttf'), false);
    // .conf is intentionally allowed: Kobo eReader.conf writes work in the field.
    assert.equal(isFsaBlockedName('Kobo eReader.conf'), false);
});
