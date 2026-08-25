/**
 * customization-dialog.js — the "Select additional fonts" dialog.
 *
 * Lets the user pick which font families from the ebook-fonts collection are
 * installed, grouped into the curated core set and the larger extra set.
 * Mirrors the simplify-tabs split: the data model lives in ./customization.js,
 * the catalogue in ./catalogue.js, and this file owns the dialog DOM. The
 * family checkboxes are rendered when the dialog opens (the catalogue is
 * generated data, not static markup).
 */

import { $, trapFocus } from '../../../shell/dom.js';
import { FONT_FAMILIES } from './catalogue.js';
import { createDefaultFontsCustomization, cloneFontsCustomization, isDefaultFontsCustomization, resolveSelectedFamilyIds } from './customization.js';

// A small "type specimen" glyph for the summary chip. Uses currentColor so it
// follows the chip's text colour in both light and dark themes.
const FONTS_SUMMARY_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" role="img" aria-hidden="true">' +
    '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>';

export const FONT_COLLECTION_IDS = ['core', 'extra'];

const SVG_NS = 'http://www.w3.org/2000/svg';

function familiesIn(collectionId) {
    return FONT_FAMILIES.filter((family) => family.collection === collectionId);
}

/**
 * The pre-rendered type specimens (assets/font-previews.json, derived from the
 * font archives by tools/installables/generate-font-previews.mjs). Fetched
 * lazily when the dialog first opens and cached; resolves to null when the
 * deployment lacks the file, in which case the dialog shows no previews.
 */
let fontPreviewsPromise = null;
function loadFontPreviews() {
    if (!fontPreviewsPromise) {
        fontPreviewsPromise = fetch('/assets/font-previews.json')
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
    }
    return fontPreviewsPromise;
}

/**
 * Fill each rendered family item with its "Aa" tile once the preview data is
 * available. Idempotent per item, and queried at resolve time, so a re-render
 * (open/reset) while the fetch is in flight stays consistent.
 */
async function applyFontPreviews(dialogDom) {
    const previews = await loadFontPreviews();
    if (!previews?.families) return;

    for (const collectionId of FONT_COLLECTION_IDS) {
        for (const item of dialogDom.lists[collectionId].querySelectorAll('.nm-fonts-item')) {
            if (item.querySelector('.nm-fonts-item-preview')) continue;
            const preview = previews.families[item.dataset.familyId];
            if (!preview) continue;

            // The viewBox is a square em band shared by every family, so the
            // tile is sized in CSS and the outlines land where they should.
            const svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('class', 'nm-fonts-item-preview');
            svg.setAttribute('viewBox', preview.viewBox);
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            svg.setAttribute('aria-hidden', 'true');

            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', preview.d);
            path.setAttribute('fill', 'currentColor');
            svg.appendChild(path);
            item.prepend(svg);
        }
    }
}

/**
 * Refresh the derived dialog state from the draft: per-collection counts, the
 * status line, and the Save button (disabled while nothing is selected). An
 * explicit `message` (e.g. "Defaults restored.") replaces the count summary.
 */
export function updateFontsCustomizationDialog(draft, dialogDom, message = '') {
    const selected = new Set(draft.families);

    for (const collectionId of FONT_COLLECTION_IDS) {
        const families = familiesIn(collectionId);
        const count = families.filter((family) => selected.has(family.id)).length;
        dialogDom.counts[collectionId].textContent = `${count} of ${families.length} selected`;
    }

    const valid = selected.size > 0;
    dialogDom.save.disabled = !valid;
    if (!valid) {
        dialogDom.status.textContent = 'Select at least one font family.';
    } else {
        dialogDom.status.textContent = message || `${selected.size} of ${FONT_FAMILIES.length} font families selected.`;
    }
}

