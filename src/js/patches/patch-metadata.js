/**
 * patch-metadata.js — Presentation metadata for the patch catalog.
 *
 * The kobopatch YAML is the source of truth for patch *behavior*; it is left
 * untouched so it stays valid for stock kobopatch and easy to re-sync from
 * upstream. This module is a webui-only layer that decides how patches are
 * *presented*: which user-facing theme they group under, a friendlier display
 * label, author credit, and polished prose (description/note/customization
 * tips). Everything here is keyed by the exact patch name (the YAML key), which
 * is unique across the catalog and never renamed — so manifests and the
 * blacklist keep keying by name with no migration.
 *
 * `scripts/check-patch-metadata.mjs` (run by `npm run verify`/`npm run test`)
 * fails if any patch in the `patches/<version>/src` YAML is missing an entry or
 * a `category`, so the map can't silently drift as the YAML changes.
 */

/**
 * Ordered list of user-facing themes. Render order = this order; any patch whose
 * category isn't listed here (including the `other` fallback) falls into a
 * trailing "Other" section.
 */
export const PATCH_CATEGORIES = [
    { id: 'typography', label: 'Typography & Fonts' },
    { id: 'layout', label: 'Margins & Layout' },
    { id: 'home', label: 'Home & Library' },
    { id: 'header-footer', label: 'Reading Header & Footer' },
    { id: 'dictionary', label: 'Dictionary & Lookup' },
    { id: 'keyboards', label: 'Keyboard' },
    { id: 'input', label: 'Buttons & Gestures' },
    { id: 'power', label: 'Power & Sleep' },
    { id: 'features', label: 'Privacy & Features' },
    { id: 'pdf', label: 'PDF' },
    { id: 'sync', label: 'Cloud Sync' },
];

/** The trailing catch-all section for patches with no (known) category. */
export const OTHER_CATEGORY = { id: 'other', label: 'Other' };

/**
 * Friendly per-file section names for the "original format" view — the patch list
 * can optionally fall back to grouping by source file (the way patches are listed
 * on the MobileRead forums) instead of by theme. Used only by that toggle.
 */
export const PATCH_FILE_LABELS = {
    'src/nickel.yaml': 'Nickel (UI patches)',
    'src/nickel_custom.yaml': 'Nickel Custom',
    'src/libadobe.so.yaml': 'Adobe (PDF patches)',
    'src/libnickel.so.1.0.0.yaml': 'Nickel Library (core patches)',
    'src/librmsdk.so.1.0.0.yaml': 'Adobe RMSDK (ePub patches)',
    'src/cloud_sync.yaml': 'Cloud Sync',
};

/**
 * Per-patch metadata, keyed by the exact YAML patch name.
 *
 * - `category` (required): one of the `PATCH_CATEGORIES` ids (or `other`).
 * - `label` (optional): overrides the displayed name only; the YAML key is
 *   unchanged, so it stays the patch's stable identity.
 * - `author` (optional): shown in the notes. Credit whoever actually wrote the
 *   code that ships here, and leave it out when that can't be established.
 *   The `# The following patch(es) are by X` comments in the YAML are NOT a
 *   reliable source: the upstream collection groups patches into per-author
 *   blocks, and later contributions get appended to whichever block they were
 *   pasted into, so a patch can sit under a name that never touched it. Check
 *   the MobileRead thread the patch was posted in before adding or keeping a
 *   name here. A wrong name here makes someone answerable for code they have
 *   never read. Where a patch was later rewritten by someone else, credit both
 *   (`Original, updated by Other`).
 *
 *   Every credit below was checked against pgaskin/kobopatch-patches. That repo
 *   does split patches into real per-author files: under each version, a patch
 *   file is a directory holding `geoffr.yaml`, `jackie_w.yaml`, `sherman.yaml`
 *   and so on. Re-run the check there. It confirms 95 of the credits, and those
 *   need no comment. The patches it does not cover, because they were written
 *   later or because it credits someone else, carry a comment naming the post
 *   or issue the credit came from. Add one when you introduce such a patch.
 * - `description` (optional): replaces the displayed blurb. Falls back to the
 *   parsed YAML `Description:` when absent.
 * - `note` (optional): short extra context (a caveat, "no effect on X", etc.)
 *   rendered under the description.
 * - `tips` (optional): array of short instructions shown in the patch *editor*,
 *   where a user actually changes values (these replace the old YAML comments).
 */
