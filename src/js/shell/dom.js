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

/**
 * Collect multiple elements by ID in one call, returning a frozen object.
 * Throws loudly on any missing id so typos fail at init time instead of
 * producing silent `null` references mid-flow.
 */
export function collect(ids) {
    const els = {};
    for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) throw new Error(`Element #${id} not found`);
        els[id] = el;
    }
    return Object.freeze(els);
}

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
 * @param {Array<{name: string, title: string, description: string, checked: boolean, disabled?: boolean, disabledReason?: string, hint?: string, sectionTitle?: string, sectionDescription?: string, actionLabel?: string, actionAriaLabel?: string, onAction?: function, summaryId?: string, summaryLabel?: string, summaryIconHtml?: string, summaryIconSrc?: string}>} items
 */
export function renderNmCheckboxList(container, items) {
    container.innerHTML = '';

    const sectionBodies = new Map();

    for (const item of items) {
        let currentTarget = container;
        const sectionKey = item.sectionTitle || '';

        if (sectionKey) {
            if (!sectionBodies.has(sectionKey)) {
                // Sections are collapsible; a section starts collapsed when its
                // items declare `sectionCollapsed` (less-popular "Advanced" and
                // "Legacy" options are tucked away by default).
                const section = document.createElement('details');
                section.className = 'nm-config-section';
                section.open = !item.sectionCollapsed;

                const heading = document.createElement('summary');
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
                sectionBodies.set(sectionKey, itemsWrap);
            }
            currentTarget = sectionBodies.get(sectionKey);
        }

        const label = document.createElement('label');
        label.className = 'nm-config-item';

        if (item.disabled) label.classList.add('nm-config-item--disabled');
        if (item.actionLabel && item.onAction) label.classList.add('nm-config-item--has-action');

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

        // The asset version sits inline right after the title, in a muted style.
        if (item.version) {
            const version = document.createElement('span');
            version.className = 'nm-config-version';
            version.textContent = item.version;
            titleSpan.append(version);
        }

        const descId = item.name + '-desc';
        const descSpan = document.createElement('span');
        descSpan.id = descId;
        descSpan.className = 'nm-config-desc';
        descSpan.textContent = item.description;
        input.setAttribute('aria-describedby', descId);

        textDiv.appendChild(titleSpan);
        textDiv.appendChild(descSpan);

        // Explain (in red) why a feature is unavailable, e.g. when the device's
        // Kobo software is older than the feature's minimum supported version.
        if (item.disabledReason) {
            const reason = document.createElement('span');
            reason.className = 'nm-config-disabled-reason';
            reason.textContent = item.disabledReason;
            textDiv.appendChild(reason);
        }

        label.appendChild(input);
        label.appendChild(textDiv);

        if (item.actionLabel && item.onAction) {
            const side = document.createElement('div');
            side.className = 'nm-config-side';

            if (item.summaryId) {
                const caption = document.createElement('span');
                caption.className = 'nm-config-customize-caption';
                caption.textContent = item.actionLabel + ':';
                side.appendChild(caption);

                const summary = document.createElement('button');
                summary.type = 'button';
                summary.id = item.summaryId;
                summary.className = 'nm-config-summary nm-config-summary-button';
                summary.setAttribute('aria-label', item.actionAriaLabel || item.actionLabel);

                const icon = document.createElement('span');
                icon.className = 'nm-config-summary-icon';
                if (item.summaryIconHtml) {
                    icon.innerHTML = item.summaryIconHtml;
                } else if (item.summaryIconSrc) {
                    const img = document.createElement('img');
                    img.alt = '';
                    img.src = item.summaryIconSrc;
                    icon.appendChild(img);
                }

                const text = document.createElement('span');
                text.className = 'nm-config-summary-label';
                text.textContent = item.summaryLabel || '';

                summary.append(icon, text);
                summary.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    item.onAction(event.currentTarget);
                });
                side.appendChild(summary);
            } else {
                const action = document.createElement('button');
                action.type = 'button';
                action.className = 'nm-config-action secondary';
                action.textContent = item.actionLabel;
                action.setAttribute('aria-label', item.actionAriaLabel || item.actionLabel);
                action.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    item.onAction(event.currentTarget);
                });
                side.appendChild(action);
            }
            label.appendChild(side);
        }

        // Optional right-aligned "learn more" badge. A hint that looks like a URL
        // opens in a new tab; any other hint is treated as text and shown in a
        // popup. Both are interactive content, so a click opens them rather than
        // toggling the box.
        if (item.hint) {
            const isUrl = /^https?:\/\//i.test(item.hint);
            const help = document.createElement(isUrl ? 'a' : 'button');
            help.className = 'nm-config-help';
            help.textContent = '?';
            help.setAttribute('aria-label', `More about ${item.title}`);

            if (isUrl) {
                help.href = item.hint;
                help.target = '_blank';
                help.rel = 'noopener';
                help.title = 'Learn more';
                help.addEventListener('click', event => event.stopPropagation());
            } else {
                help.type = 'button';
                help.title = 'Show details';
                help.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    showHint(item.title, item.hint);
                });
            }
            label.appendChild(help);
        }

        currentTarget.appendChild(label);
    }
}