function renderFamilyList(container, families, draft, dialogDom) {
    container.innerHTML = '';
    const selected = new Set(draft.families);
    for (const family of families) {
        const label = document.createElement('label');
        label.className = 'nm-fonts-item';
        label.dataset.familyId = family.id;

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.familyId = family.id;
        input.checked = selected.has(family.id);
        input.addEventListener('change', () => {
            if (input.checked) {
                if (!draft.families.includes(family.id)) draft.families.push(family.id);
            } else {
                draft.families = draft.families.filter((id) => id !== family.id);
            }
            updateFontsCustomizationDialog(draft, dialogDom);
        });

        const name = document.createElement('span');
        name.className = 'nm-fonts-item-name';
        name.textContent = family.name;

        const head = document.createElement('span');
        head.className = 'nm-fonts-item-head';
        head.append(input, name);

        label.append(head);
        container.appendChild(label);
    }
}

/**
 * Select or clear every family of one collection, syncing the already-rendered
 * checkboxes in place (no re-render, so focus is preserved).
 */
export function setFontsCollectionSelection(draft, dialogDom, collectionId, selected) {
    const collectionIds = familiesIn(collectionId).map((family) => family.id);
    draft.families = draft.families.filter((id) => !collectionIds.includes(id));
    if (selected) draft.families.push(...collectionIds);

    for (const input of dialogDom.lists[collectionId].querySelectorAll('input[type="checkbox"]')) {
        input.checked = selected;
    }
    updateFontsCustomizationDialog(draft, dialogDom);
}

/**
 * Fill the dialog from a customization and return a matching draft (with the
 * selection resolved to explicit family ids). Used both when opening the dialog
 * and when the user hits "Reset defaults" (which must not call showModal()
 * again on the already-open dialog).
 */
export function seedFontsCustomizeDialog(dialogDom, customization) {
    const draft = { families: resolveSelectedFamilyIds(customization) };
    for (const collectionId of FONT_COLLECTION_IDS) {
        renderFamilyList(dialogDom.lists[collectionId], familiesIn(collectionId), draft, dialogDom);
    }
    applyFontPreviews(dialogDom);
    updateFontsCustomizationDialog(draft, dialogDom);
    return draft;
}

export function openFontsCustomizeDialog(state, dialogDom) {
    const draft = seedFontsCustomizeDialog(dialogDom, state.nickelMenuFontsCustomization);
    dialogDom.dialog.showModal();
    dialogDom.lists.core.querySelector('input[type="checkbox"]')?.focus();
    return draft;
}

/**
 * The selection to persist on save: the draft's families in catalogue order,
 * so the stored customization is independent of click order.
 */
export function normalizedFontsCustomization(draft) {
    const selected = new Set(draft.families);
    return { families: FONT_FAMILIES.filter((family) => selected.has(family.id)).map((family) => family.id) };
}

export function getFontsCustomizationSummary(customization) {
    return {
        count: resolveSelectedFamilyIds(customization).length,
        iconHtml: FONTS_SUMMARY_ICON,
    };
}

export function getFontsCustomizationSummaryItem(state) {
    const summary = getFontsCustomizationSummary(state.nickelMenuFontsCustomization);
    return {
        summaryId: 'nm-fonts-summary',
        summaryLabel: `${summary.count} fonts`,
        summaryIconHtml: summary.iconHtml,
    };
}

export function updateFontsCustomizationSummary(state) {
    const container = $('nm-fonts-summary');
    if (!container) return;
    const summary = getFontsCustomizationSummary(state.nickelMenuFontsCustomization);
    const icon = container.querySelector('.nm-config-summary-icon');
    const label = container.querySelector('.nm-config-summary-label');
    if (icon) icon.innerHTML = summary.iconHtml;
    if (label) label.textContent = `${summary.count} fonts`;
}

export { createDefaultFontsCustomization, cloneFontsCustomization, isDefaultFontsCustomization };

function wireDialog() {
    const dlg = $('nm-fonts-dialog');
    if (dlg) trapFocus(dlg);
}

// Trap Tab inside the dialog once the DOM is ready. Returning focus to whatever
// opened it needs no code: the browser restores it when a modal <dialog> closes.
document.addEventListener('DOMContentLoaded', wireDialog, { once: true });
if (document.readyState !== 'loading') wireDialog();
