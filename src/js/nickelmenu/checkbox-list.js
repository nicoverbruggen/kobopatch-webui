/**
 * checkbox-list.js — Renders the NickelMenu feature/cleanup checkbox list.
 *
 * Takes an array of item descriptors and builds the sectioned, collapsible
 * checkbox UI used on the NickelMenu config and uninstall steps: per-item
 * title/version/description, disabled reasons, an optional customization
 * action (with icon/label summary), and a "?" hint badge. The flow owns what
 * the items are; this owns how they look.
 */

import { showHint } from '../shell/dom.js';

/**
 * Render a list of checkbox items into a container.
 * @param {HTMLElement} container
 * @param {Array<{name: string, title: string, description: string, checked: boolean, version?: string, disabled?: boolean, disabledReason?: string, hint?: string, sectionTitle?: string, sectionDescription?: string, actionLabel?: string, actionAriaLabel?: string, onAction?: function, summaryId?: string, summaryLabel?: string, summaryIconHtml?: string, summaryIconSrc?: string}>} items
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
