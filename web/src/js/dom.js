/**
 * dom.js — Shared DOM utility helpers.
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

/** Format a byte count as a human-readable "X.X MB" string. */
export function formatMB(bytes) {
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
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

/**
 * Render a list of checkbox items into a container.
 * @param {HTMLElement} container
 * @param {Array<{name: string, title: string, description: string, checked: boolean, disabled?: boolean, sectionTitle?: string, sectionDescription?: string}>} items
 */
export function renderNmCheckboxList(container, items) {
    container.innerHTML = '';
    let currentSectionKey = null;
    let currentTarget = container;

    for (const item of items) {
        const nextSectionKey = item.sectionTitle || '';
        if (nextSectionKey && nextSectionKey !== currentSectionKey) {
            const section = document.createElement('section');
            section.className = 'nm-config-section';

            const heading = document.createElement('div');
            heading.className = 'nm-config-section-heading';

            const title = document.createElement('h3');
            title.className = 'nm-config-section-title';
            title.textContent = item.sectionTitle;
            heading.appendChild(title);

            if (item.sectionDescription) {
                const desc = document.createElement('p');
                desc.className = 'nm-config-section-desc';
                desc.textContent = item.sectionDescription;
                heading.appendChild(desc);
            }

            const itemsWrap = document.createElement('div');
            itemsWrap.className = 'nm-config-section-items';

            section.appendChild(heading);
            section.appendChild(itemsWrap);
            container.appendChild(section);

            currentSectionKey = nextSectionKey;
            currentTarget = itemsWrap;
        } else if (!nextSectionKey) {
            currentSectionKey = null;
            currentTarget = container;
        }

        const label = document.createElement('label');
        label.className = 'nm-config-item';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = item.name;
        input.checked = item.checked;
        if (item.disabled) input.disabled = true;

        const textDiv = document.createElement('div');
        textDiv.className = 'nm-config-text';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'nm-config-title';
        titleSpan.textContent = item.title;

        const descSpan = document.createElement('span');
        descSpan.className = 'nm-config-desc';
        descSpan.textContent = item.description;

        textDiv.appendChild(titleSpan);
        textDiv.appendChild(descSpan);
        label.appendChild(input);
        label.appendChild(textDiv);
        currentTarget.appendChild(label);
    }
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

/** Fetch with automatic error throwing on non-OK responses. */
export async function fetchOrThrow(url, errorPrefix = 'Fetch failed') {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${errorPrefix}: HTTP ${resp.status}`);
    return resp;
}

/**
 * Wire up a .feedback banner inside a container element.
 * Shows text + vote buttons; clicking one replaces all with a thank-you message.
 * @param {HTMLElement} container - element containing the .feedback widget
 * @param {function} onVote - callback receiving 'up' or 'down'
 */
export function setupFeedback(container, onVote) {
    const widget = container.querySelector('.feedback');
    if (!widget) return;
    widget.hidden = false;
    const text = widget.querySelector('.feedback-text');
    const buttons = widget.querySelectorAll('.feedback-btn');
    const thanks = widget.querySelector('.feedback-thanks');
    text.hidden = false;
    thanks.hidden = true;
    buttons.forEach((btn) => {
        btn.hidden = false;
        btn.disabled = false;
        btn.addEventListener('click', () => {
            text.hidden = true;
            buttons.forEach((b) => { b.hidden = true; });
            thanks.hidden = false;
            onVote(btn.dataset.vote);
        }, { once: true });
    });
}

/**
 * Trigger a browser download of in-memory data.
 * Creates a temporary object URL, clicks a hidden <a>, then revokes it.
 */
export function triggerDownload(data, filename, mimeType) {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
