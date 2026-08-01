/**
 * DOM.js — Shared DOM utility helpers.
 *
 * Thin wrappers around native DOM APIs used across all modules.
 * Keeps selector syntax consistent and reduces boilerplate.
 */

/** Look up an element by its `id` attribute. */
export const $ = (id) => document.getElementById(id);

/** querySelector shorthand; defaults to searching the whole document. */
export const $q = (sel, ctx = document) => ctx.querySelector(sel);

/** querySelectorAll shorthand; defaults to searching the whole document. */
export const $qa = (sel, ctx = document) => ctx.querySelectorAll(sel);

/**
 * Look up a screen's elements from an alias -> id map.
 *
 * Returns a frozen object with the same keys as `map`, each holding the matching
 * element. Throws on the first missing id, naming the id, so markup/JS drift
 * fails at init time instead of producing a silent `null` mid-flow.
 *
 * The return type is keyed on `map` itself, not on `string`. That is what makes a
 * misspelled alias at a use site an error once TypeScript lands; a plain
 * `Record<string, HTMLElement>` would type every key as an element, typos included.
 *
 * @template {Record<string, string>} M
 * @param {M} map - alias (camelCase) -> element id (kebab-case)
 * @returns {Readonly<Record<keyof M, HTMLElement>>}
 */
export function bindElements(map) {
    const bound = {};
    for (const [name, id] of Object.entries(map)) {
        const el = document.getElementById(id);
        if (!el) throw new Error(`Element #${id} not found`);
        bound[name] = el;
    }
    return Object.freeze(bound);
}

/**
 * Look up one required element by id.
 *
 * Same guarantee as `bindElements`: a missing element throws at lookup time and
 * the message names the id, so markup/JS drift fails where it can be found
 * instead of turning into a `null` that breaks somewhere else much later. This
 * is the single-element form used by step classes, which declare their elements
 * as fields rather than as one map.
 *
 * @param {string} id
 * @returns {HTMLElement}
 */
export function requireElement(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    return el;
}

/**
 * The three typed variants below assert the element's tag on top of the
 * existence check. They exist so a field can be declared as the subtype the code
 * actually uses — `.checked`, `.disabled`, `.showModal()` — which the plain
 * `HTMLElement` return cannot express.
 *
 * A wrong assertion throws at app start, so only use one when the tag is
 * certain. `requireElement` is always the safe answer.
 */
function requireTag(id, ctor, tagName) {
    const el = requireElement(id);
    if (!(el instanceof ctor)) throw new Error(`Element #${id} is not a <${tagName}>`);
    return el;
}

/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
export function requireInput(id) {
    return requireTag(id, window.HTMLInputElement, 'input');
}

/**
 * @param {string} id
 * @returns {HTMLButtonElement}
 */
export function requireButton(id) {
    return requireTag(id, window.HTMLButtonElement, 'button');
}

/**
 * @param {string} id
 * @returns {HTMLDialogElement}
 */
export function requireDialog(id) {
    return requireTag(id, window.HTMLDialogElement, 'dialog');
}

/**
 * @param {string} id
 * @returns {HTMLSelectElement}
 */
export function requireSelect(id) {
    return requireTag(id, window.HTMLSelectElement, 'select');
}

/** Format a byte count as a human-readable "X.X MB" string. */
export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * Replace all options in a <select> element.
 * Always inserts a non-value placeholder as the first option.
 * Each item in `items` can carry a `data` object whose keys become
 * `data-*` attributes on the <option> element.
 */
export function populateSelect(selectEl, placeholder, items) {
    selectEl.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = placeholder;
    selectEl.appendChild(defaultOpt);
    for (const { value, text, data } of items) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = text;
        if (data) {
            for (const [k, v] of Object.entries(data)) {
                opt.dataset[k] = v;
            }
        }
        selectEl.appendChild(opt);
    }
}

const _trappedDialogs = new WeakSet();

/**
 * Trap Tab focus within a modal dialog so keyboard users can't tab behind it.
 * Idempotent — safe to call multiple times on the same element.
 */
export function trapFocus(dialog) {
    if (_trappedDialogs.has(dialog)) return;
    _trappedDialogs.add(dialog);

    const focusable =
        'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])';

    dialog.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;

        const focusables = dialog.querySelectorAll(focusable);
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });
}

/** Show a text hint in the shared hint dialog (used by feature "?" badges). */
export function showHint(title, text) {
    const dialog = document.getElementById('hint-dialog');
    const body = document.getElementById('hint-dialog-text');
    if (!dialog || !body) return;
    const heading = document.getElementById('hint-dialog-title');
    if (heading && title) heading.textContent = title;
    body.textContent = text;
    trapFocus(dialog);
    dialog.showModal();
    const closeBtn = document.getElementById('btn-hint-close');
    if (closeBtn) closeBtn.focus();
}

/** Populate a <ul>/<ol> with text items, clearing existing content. */
export function populateList(listEl, items) {
    listEl.innerHTML = '';
    for (const text of items) {
        const li = document.createElement('li');
        li.textContent = text;
        listEl.appendChild(li);
    }
}

/**
 * Wire up a .feedback banner inside a container element.
 * Shows text + vote buttons; clicking one replaces all with a vote-specific follow-up message.
 * @param {HTMLElement} container - element containing the .feedback widget
 * @param {function} onVote - callback receiving 'up' or 'down'
 */
export function setupFeedback(container, onVote) {
    const widget = container.querySelector('.feedback');
    if (!widget) return;
    const text = widget.querySelector('.feedback-text');
    const buttons = widget.querySelectorAll('.feedback-btn');
    const thanks = widget.querySelector('.feedback-thanks');
    const donate = widget.querySelector('.feedback-donate');

    widget.hidden = false;
    text.hidden = false;
    thanks.hidden = true;
    if (donate) donate.hidden = true;
    buttons.forEach((btn) => {
        btn.hidden = false;
        btn.disabled = false;
    });

    if (widget.dataset.feedbackWired) return;
    widget.dataset.feedbackWired = 'true';
    widget.addEventListener('click', (e) => {
        const btn = e.target.closest('.feedback-btn');
        if (!btn || btn.disabled || !widget.contains(btn)) return;

        text.hidden = true;
        buttons.forEach((b) => {
            b.hidden = true;
            b.disabled = true;
        });
        const vote = btn.dataset.vote;
        if (donate) donate.hidden = vote !== 'up';
        thanks.hidden = vote === 'up';
        onVote(vote);
    });
}

/**
 * Render `Kobo eReader.conf` settings into a container as `[Section]` intros
 * followed by their `key=value` lines. Shared by the patches and NickelMenu
 * download steps so both show conf edits identically.
 */
export function renderDownloadConfSettings(container, settings) {
    container.innerHTML = '';

    const sections = new Map();
    for (const { section, key, value } of settings) {
        if (!sections.has(section)) sections.set(section, []);
        sections.get(section).push(`${key}=${value}`);
    }

    for (const [section, lines] of sections) {
        const intro = document.createElement('p');
        const sectionCode = document.createElement('code');
        sectionCode.textContent = `[${section}]`;
        intro.append('In the ', sectionCode, ' section (add it if it is missing):');
        container.appendChild(intro);

        for (const line of lines) {
            const lineCode = document.createElement('code');
            lineCode.textContent = line;
            container.append(lineCode, document.createElement('br'));
        }
    }
}
