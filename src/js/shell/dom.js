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

        const elements = dialog.querySelectorAll(focusable);
        if (elements.length === 0) return;

        const first = elements[0];
        const last = elements[elements.length - 1];

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
 * reports download progress through `report(label, detail, fraction)`.
 *
 * `label` stays put (e.g. "Downloading KOReader..."); the moving byte count rides
 * the separate `detail` line, with `fraction` (0–1) driving a progress bar.
 *
 * The percentage is measured against the best total available: the server's
 * Content-Length when present, else `expectedTotal` — the size baked into
 * /assets/index.json. That fallback is what keeps the percentage working in
 * production, where the proxy serves these archives gzip-encoded and strips
 * Content-Length. Only with neither does it show the indeterminate "X.X MB" with
 * no bar (`fraction` null). The fraction is capped at 1 so a slightly-off estimate
 * can't read over.
 */
export function downloadProgress(report, label, expectedTotal = null) {
    return (received, total) => {
        const knownTotal = total || expectedTotal;
        if (knownTotal) {
            const fraction = Math.min(1, received / knownTotal);
            const pct = (fraction * 100).toFixed(0);
            report(label, `${formatMB(received)} / ${formatMB(knownTotal)} (${pct}%)`, fraction);
        } else {
            report(label, formatMB(received), null);
        }
    };
}

/**
 * Render the secondary progress line of a `.busy-progress` container: the byte
 * count text and, when a 0–1 `fraction` is given, a filled progress bar. A null
 * `detail` hides the whole line (non-download steps that only set a status); a
 * null `fraction` keeps the line but drops the bar (indeterminate downloads).
 */
export function setProgressDetail(container, detail, fraction = null) {
    if (!container) return;
    container.hidden = !detail;
    if (!detail) return;

    const text = container.querySelector('.busy-progress-text');
    if (text) text.textContent = detail;

    const track = container.querySelector('.busy-progress-track');
    const fill = container.querySelector('.busy-progress-fill');
    const determinate = fraction !== null && fraction !== undefined;
    if (track) track.hidden = !determinate;
    if (fill && determinate) fill.style.width = `${(fraction * 100).toFixed(1)}%`;
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