/** Show a text hint in the shared hint dialog (used by feature "?" badges). */
export function showHint(title, text) {
    const dialog = document.getElementById('hint-dialog');
    const body = document.getElementById('hint-dialog-text');
    if (!dialog || !body) return;
    const heading = document.getElementById('hint-dialog-title');
    if (heading && title) heading.textContent = title;
    body.textContent = text;
    dialog.showModal();
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
 * Fetch a URL as bytes while reporting download progress.
 *
 * Whenever the body is streamable, it is read chunk by chunk and
 * `onProgress(received, total)` fires after each chunk. `total` is the parsed
 * Content-Length when present, or `null` when it isn't — which is the common case
 * in production: a proxy/CDN serving these archives with `Content-Encoding: gzip`
 * drops Content-Length (the header would describe the compressed size, while the
 * stream we read is the decompressed body), so the browser reports no length even
 * though `curl -I` (which sends no Accept-Encoding) sees one. We must keep
 * streaming in that case and let callers show byte counts without a percentage;
 * bailing to a single read here is what left the progress label frozen. Only when
 * `resp.body` is entirely unavailable do we fall back to a single-shot read with
 * no progress callbacks. Returns a `Uint8Array` of the full payload.
 */
export async function fetchWithProgress(url, onProgress, errorPrefix = 'Download failed') {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`${errorPrefix}: HTTP ${resp.status}`);

    if (!resp.body) {
        // No streaming available — download in one shot.
        return new Uint8Array(await resp.arrayBuffer());
    }

    const contentLength = resp.headers?.get?.('Content-Length');
    const total = contentLength ? parseInt(contentLength, 10) : null;
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (onProgress) onProgress(received, total);
    }

    // Reassemble chunks into a single Uint8Array.
    const result = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

/**
 * Build an `onProgress(received, total)` handler for `fetchWithProgress` that
 * renders byte counts as a status string through `report` (e.g. a feature's
 * `ctx.progress`).
 *
 * It shows "<label> X.X / Y.Y MB (Z%)" against the best total available: the
 * server's Content-Length when present, else `expectedTotal` — the size baked into
 * /assets/index.json. That fallback is what keeps the percentage working in
 * production, where the proxy serves these archives gzip-encoded and strips
 * Content-Length. Only with neither does it show the indeterminate "<label>
 * (X.X MB)". The percentage is capped at 100% so a slightly-off estimate can't
 * read over.
 */
export function downloadProgress(report, label, expectedTotal = null) {
    return (received, total) => {
        const knownTotal = total || expectedTotal;
        if (knownTotal) {
            const pct = Math.min(100, (received / knownTotal) * 100).toFixed(0);
            report(`${label} ${formatMB(received)} / ${formatMB(knownTotal)} (${pct}%)`);
        } else {
            report(`${label} (${formatMB(received)})`);
        }
    };
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
    if (widget.dataset.feedbackWired) return;
    widget.dataset.feedbackWired = 'true';
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
