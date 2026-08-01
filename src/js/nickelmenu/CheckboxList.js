/**
 * CheckboxList.js — Renders the NickelMenu feature/cleanup checkbox list.
 *
 * Takes an array of item descriptors and builds the sectioned, collapsible
 * checkbox UI used on the NickelMenu config and uninstall steps: per-item
 * title/version/description, disabled reasons, an optional customization
 * action (with icon/label summary), and a "?" hint badge. The flow owns what
 * the items are; this owns how they look.
 */

import { showHint } from '../shell/DOM.js';

// Hover/focus explanation shown on the "Experimental" badge (same text for every
// experimental mod).
const EXPERIMENTAL_TOOLTIP =
    "Experimental mods are generally safe, but haven't been tested extensively on more than the author's own devices. If you encounter any issues, please consider filing a bug report.";

// Wrap inner SVG markup in a consistent line-icon frame (inherits the heading
// colour via currentColor, so it follows the theme and the muted Legacy style).
const svgIcon = (inner) =>
    `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

// Per-section heading icons, keyed by the exact section title a feature declares
// in its module. Presentational only — a section without an entry simply renders
// no icon, so adding a new section never breaks the list.
const SECTION_ICONS = {
    'Interface Tweaks': svgIcon(
        '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    ),
    'Reading Experience': svgIcon('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
    'Alternative reading apps': svgIcon(
        '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    ),
    Advanced: svgIcon(
        '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    ),
    Legacy: svgIcon('<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/><line x1="10" y1="12" x2="14" y2="12"/>'),
};

/**
 * Render a list of checkbox items into a container.
 * @param {HTMLElement} container
 * @param {Array<{name: string, title: string, description: string, checked: boolean, version?: string, disabled?: boolean, disabledReason?: string, hint?: string, experimental?: boolean, currentlyInstalled?: boolean, previouslySelected?: boolean, sectionTitle?: string, sectionDescription?: string, actionLabel?: string, actionAriaLabel?: string, onAction?: function, summaryId?: string, summaryLabel?: string, summaryIconHtml?: string, summaryIconSrc?: string}>} items
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
                // Expose the section as a slug modifier so CSS can restyle a
                // specific section (e.g. muting "Legacy" grey) without this
                // renderer special-casing any section by name.
                const sectionSlug = item.sectionTitle
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '');
                if (sectionSlug) section.classList.add('nm-config-section--' + sectionSlug);
                section.open = !item.sectionCollapsed;

                const heading = document.createElement('summary');
                heading.className = 'nm-config-section-heading';

                const iconMarkup = SECTION_ICONS[item.sectionTitle];
                if (iconMarkup) {
                    const icon = document.createElement('span');
                    icon.className = 'nm-config-section-icon';
                    icon.innerHTML = iconMarkup;
                    heading.appendChild(icon);
                }

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

        let previous = null;
        if (item.currentlyInstalled || item.previouslySelected) {
            previous = document.createElement('span');
            previous.className = 'nm-config-previous';
            const previousIcon = document.createElement('span');
            previousIcon.className = 'nm-config-previous-icon';
            if (item.currentlyInstalled) {
                previous.classList.add('nm-config-previous--installed');
                previousIcon.innerHTML = svgIcon('<polyline points="20 6 9 17 4 12"/>');
                previous.append(previousIcon, document.createTextNode('Currently installed'));
            } else {
                previousIcon.innerHTML = svgIcon('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>');
                previous.append(previousIcon, document.createTextNode('You selected this last time'));
            }
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

        if (previous) textDiv.appendChild(previous);

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
                summary.addEventListener('click', (event) => {
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
                action.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    item.onAction(event.currentTarget);
                });
                side.appendChild(action);
            }
            label.appendChild(side);
        }

        // Right-aligned "Experimental" pill for features still considered
        // unstable. Sits just before the "?" hint badge.
        if (item.experimental) {
            const badge = document.createElement('span');
            badge.className = 'nm-config-experimental';
            badge.textContent = 'Experimental';
            badge.setAttribute('data-tooltip', EXPERIMENTAL_TOOLTIP);
            badge.tabIndex = 0; // focusable so the tooltip is reachable by keyboard
            label.appendChild(badge);
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
                help.addEventListener('click', (event) => event.stopPropagation());
            } else {
                help.type = 'button';
                help.title = 'Show details';
                help.addEventListener('click', (event) => {
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