export const PATCH_META = {
    // ── Typography & Fonts ────────────────────────────────────────────────
    // Written by jackie_w as an unofficial patch, and pgaskin agreed to ship
    // that version if anyone wanted font-size control. The collection files it
    // under GeoffR, who did not write it.
    // https://github.com/pgaskin/kobopatch-patches/issues/55
    'test Pop-up footnote main text font-size': {
        category: 'typography',
        label: 'Pop-up footnote text size',
        author: 'jackie_w',
        description: 'Changes the font size of the main text shown in pop-up footnotes.',
        tips: ['Edit the `font-size` value in the `Replace` line (default `34px`).'],
    },
    'My 10 line spacing values': {
        category: 'typography',
        author: 'GeoffR',
        description: 'Replaces the line-spacing slider values, reducing the number of options from 15 to 10 but allowing much narrower spacing.',
        note: 'Very narrow spacing can cause page-break problems in some KePubs depending on the font.',
        tips: ['Edit the ten `ReplaceFloat` values near the top of the patch to set your preferred spacings.'],
    },
    'My 24 line spacing values': {
        category: 'typography',
        author: 'GeoffR',
        description: 'Replaces the line-spacing slider values, increasing the number of options from 15 to 24 and allowing much narrower spacing.',
        note: 'Very narrow spacing can cause page-break problems in some KePubs depending on the font.',
        tips: [
            'Edit the 24 `ReplaceFloat` values to set your preferred spacings.',
            'On lower-resolution devices, spread the values further apart so each slider step makes a visible difference.',
        ],
    },
    'Custom font sizes': {
        category: 'typography',
        author: 'GeoffR, rewritten by shermp',
        description: 'Reshapes the font-size slider so there are more small sizes and fewer large ones, allowing finer adjustment of small text.',
        note: 'The very largest font sizes are no longer selectable.',
        tips: ['Adjust the `ReplaceInt` values; see the per-device size tables in the patch comments.'],
    },
    'Set KePub hyphenation': {
        category: 'typography',
        author: 'GeoffR',
        description: 'Always turns on hyphenation in KePubs, regardless of the justification button setting (the publisher can still override it).',
    },
    'Force user line spacing in KePubs': {
        category: 'typography',
        author: 'GeoffR',
        description:
            'Forces the slider line spacing to take effect in problem KePubs with fixed line spacing. May override spacing that is better left alone (e.g. raise-cap paragraphs).',
    },
    'Force user line spacing in ePubs (part 1 of 2)': {
        category: 'typography',
        label: 'Force user line spacing in ePubs (part 1 of 2)',
        author: 'GeoffR',
        description: 'Stops a book stylesheet line-height from being recognised so the slider spacing takes effect. Part 1 of 2.',
        note: 'Two-part patch: also enable “Force user line spacing in ePubs (part 2 of 2)” for it to work.',
    },
    'Force user line spacing in ePubs (Part 2 of 2)': {
        category: 'typography',
        label: 'Force user line spacing in ePubs (part 2 of 2)',
        author: 'GeoffR',
        description: 'Stops a book stylesheet line-height from being recognised so the slider spacing takes effect. Part 2 of 2.',
        note: 'Two-part patch: also enable “Force user line spacing in ePubs (part 1 of 2)” for it to work.',
    },
    'Un-force font-family override p tags (std epubs)': {
        category: 'typography',
        label: 'Let publisher set ePub paragraph font',
        author: 'GeoffR',
        description: 'Lets the publisher’s paragraph font in the ePub stylesheet override the font selected on the device.',
    },
    'Force user font-family in ePubs (Part 1 of 2)': {
        category: 'typography',
        label: 'Force user font-family in ePubs (part 1 of 2)',
        author: 'GeoffR',
        description: 'Stops a book stylesheet font-family from being recognised so the device font takes effect. Part 1 of 2.',
        note: 'Two-part patch: also enable the standalone “Force user font-family in ePubs (part 2 of 2)” for it to work.',
    },
    'Force user font-family in ePubs (Part 2 of 2)': {
        category: 'typography',
        label: 'Force user font-family in ePubs (part 2 of 2)',
        author: 'GeoffR',
        description: 'Stops a book stylesheet font-family from being recognised so the device font takes effect. Part 2 of 2.',
        note: 'Two-part patch: also select “Force user font-family in ePubs (part 1 of 2)” in the “ePub force font alternatives” group for it to work.',
    },
    'ePub constant font sharpness': {
        category: 'typography',
        author: 'GeoffR',
        description: 'Uses a constant ePub font sharpness of 0.2 instead of the value from the advanced sharpness/weight slider.',
        tips: ['Change `0.2` in the `Replace` value to taste (slider range is −0.4 to 0.2).'],
    },
    'Un-Force user text-align in div,p tags in KePubs': {
        category: 'typography',
        label: 'Let publisher set KePub text alignment',
        author: 'GeoffR',
        description: 'Lets the publisher’s text alignment in the KePub stylesheet override the alignment selected on the device.',
    },
    'Un-Force user font-family in KePubs': {
        category: 'typography',
        author: 'GeoffR',
        description: 'Lets a publisher-selected font in the KePub stylesheet coexist with the device font, allowing a mix of fonts.',
        tips: ['The patch ships “Alternative 2”. To use a different preference, comment it out and uncomment Alternative 1 or 3.'],
    },
    'Un-force link decoration in KePubs': {
        category: 'typography',
        author: 'GeoffR',
        description: 'Disables the dotted underline and grey colour applied to links in the KePub stylesheet.',
    },
    'KePub stylesheet additions - text justify': {
        category: 'typography',
        label: 'KePub default: full justification',
        author: 'jackie_w',
        description: 'Makes full justification the default in KePubs.',
        note: 'Mutually exclusive with “KePub stylesheet additions - word-spacing”.',
    },
    'KePub stylesheet additions - word-spacing': {
        category: 'typography',
        label: 'KePub reduced word spacing',
        author: 'jackie_w',
        description: 'Reduces the space between words in KePubs. Mostly useful when reading with full justification.',
        note: 'Mutually exclusive with “KePub stylesheet additions - text justify”.',
        tips: ['Tune the `-0.05em` value; too large and words may run together.'],
    },
    'Unify font sizes': {
        category: 'typography',
        author: 'shermp',
        description: 'Attempts to match ePub and KePub font sizes so the same size setting looks consistent across both formats.',
    },
    'Default ePub serif font': {
        category: 'typography',
        author: 'GeoffR',
        description: 'Changes the default ePub serif font (used for `font-family: serif`) from Rakuten Serif to another font.',
        note: 'Does not affect KePubs.',
        tips: ['Replace `Bitter` in each `Replace` line with your font name (15 chars max).', 'Use `%20` for spaces, e.g. `Noto%20Serif`.'],
    },
    'Default ePub serif font (Amasis)': {
        category: 'typography',
        author: 'GeoffR',
        description: 'Changes the default ePub serif font (used for `font-family: serif`) from Rakuten Serif to another font.',
        note: 'Does not affect KePubs.',
        tips: ['Replace the font name in each `Replace` line (use `%20` for spaces).'],
    },
    'Default ePub sans-serif font': {
        category: 'typography',
        author: 'GeoffR',
        description: 'Changes the default ePub sans-serif font (used for `font-family: sans-serif`) from Rakuten Sans to another font.',
        note: 'Does not affect KePubs.',
        tips: ['Replace `Noto%20Sans` in each `Replace` line with your font name (14 chars max).', 'Use `%20` for spaces.'],
    },
    'Default ePub sans-serif font (Gill Sans)': {
        category: 'typography',
        author: 'GeoffR',
        description: 'Changes the default ePub sans-serif font (used for `font-family: sans-serif`) from Rakuten Sans to another font.',
        note: 'Does not affect KePubs.',
        tips: ['Replace the font name in each `Replace` line (use `%20` for spaces).'],
    },
    'Default ePub symbol font (Symbol)': {
        category: 'typography',
        author: 'GeoffR',
        description: 'Sets the default ePub symbol font.',
    },
    'Default ePub monospace font': {
        category: 'typography',
        author: 'jackie_w',
        description: 'Maps `font-family: monospace` in ePubs to a sideloaded font. You only need this if your monospace font is not named “Courier”.',
        note: 'Does not affect KePubs.',
        tips: ['Replace `Courier` in each `Replace` line with your sideloaded font name (7 chars max).'],
    },

    // ── Margins & Layout ──────────────────────────────────────────────────
    'Reduce top/bottom page spacer': {
        category: 'layout',
        author: 'GeoffR',
        description: 'Halves the blank space left at the top/bottom of a page when chapter/book progress is set to Off. Affects ePub and KePub.',
        tips: ['Edit the `min-height`/`max-height` values in the `Replace` lines for your device.'],
    },
    'Custom left & right margins': {
        category: 'layout',
        author: 'GeoffR',
        description: 'Sets the margin sizes added by the margin slider, as a percentage of screen width.',
        tips: ['Edit the nine `ReplaceInt` values (each is a percentage of screen width).'],
    },
    'ePub fixed top/bottom margins': {
        category: 'layout',
        author: 'GeoffR',
        description: 'Sets fixed custom @page margins in ePubs, overriding the book’s CSS @page margins (XPGT margins are unaffected).',
        note: 'Mutually exclusive with “ePub disable built-in body padding-bottom”.',
        tips: ['Set the two-digit pixel values in the `ReplaceString` lines for top, bottom, and minimum left/right margins.'],
    },
    'ePub disable built-in body padding-bottom': {
        category: 'layout',
        author: 'GeoffR',
        description: 'Disables the built-in stylesheet entry that pads the bottom of the body element in ePubs.',
        note: 'Mutually exclusive with “ePub fixed top/bottom margins”.',
    },
    'Custom kepub default margins': {
        category: 'layout',
        author: 'GeoffR',
        description: 'Sets the built-in minimum KePub/Pocket margin to zero, matching ePubs. Affects left/right in normal mode and all four in full-screen.',
    },
    'Disable orphans/widows avoidance': {
        category: 'layout',
        author: 'GeoffR',
        description: 'Avoids extra blank lines at the bottom of ePub pages by effectively forcing `orphans:1; widows:1;`.',
    },
    'Ignore ePub book Adobe XPGT stylesheet (page-template.xpgt)': {
        category: 'layout',
        label: 'Ignore ePub Adobe XPGT stylesheet',
        author: 'GeoffR',
        description:
            'Causes any Adobe XPGT stylesheet in the book to be ignored (often the source of unwanted extra margins), while the CSS stylesheet is still used.',
    },
    'Ignore ePub book CSS and Adobe XPGT stylesheets': {
        category: 'layout',
        author: 'GeoffR',
        description: 'Ignores both the book’s CSS and Adobe XPGT stylesheets. Most people will not want this.',
    },
    'Ignore ePub TOC navpoints': {
        category: 'layout',
        author: 'GeoffR',
        description: 'Ignores the ePub table-of-contents navpoints. Most people will not want this.',
    },
    'Change TOC level indentation': {
        category: 'layout',
        author: 'pgaskin (geek1011)',
        description: 'Changes the per-level indentation width in the table of contents.',
        tips: ['Edit the `qproperty-indentUnit` `Replace` values per device (the defaults halve the firmware width).'],
    },

    // ── Home & Library ────────────────────────────────────────────────────
    'Increase home screen cover size': {
        category: 'home',
        author: 'GeoffR',
        description: 'Reduces the home-screen margins so cover images can be larger.',
    },
    'Custom synopsis details line spacing': {
        category: 'home',
        label: 'Book-details synopsis line spacing',
        author: 'GeoffR',
        description: 'Sets the line spacing of the synopsis text on the book details page.',
    },
    'Custom synopsis font size': {
        category: 'home',
        label: 'Book-details synopsis font size',
        author: 'GeoffR',
        description: 'Increases the font size of the synopsis text on the book details page.',
        tips: ['Edit the `font-size` `Replace` values for your device.'],
    },
    'Increase Book Details synopsis area': {
        category: 'home',
        author: 'jackie_w',
        description: 'Enlarges the synopsis area on the book details page by shrinking the cover/title/author area above it.',
    },
    'Increase library cover size': {
        category: 'home',
        author: 'jackie_w',
        description: 'Increases the cover thumbnail size in the My Books list.',
    },
    'Custom collection/author header title font': {
        category: 'home',
        author: 'jackie_w',
        description: 'Changes the font appearance of the Collection and Author list headers.',
        note: 'Since firmware 4.32, the ability to change font-family in a patch is very limited.',
        tips: ['Edit the `font-size` `Replace` values; uncomment the `font-family` line to change the family.'],
    },
    'Series list increase cover thumbnails': {
        category: 'home',
        author: 'jackie_w',
        description: 'Increases the cover thumbnail size in the Series list view (not the Series cover view).',
    },
    'Increase headlines font': {
        category: 'home',
        author: 'oren64',
        description: 'Increases the font size of the tab header labels (My Books, Activity, Bookstore, …).',
        tips: ['Edit the `font-size` `Replace` values per device.'],
    },
    'New home screen subtitle custom font': {
        category: 'home',
        author: 'oren64',
        description: 'Changes the home-screen subtitle (lower-label) font size/colour and the upper-label font size.',
        note: 'Works best with “Increase home screen cover size”.',
    },
    'Remove footer (row3) and increase cover size on new home screen': {
        category: 'home',
        label: 'Bigger covers + hide footer row (home)',
        author: 'oren64',
        description: 'Combines “Increase home screen cover size” and “Remove footer (row3) on new home screen”.',
    },
    'Remove footer (row3) on new home screen': {
        category: 'home',
        label: 'Hide home-screen footer row',
        author: 'oren64',
        description: 'Hides the footer row (row3) on the home screen.',
    },
    'Remove recommendations (row1col2) from home screen': {
        category: 'home',
        label: 'Hide home-screen recommendations',
        author: 'pgaskin (geek1011)',
        description: 'Hides the recommendations column shown in the top-right of the home screen when fewer than 2 books are open.',
    },
    'Rename new home screen footer': {
        category: 'home',
        author: 'pgaskin (geek1011)',
        description: 'Lets you rename the home-screen footer text.',
        tips: ['Edit the `Replace` strings; note a replacement may change a matching letter on the keyboard.'],
    },
    'Change Browse Kobo home screen link target - Activity': {
        category: 'home',
        label: 'Point "Browse Kobo" link to Activity',
        author: 'pgaskin (geek1011)',
        description: 'Re-points the “Browse Kobo” home-screen link to the Activity view.',
    },
    'Set visible SmartLink': {
        category: 'home',
        author: 'pgaskin (geek1011)',
        description: 'Sets which SmartLink is shown on the home screen (does not override priority messages).',
        tips: ['Set the `ReplaceInt` value to a SmartLink id from the table in the patch comments.'],
    },
    'Only show Pocket SmartLink': {
        category: 'home',
        author: 'pgaskin (geek1011)',
        description: 'Only shows the Pocket SmartLink on the home screen.',
    },
    'Only show stats SmartLink': {
        category: 'home',
        author: 'pgaskin (geek1011)',
        description: 'Only shows the reading-stats SmartLink on the home screen.',
    },
    'Never show Kobo Plus, wishlist, and points SmartLinks': {
        category: 'home',
        author: 'pgaskin (geek1011)',
        description: 'Removes the Kobo Plus, wishlist, and Super Points SmartLinks from the home-screen rotation.',
    },
    // pgaskin's "Increase size of kepub chapter progress chart", extended by
    // jackie_w to cover audiobooks and to drop the BaseAddress that had to be
    // re-found every firmware, which is also why the name changed. jackie_w
    // quoted in the release thread:
    // https://www.mobileread.com/forums/showpost.php?p=4590569
    'Increase size of kepub/audio chapter progress chart': {
        category: 'home',
        author: 'pgaskin (geek1011), extended by jackie_w',
        description: 'Increases the size of the KePub and audiobook chapter progress bar charts in the reading menu.',
    },
    // By jackie_w, written because the byte-patch variant below (which is
    // pgaskin's) has no effect on the Clara BW. Not part of the upstream
    // collection; it reached this project via Phil_C, who posted it here:
    // https://www.mobileread.com/forums/showpost.php?p=4593597
    'Remove line from bottom tab bar via CSS': {
        category: 'home',
        label: 'Remove line from bottom tab bar via CSS',
        author: 'jackie_w',
        description: 'Removes the line along the top of the bottom navigation tab bar (CSS-based). This variant only works on newer devices and uses CSS.',
        note: 'Use this variant on the Clara BW, where the byte-patch variant has no effect.',
    },
    'Remove line from bottom tab bar': {
        category: 'home',
        label: 'Remove line from bottom tab bar',
        author: 'pgaskin (geek1011)',
        description: 'Removes the line along the top of the bottom navigation tab bar. This variant only works on older devices and hides the QWidget.',
    },
    'beta Increase width available for book Title in Booklists - Storm only': {
        category: 'home',
        label: 'Wider book titles in booklists (Libra only)',
        author: 'jackie_w',
        description: 'On Libra H2O / Libra 2 only, widens the space available for book titles in booklists and tunes related fonts/margins.',
        note: 'Not suitable for Chinese (HK) locale users.',
    },

    // ── Reading Header & Footer ───────────────────────────────────────────
    'Reduce new header/footer height': {
        category: 'header-footer',
        author: 'jackie_w',
        description: 'Reduces the height of the reading header/footer when enabled. Affects ePubs and KePubs.',
        tips: ['Edit the `min-height`/`max-height` `Replace` values per device (keep min = max).'],
    },
    'Custom header/footer captions': {
        category: 'header-footer',
        author: 'jackie_w',
        description: 'Customises the reading header/footer caption font, size/position, and width. Header and footer stay a matched pair.',
        note: 'Not suitable for Japanese/Chinese locale users.',
        tips: [
            'Part 2a: edit the `font-size` `Replace` values per device.',
            'Part 2b: add a `margin-top` to fine-tune vertical position.',
            'Part 3: lower the `footerMargin` values to widen the captions.',
        ],
    },
    'Remove title from reading header/footer': {
        category: 'header-footer',
        author: 'pgaskin (geek1011)',
        description: 'Removes the chapter/book title from the reading header/footer (applies to both).',
    },
    "Don't uppercase header/footer text": {
        category: 'header-footer',
        author: 'pgaskin (geek1011)',
        description: 'Stops the reading header/footer text from being forced to uppercase.',
        note: 'Mutually exclusive with the other header/footer page-number patches.',
    },
    'Custom header/footer page number text': {
        category: 'header-footer',
        author: 'pgaskin (geek1011)',
        description: 'Changes the page-number text format in the reading header/footer (e.g. “1 / 2” instead of “1 OF 2”).',
        note: 'Mutually exclusive with the other header/footer page-number patches.',
        tips: ['Edit the `Replace` value to your preferred format.'],
    },
    "Don't uppercase header/footer text and change page number text": {
        category: 'header-footer',
        author: 'pgaskin (geek1011)',
        description: 'Combines “Don’t uppercase header/footer text” and “Custom header/footer page number text”.',
        note: 'Mutually exclusive with the other header/footer page-number patches.',
    },
    'Swap reading header/footer': {
        category: 'header-footer',
        author: 'pgaskin (geek1011)',
        description: 'Swaps the reading header and footer text (book progress on top, chapter progress on the bottom).',
        note: 'Undefined behaviour if the header or footer is disabled.',
    },
    'Custom page navigation scrubber': {
        category: 'header-footer',
        author: 'jackie_w',
        description: 'Customises the reading navigation scrubber (the back-to-page buttons, chapter name, and page label).',
        note: 'Not suitable for Japanese/Chinese locale users.',
        tips: ['Edit the `font-size` `Replace` values per device; see the patch comments for the other styleable parts.'],
    },
    'Customise Header back button': {
        category: 'header-footer',
        label: 'Customize the in-book back button',
        author: 'jackie_w',
        description: 'Customises the in-book top-left button (“Back to Home”, “Back to My Books”, …). By default un-bolds it.',
    },
    'Custom navigation menu page number text': {
        category: 'header-footer',
        author: 'jackie_w',
        description: 'Changes the page-number text format in the reading navigation menu.',
        tips: ['Edit the `Replace` value (default “%1 / %2”).'],
    },

    // ── Dictionary & Lookup ───────────────────────────────────────────────
    'Dictionary pop-up - increase available text area': {
        category: 'dictionary',
        author: 'jackie_w',
        description: 'Increases the area available for dictionary definitions in the pop-up by trimming header, footer, and margins.',
    },
    'Dictionary text font-family/font-size/line-height': {
        category: 'dictionary',
        label: 'Dictionary text appearance',
        author: 'jackie_w',
        description: 'Customises the dictionary text appearance (font family, size, and line height) in the pop-up and full-screen dictionary.',
        note: 'Since firmware 4.32, font-family choice is very limited.',
        tips: [
            'Edit the `42px` font-size and `1.10em` line-height `Replace` values.',
            'To change font-family, uncomment exactly one of the family `ReplaceString` examples.',
        ],
    },
    'Shorten dictionary entry not found message': {
        category: 'dictionary',
        author: 'jcn363',
        description: 'Shortens the “no dictionary match” message shown when a word isn’t found.',
    },
    'Change Wikipedia search language': {
        category: 'dictionary',
        author: 'jcn363',
        description: 'Sets the language used for Wikipedia lookups.',
        tips: ['Replace `es` in both `Replace` strings with your language code (e.g. `en`, `de`, `ru`).'],
    },

    // ── Keyboards ─────────────────────────────────────────────────────────
    'Cyrillic Keyboard (GloHD/ClaraHD/AuraOne/H2O2)': {
        category: 'keyboards',
        label: 'Cyrillic keyboard',
        author: 'GeoffR, updated by Bald Eagle',
        description: 'Replaces the Extended Latin keypad keys with Cyrillic alternatives.',
        note: 'Keys may show as blank squares until the first book is opened; long-press of Extended Latin keys no longer works.',
    },
    'Greek Keyboard (GloHD/ClaraHD/AuraOne/H2O2)': {
        category: 'keyboards',
        label: 'Greek keyboard',
        author: 'GeoffR, updated by Bald Eagle',
        description: 'Replaces the Extended Latin keypad keys with Greek alternatives.',
        note: 'Keys may show as blank squares until the first book is opened; long-press of Extended Latin keys no longer works.',
    },
    'Bulgarian Phonetic Keyboard (GloHD/ClaraHD/AuraOne/H2O2/Forma/Libra)': {
        category: 'keyboards',
        label: 'Bulgarian phonetic keyboard',
        author: 'Svens',
        description: 'Replaces the Extended Latin keypad keys with Bulgarian phonetic alternatives.',
        note: 'Keys may show as blank squares until the first book is opened; long-press of Extended Latin keys no longer works.',
    },

    // ── Buttons & Gestures ────────────────────────────────────────────────
    "Don't grab exclusive access to event0": {
        category: 'input',
        label: 'Let third-party tools read the buttons',
        author: 'NiLuJe',
        description: 'Stops Nickel from grabbing exclusive access to the input device, so third-party tools (e.g. MiniClock) can read page-turn buttons.',
    },
    // pgaskin's original stopped working on recent firmware; the code shipped
    // here is a new implementation by xor_. It sits under the "by pgaskin
    // (geek1011)" comment in the YAML only because that is where it was pasted.
    // 4.38: https://www.mobileread.com/forums/showpost.php?p=4591445
    // 4.45: https://www.mobileread.com/forums/showpost.php?p=4591446
    'Both page turn buttons go next': {
        category: 'input',
        label: 'Both physical buttons go to next page',
        author: 'xor_',
        description: 'Makes both physical page-turn buttons go to the next page (the touchscreen tap zones are unaffected).',
        note: 'Also affects the Kobo Remote: both of its buttons go to the next page, leaving no way to page backwards with the remote.',
    },
    'Both page turn sides go next': {
        category: 'input',
        label: 'Both screen tap zones go to next page',
        author: 'pgaskin (geek1011)',
        description: 'Makes tapping either side of the screen go to the next page (the physical buttons are unaffected).',
    },
    'Increase page navigation history': {
        category: 'input',
        author: 'pgaskin (geek1011)',
        description: 'Increases the number of navigation-history dots shown on the scrubber.',
        tips: ['Set the `Replace` value (must be greater than 1).'],
    },
    // Both swipe patches were written by xor_ in June 2026. They sit under the
    // "made by sherman" comment in the YAML because they were appended to that
    // block. The only patch shermp wrote there is "Unify font sizes".
    // https://www.mobileread.com/forums/showpost.php?p=4591445
    'Disable forward/backward swipe Gestures': {
        category: 'input',
        author: 'xor_',
        description: 'Disables the forward/backward page-turn swipe gestures in the reader.',
    },
    'Disable menu swipe gesture': {
        category: 'input',
        author: 'xor_',
        description: 'Disables the swipe-to-open-menu gesture in the reader.',
    },
    'Allow rotation on all devices': {
        category: 'input',
        author: 'pgaskin (geek1011)',
        description: 'Enables screen rotation on all devices, adding a rotation icon to the status bar on rotatable views.',
    },

    // ── Power & Sleep ─────────────────────────────────────────────────────
    'Custom Sleep/Power-off timeouts': {
        category: 'power',
        author: 'GeoffR',
        description: 'Changes the Sleep/Power-off timeout options from 5–60 minutes to 10–240 minutes.',
        tips: ['Edit the menu strings and the matching `ReplaceInt` values together so the text and the actual timeout agree.'],
    },
    'Larger Sleep/Power-off timeouts': {
        category: 'power',
        author: 'pgaskin (geek1011)',
        description: 'Raises the available Sleep/Power-off timeouts to much larger values (up to a few weeks).',
        note: 'Reliable under ~12 hours; longer timeouts may be overridden by auto-sync/sleepcover. See pgaskin.net for tuning.',
    },

    // ── Privacy & Features ────────────────────────────────────────────────
    'Block WiFi firmware upgrade': {
        category: 'features',
        author: 'GeoffR',
        description: 'Prevents firmware upgrades during a WiFi sync (manual and desktop upgrades still work).',
        note: 'DANGEROUS and untested until each new firmware ships. Can cause a boot loop on sign-out or factory reset — remove it first.',
    },
    'Always show confirmation dialog before upgrading': {
        category: 'features',
        author: 'pgaskin (geek1011)',
        description: 'Always shows the confirmation dialog before a firmware upgrade.',
    },
    'Allow USB storage even when device locked': {
        category: 'features',
        author: 'pgaskin (geek1011)',
        description: 'Always allows USB storage even when the device is locked, which helps recover from a bad patch without a factory reset.',
        note: 'This makes the lock screen security useless; it only takes effect when plugged in from the sleep screen.',
    },
    'Hide browser from beta features': {
        category: 'features',
        author: 'pgaskin (geek1011)',
        description: 'Hides the built-in web browser from the beta features list.',
    },
    'Remove beta features not supported text': {
        category: 'features',
        author: 'pgaskin (geek1011)',
        description: 'Removes the “beta features not supported” clutter text.',
    },
    'Disable all tutorial dialogs': {
        category: 'features',
        author: 'pgaskin (geek1011)',
        description: 'Removes the tutorials and recurring first-time dialogs.',
    },
    'Show all games': {
        category: 'features',
        author: 'pgaskin (geek1011)',
        description: 'Shows all games in beta features.',
        note: 'Not needed since firmware 4.20 if developer mode is enabled.',
    },
    'Allow showing info panel on random screensaver': {
        category: 'features',
        author: 'pgaskin (geek1011)',
        description: 'Allows the info panel to show even when using a random screensaver image from .kobo/screensaver.',
        note: 'Full-screen covers must be enabled for the screensaver to show.',
    },
    'Remove forgot pin button from lock screen': {
        category: 'features',
        author: 'pgaskin (geek1011)',
        description: 'Removes the “Forgot PIN → Sign Out” button from the lock screen.',
        note: 'If you forget your PIN with this enabled, you must hard-reset the device.',
    },
    'Replace adobe page numbers toggle with invert screen': {
        category: 'features',
        label: 'Swap Adobe page-numbers toggle for Invert screen',
        author: 'pgaskin (geek1011)',
        description: 'Replaces the Adobe page-numbers toggle in reading settings with an invert-screen toggle.',
        note: 'Only takes effect after a reboot.',
    },
    'Customize ComfortLight settings': {
        category: 'features',
        author: 'pgaskin (geek1011)',
        description: 'Customises the ComfortLight bedtime dropdown times and the colour-change start/end times.',
        tips: ['All values are customisable; see the per-value comments in the patch for what each `ReplaceInt` controls.'],
    },
    'jackie_w Screensaver full': {
        category: 'features',
        label: 'Full-screen screensaver info widget',
        author: 'jackie_w',
        description: 'On the full-screen sleep screensaver, shrinks the info widget and hides it while sleeping (shown only when powered off).',
        note: 'Not suitable for Japanese/Chinese locale users.',
    },
    'FeatureSettings - BookSpecificStats': {
        category: 'features',
        label: 'Per-book reading stats',
        author: 'pgaskin (geek1011)',
        description: 'Adds a “stats for this book” option to the book menu.',
    },
    'FeatureSettings - ShowFacebookShare': {
        category: 'features',
        label: 'Show Facebook share option',
        author: 'pgaskin (geek1011)',
        description: 'Re-enables the Facebook share option in menus.',
    },
    'FeatureSettings - FullScreenBrowser': {
        category: 'features',
        label: 'Full-screen web browser',
        author: 'pgaskin (geek1011)',
        description: 'Makes the web browser full-screen.',
        note: 'There is no way out of the full-screen browser except rebooting.',
    },
    'FeatureSettings - MyWords': {
        category: 'features',
        label: 'My Words activity tab',
        author: 'pgaskin (geek1011)',
        description: 'Enables the My Words tab of the Activity screen.',
    },
    'FeatureSettings - ExportHighlights': {
        category: 'features',
        label: 'Export highlights option',
        author: 'pgaskin (geek1011)',
        description: 'Adds an “export highlights” option to the book menu.',
    },
    'DeveloperSettings - AutoUsbGadget': {
        category: 'features',
        label: 'Auto-enable USB storage on connect',
        author: 'pgaskin (geek1011)',
        description: 'Automatically enables USB Storage mode when connected.',
    },
    'PowerSettings - UnlockEnabled': {
        category: 'features',
        label: 'Slide-to-unlock toggle',
        author: 'pgaskin (geek1011)',
        description: 'Disables (or enables) the slide-to-unlock feature.',
    },

    // ── PDF ───────────────────────────────────────────────────────────────
    'Remove PDF map widget shown during panning': {
        category: 'pdf',
        author: 'pgaskin (geek1011)',
        description: 'Removes the PDF map widget shown while panning and zooming.',
    },

    // ── Cloud Sync ────────────────────────────────────────────────────────
    'Unlock Dropbox and Google Drive support': {
        category: 'sync',
        author: 'imax (imax9000)',
        description: 'Removes the hardcoded device-model checks and enables Dropbox and Google Drive support by default.',
        note: 'Enabling it does not guarantee the feature works; server-side checks may still apply. Disable via [FeatureSettings] in Kobo eReader.conf.',
    },
};

/**
 * Metadata for a patch name, falling back to the trailing "Other" category so a
 * not-yet-categorized patch still renders. Never returns null.
 */
export function getPatchMeta(name) {
    return PATCH_META[name] ?? { category: OTHER_CATEGORY.id };
}
