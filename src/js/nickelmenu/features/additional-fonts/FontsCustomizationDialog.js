/**
 * FontsCustomizationDialog.js — the "Select additional fonts" dialog.
 *
 * Lets the user pick which font families from the ebook-fonts collection are
 * installed, grouped into the curated core set and the larger extra set. The
 * family checkboxes are rendered when the dialog opens, because the catalogue is
 * generated data rather than static markup. The data model lives alongside in
 * ./customization.js and the catalogue in ./catalogue.js.
 */

import { requireButton, requireElement } from '../../../shell/DOM.js';
import { CustomizationDialog } from '../../CustomizationDialog.js';
import { FONT_FAMILIES } from './FontCatalogue.js';
import { createDefaultFontsCustomization, resolveSelectedFamilyIds } from './FontsCustomization.js';

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

export class FontsCustomizationDialog extends CustomizationDialog {
    /**
     * @param {object} config
     * @param {import('../../../flows/nickelmenu/NickelMenuSelection.js').NickelMenuSelection} config.selection
     * @param {import('../../../flows/nickelmenu/CustomizationDrafts.js').CustomizationDrafts} config.drafts
     * @param {AbortSignal} config.signal
     */
    constructor({ selection, drafts, signal }) {
        super({
            type: 'fonts',
            dialogId: 'nm-fonts-dialog',
            statusId: 'nm-fonts-status',
            closeId: 'btn-nm-fonts-close',
            cancelId: 'btn-nm-fonts-cancel',
            resetId: 'btn-nm-fonts-reset',
            saveId: 'btn-nm-fonts-save',
            summaryContainerId: 'nm-fonts-summary',
            selection,
            drafts,
            signal,
        });
    }

    bindElements() {
        this.lists = { core: requireElement('nm-fonts-core-list'), extra: requireElement('nm-fonts-extra-list') };
        this.counts = { core: requireElement('nm-fonts-core-count'), extra: requireElement('nm-fonts-extra-count') };
        this.btnCoreAll = requireButton('btn-nm-fonts-core-all');
        this.btnCoreNone = requireButton('btn-nm-fonts-core-none');
        this.btnExtraAll = requireButton('btn-nm-fonts-extra-all');
        this.btnExtraNone = requireButton('btn-nm-fonts-extra-none');
    }

    get committed() {
        return this.selection.fontsCustomization;
    }

    set committed(value) {
        this.selection.fontsCustomization = value;
    }

    get draft() {
        return this.drafts.fonts;
    }

    set draft(value) {
        this.drafts.fonts = value;
    }

    createDefault() {
        return createDefaultFontsCustomization();
    }

    seed(customization) {
        const draft = { families: resolveSelectedFamilyIds(customization) };
        for (const collectionId of FONT_COLLECTION_IDS) {
            this.#renderFamilyList(collectionId, draft);
        }
        this.#applyFontPreviews();
        this.#refreshDerived(draft);
        return draft;
    }

    focusInitial() {
        this.lists.core.querySelector('input[type="checkbox"]')?.focus();
    }

    /** Refuses an empty selection, leaving the dialog open. */
    commit() {
        if (this.draft.families.length === 0) return null;
        // Catalogue order, so the stored customization is independent of click order.
        const selected = new Set(this.draft.families);
        return { families: FONT_FAMILIES.filter((family) => selected.has(family.id)).map((family) => family.id) };
    }

    summary(customization) {
        return {
            label: `${resolveSelectedFamilyIds(customization).length} fonts`,
            iconHtml: FONTS_SUMMARY_ICON,
        };
    }

    /** Gated on the feature having been selected, unlike the menu dialog's. */
    adoptPrevious(previous, previousIds) {
        if (!previous?.fontsCustomization || !previousIds.has('additional-fonts')) return;
        this.committed = { families: [...resolveSelectedFamilyIds(previous.fontsCustomization)] };
        this.draft = { families: [...resolveSelectedFamilyIds(this.committed)] };
    }

    wire(signal) {
        const pairs = [
            [this.btnCoreAll, 'core', true],
            [this.btnCoreNone, 'core', false],
            [this.btnExtraAll, 'extra', true],
            [this.btnExtraNone, 'extra', false],
        ];
        for (const [button, collectionId, selected] of pairs) {
            button.addEventListener('click', () => this.#setCollectionSelection(collectionId, selected), { signal });
        }
    }

    /**
     * Select or clear every family of one collection, syncing the already-rendered
     * checkboxes in place (no re-render, so focus is preserved).
     */
    #setCollectionSelection(collectionId, selected) {
        const draft = this.draft;
        const collectionIds = familiesIn(collectionId).map((family) => family.id);
        draft.families = draft.families.filter((id) => !collectionIds.includes(id));
        if (selected) draft.families.push(...collectionIds);

        for (const input of this.lists[collectionId].querySelectorAll('input[type="checkbox"]')) {
            input.checked = selected;
        }
        this.#refreshDerived(draft);
    }

    /**
     * Refresh the derived dialog state from the draft: per-collection counts, the
     * status line, and the Save button (disabled while nothing is selected).
     */
    #refreshDerived(draft) {
        const selected = new Set(draft.families);

        for (const collectionId of FONT_COLLECTION_IDS) {
            const families = familiesIn(collectionId);
            const count = families.filter((family) => selected.has(family.id)).length;
            this.counts[collectionId].textContent = `${count} of ${families.length} selected`;
        }

        const valid = selected.size > 0;
        this.btnSave.disabled = !valid;
        if (!valid) {
            this.status.textContent = 'Select at least one font family.';
        } else {
            this.status.textContent = `${selected.size} of ${FONT_FAMILIES.length} font families selected.`;
        }
    }

    #renderFamilyList(collectionId, draft) {
        const container = this.lists[collectionId];
        container.innerHTML = '';
        const selected = new Set(draft.families);
        for (const family of familiesIn(collectionId)) {
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
                this.#refreshDerived(draft);
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
     * Fill each rendered family item with its "Aa" tile once the preview data is
     * available. Idempotent per item, and queried at resolve time, so a re-render
     * (open/reset) while the fetch is in flight stays consistent.
     */
    async #applyFontPreviews() {
        const previews = await loadFontPreviews();
        if (!previews?.families) return;

        for (const collectionId of FONT_COLLECTION_IDS) {
            for (const item of this.lists[collectionId].querySelectorAll('.nm-fonts-item')) {
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
}
