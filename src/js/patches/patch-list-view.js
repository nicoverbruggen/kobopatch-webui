/**
 * patch-list-view.js — Rendering and filtering of the patch selection list.
 *
 * Builds the searchable, grouped checkbox/radio UI for a PatchUI's loaded
 * patches, keeps the per-file enabled counts in sync as toggles change, and
 * implements the search filter. Reads patch state and blacklist/modified flags
 * off the passed PatchUI instance; mutates only the DOM and selection state.
 */

import { CircleHelp, Info, Minus, Pencil } from 'lucide';
import { TL } from '../shell/strings.js';
import { PATCH_FILE_LABELS } from './patch-yaml.js';
import { openPatchEditor } from './patch-editor.js';

function iconAttrs(attrs) {
    return Object.entries(attrs || {})
        .map(([key, value]) => ` ${key}="${String(value).replace(/"/g, '&quot;')}"`)
        .join('');
}

function iconSvg(icon) {
    const wrap = document.createElement('span');
    wrap.className = 'patch-icon-btn-icon';
    wrap.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon
        .map(([tag, attrs]) => `<${tag}${iconAttrs(attrs)}/>`)
        .join('')}</svg>`;
    return wrap;
}

function patchSetKey(ui) {
    return `${ui.firmwareVersion || ''}\n${Object.keys(ui.patchFiles).join('\n')}`;
}

function blacklistUpdatedDate() {
    const value = typeof globalThis.__PATCH_BLACKLIST_UPDATED__ !== 'undefined' ? globalThis.__PATCH_BLACKLIST_UPDATED__ : null;
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
}

function firmwareMatchBadge() {
    const badge = document.createElement('span');
    badge.className = 'device-identification-badge device-identification-badge--verified';
    badge.tabIndex = 0;
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', TL.PATCH.BLACKLIST_VERSION_MATCH_TITLE);
    badge.setAttribute('aria-describedby', 'patch-blacklist-version-tooltip');
    badge.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M12 1.75l2.11 1.56 2.62-.25 1.08 2.4 2.39 1.1-.25 2.62L21.5 12l-1.55 2.11.25 2.62-2.39 1.1-1.08 2.4-2.62-.25L12 21.5l-2.11-1.56-2.62.25-1.08-2.4-2.39-1.1.25-2.62L2.5 12l1.55-2.11-.25-2.62 2.39-1.1 1.08-2.4 2.62.25L12 1.75z"/>
            <path d="M8 12.25l2.45 2.45L16.5 8.65" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;
    return badge;
}

function showFirmwareMatchTooltip(dialog, tooltip, badge) {
    const content = dialog.querySelector('.patch-blacklist-dialog-content');
    if (!content) return;

    tooltip.textContent = TL.PATCH.BLACKLIST_VERSION_MATCH_TITLE;
    tooltip.hidden = false;

    const contentBox = content.getBoundingClientRect();
    const badgeBox = badge.getBoundingClientRect();
    const tooltipBox = tooltip.getBoundingClientRect();
    const gap = 8;
    const minLeft = 12;
    const maxLeft = Math.max(minLeft, contentBox.width - tooltipBox.width - 12);
    const centeredLeft = badgeBox.left - contentBox.left + badgeBox.width / 2 - tooltipBox.width / 2;

    tooltip.style.left = `${Math.min(Math.max(centeredLeft, minLeft), maxLeft)}px`;
    tooltip.style.top = `${badgeBox.bottom - contentBox.top + gap}px`;
    tooltip.classList.add('patch-blacklist-version-tooltip--visible');
}

function hideFirmwareMatchTooltip(tooltip) {
    tooltip.classList.remove('patch-blacklist-version-tooltip--visible');
    tooltip.hidden = true;
}

function bindFirmwareMatchTooltip(dialog, badge) {
    const tooltip = document.getElementById('patch-blacklist-version-tooltip');
    if (!tooltip) return;

    const show = () => showFirmwareMatchTooltip(dialog, tooltip, badge);
    const hide = () => hideFirmwareMatchTooltip(tooltip);

    badge.addEventListener('mouseenter', show);
    badge.addEventListener('focus', show);
    badge.addEventListener('mouseleave', hide);
    badge.addEventListener('blur', hide);
    dialog.addEventListener('close', hide, { once: true });
}

function renderBlacklistDialog(ui) {
    const dialog = document.getElementById('patch-blacklist-dialog');
    if (!dialog) return null;

    const version = ui.firmwareVersion || ui.currentBlacklistVersion() || TL.PATCH.BLACKLIST_UNKNOWN_VERSION;
    const testedVersion = ui.testedFirmwareVersion || version;
    const descriptionEl = document.getElementById('patch-blacklist-description');
    const firmwareEl = document.getElementById('patch-blacklist-current-version');
    const updatedEl = document.getElementById('patch-blacklist-updated');
    const listEl = document.getElementById('patch-blacklist-list');
    const emptyEl = document.getElementById('patch-blacklist-empty');
    if (!descriptionEl || !firmwareEl || !updatedEl || !listEl || !emptyEl) return dialog;

    const versionsMatch = version === testedVersion;
    updatedEl.textContent = TL.PATCH.BLACKLIST_LAST_UPDATED(blacklistUpdatedDate());
    descriptionEl.textContent = TL.PATCH.BLACKLIST_DESCRIPTION(testedVersion);
    firmwareEl.textContent = TL.PATCH.BLACKLIST_YOUR_VERSION(version);
    if (versionsMatch) {
        const badge = firmwareMatchBadge();
        firmwareEl.append(' ', badge);
        bindFirmwareMatchTooltip(dialog, badge);
    }
    listEl.innerHTML = '';

    const entries = ui.getCurrentBlacklist();
    emptyEl.hidden = entries.length > 0;
    listEl.hidden = entries.length === 0;

    if (entries.length === 0) {
        emptyEl.textContent = TL.PATCH.BLACKLIST_EMPTY;
        return dialog;
    }

    for (const entry of entries) {
        const section = document.createElement('section');
        section.className = 'patch-blacklist-group';

        const title = document.createElement('h3');
        title.textContent = PATCH_FILE_LABELS[entry.filename] || TL.PATCH.BLACKLIST_OTHER_SECTION;
        section.appendChild(title);

        const list = document.createElement('ul');
        for (const name of entry.names) {
            const item = document.createElement('li');
            item.textContent = name;
            list.appendChild(item);
        }
        section.appendChild(list);
        listEl.appendChild(section);
    }

    return dialog;
}

/**
 * Render the patch configuration UI into a container element.
 */
export function renderPatchList(ui, container) {
    const currentPatchSetKey = patchSetKey(ui);
    const samePatchSet = container.dataset.patchSetKey === currentPatchSetKey;
    if (container.dataset.patchSetKey !== currentPatchSetKey) {
        delete container.dataset.patchSearch;
        delete container.dataset.patchSavedOpenState;
    }

    // Preserve which sections are expanded across re-renders (e.g. after a save).
    const openFiles = new Set([...container.querySelectorAll('.patch-file-section[open]')].map((s) => s.dataset.filename));
    // Preserve an active search query so an edit/save (which re-renders) keeps
    // the search box and its filtered view instead of resetting to show all.
    const previousSearch = container.querySelector('.patch-search');
    const searchQuery = samePatchSet ? (previousSearch ? previousSearch.value : container.dataset.patchSearch || '') : '';
    container.innerHTML = '';
    container.dataset.patchSetKey = currentPatchSetKey;

    const searchWrap = document.createElement('div');
    searchWrap.className = 'patch-search-wrap';
    const searchField = document.createElement('div');
    searchField.className = 'patch-search-field';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'patch-search';
    searchInput.placeholder = 'Search patches…';
    searchField.appendChild(searchInput);
    const clearBtn = document.createElement('button');
    clearBtn.className = 'patch-search-clear';
    clearBtn.type = 'button';
    clearBtn.textContent = '×';
    clearBtn.hidden = true;
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.hidden = true;
        filterPatches(container, listWrapper, nullEl, '');
    });
    searchField.appendChild(clearBtn);
    searchWrap.appendChild(searchField);

    const blacklistBtn = document.createElement('button');
    blacklistBtn.className = 'secondary patch-blacklist-button';
    blacklistBtn.type = 'button';
    blacklistBtn.append(iconSvg(Info), document.createTextNode(TL.PATCH.BLACKLIST_BUTTON));
    blacklistBtn.title = TL.PATCH.BLACKLIST_BUTTON_TITLE;
    blacklistBtn.setAttribute('aria-label', TL.PATCH.BLACKLIST_BUTTON_TITLE);
    blacklistBtn.addEventListener('click', () => {
        const dialog = renderBlacklistDialog(ui);
        if (!dialog) return;
        dialog.showModal();
        document.getElementById('btn-patch-blacklist-close')?.focus();
    });
    searchWrap.appendChild(blacklistBtn);
    container.appendChild(searchWrap);

    const listWrapper = document.createElement('div');
    listWrapper.className = 'patch-list-wrapper';
    container.appendChild(listWrapper);

    const nullEl = document.createElement('div');
    nullEl.className = 'patch-search-none';
    nullEl.textContent = 'No patches match your search.';
    nullEl.hidden = true;
    container.appendChild(nullEl);

    for (const [filename, { patches }] of Object.entries(ui.patchFiles)) {
        if (patches.length === 0) continue;

        const section = document.createElement('details');
        section.className = 'patch-file-section';
        section.dataset.filename = filename;
        section.open = openFiles.has(filename);

        const summary = document.createElement('summary');
        const label = PATCH_FILE_LABELS[filename] || filename;
        const enabledCount = patches.filter((p) => p.enabled).length;
        summary.innerHTML = `<span class="patch-file-name">${label}</span> <span class="patch-count">${enabledCount} / ${patches.length} enabled</span>`;
        section.appendChild(summary);

        const list = document.createElement('div');
        list.className = 'patch-list';

        // Group patches by PatchGroup for mutual exclusion
        const patchGroups = {};
        for (const patch of patches) {
            if (patch.patchGroup) {
                if (!patchGroups[patch.patchGroup]) {
                    patchGroups[patch.patchGroup] = [];
                }
                patchGroups[patch.patchGroup].push(patch);
            }
        }

        // Sort: grouped patches first, then compatible standalone, then incompatible standalone.
        const sorted = [...patches].sort((a, b) => {
            const rank = (p) => {
                if (p.patchGroup) return 0;
                if (ui.isBlacklisted(filename, p.name)) return 2;
                return 1;
            };
            return rank(a) - rank(b);
        });

        const renderedGroupNone = {};
        // Group wrapper elements keyed by patchGroup name.
        const groupWrappers = {};

        for (const patch of sorted) {
            const isGrouped = !!patch.patchGroup;
            const blacklisted = ui.isBlacklisted(filename, patch.name);

            // Create a group wrapper and "None" option before the first patch in each group.
            if (isGrouped && !renderedGroupNone[patch.patchGroup]) {
                renderedGroupNone[patch.patchGroup] = true;

                const wrapper = document.createElement('div');
                wrapper.className = 'patch-group';

                const groupLabel = document.createElement('div');
                groupLabel.className = 'patch-group-label';
                groupLabel.textContent = patch.patchGroup;
                wrapper.appendChild(groupLabel);

                const noneItem = document.createElement('div');
                noneItem.className = 'patch-item';
                const noneHeader = document.createElement('label');
                noneHeader.className = 'patch-header';
                const noneInput = document.createElement('input');
                noneInput.type = 'radio';
                noneInput.name = `pg_${filename}_${patch.patchGroup}`;
                noneInput.checked = !patchGroups[patch.patchGroup].some((p) => p.enabled);
                noneInput.addEventListener('change', () => {
                    for (const other of patchGroups[patch.patchGroup]) {
                        other.enabled = false;
                    }
                    updatePatchCounts(ui, container);
                });
                const noneName = document.createElement('span');
                noneName.className = 'patch-name patch-name-none';
                noneName.textContent = TL.PATCH.NONE;
                noneHeader.appendChild(noneInput);
                noneHeader.appendChild(noneName);
                noneItem.appendChild(noneHeader);
                wrapper.appendChild(noneItem);

                groupWrappers[patch.patchGroup] = wrapper;
                list.appendChild(wrapper);
            }

            const item = document.createElement('div');
            item.className = 'patch-item' + (blacklisted ? ' patch-disabled' : '');

            const header = document.createElement('label');
            header.className = 'patch-header';

            const input = document.createElement('input');

            if (isGrouped) {
                input.type = 'radio';
                input.name = `pg_${filename}_${patch.patchGroup}`;
                input.checked = patch.enabled;
                input.addEventListener('change', () => {
                    for (const other of patchGroups[patch.patchGroup]) {
                        other.enabled = other === patch;
                    }
                    updatePatchCounts(ui, container);
                });
            } else {
                input.type = 'checkbox';
                input.checked = patch.enabled;
                input.addEventListener('change', () => {
                    patch.enabled = input.checked;
                    updatePatchCounts(ui, container);
                });
            }

            const nameSpan = document.createElement('span');
            nameSpan.className = 'patch-name';
            nameSpan.textContent = patch.name;

            header.appendChild(input);
            header.appendChild(nameSpan);

            if (blacklisted) {
                const badge = document.createElement('span');
                badge.className = 'patch-incompatible';
                badge.textContent = 'known to fail';
                header.appendChild(badge);
            }

            if (ui.isModified(filename, patch.name)) {
                const badge = document.createElement('span');
                badge.className = 'patch-modified';
                badge.textContent = TL.PATCH.MODIFIED;
                badge.title = TL.PATCH.MODIFIED_TITLE;
                header.appendChild(badge);
            }

            const editBtn = document.createElement('button');
            editBtn.className = 'patch-icon-btn patch-edit-btn';
            editBtn.appendChild(iconSvg(Pencil));
            editBtn.title = 'Edit patch values';
            editBtn.setAttribute('aria-label', `Edit values for ${patch.name}`);
            editBtn.type = 'button';
            header.appendChild(editBtn);

            if (patch.description) {
                const toggle = document.createElement('button');
                toggle.className = 'patch-icon-btn patch-desc-toggle';
                toggle.appendChild(iconSvg(CircleHelp));
                toggle.title = 'Toggle description';
                toggle.setAttribute('aria-label', `Toggle description for ${patch.name}`);
                toggle.setAttribute('aria-expanded', 'false');
                toggle.type = 'button';
                header.appendChild(toggle);
            }

            item.appendChild(header);

            editBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openPatchEditor(ui, patch, filename, container);
            });

            if (patch.description) {
                const desc = document.createElement('p');
                desc.className = 'patch-description';
                desc.textContent = patch.description;
                desc.hidden = true;
                item.appendChild(desc);

                const toggle = header.querySelector('.patch-desc-toggle');
                toggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    desc.hidden = !desc.hidden;
                    toggle.setAttribute('aria-expanded', desc.hidden ? 'false' : 'true');
                    toggle.replaceChildren(iconSvg(desc.hidden ? CircleHelp : Minus));
                });
            }

            if (isGrouped) {
                groupWrappers[patch.patchGroup].appendChild(item);
            } else {
                list.appendChild(item);
            }
        }

        section.appendChild(list);
        listWrapper.appendChild(section);
    }

    searchInput.addEventListener('input', () => {
        clearBtn.hidden = !searchInput.value;
        filterPatches(container, listWrapper, nullEl, searchInput.value);
    });

    // Restore an in-progress search after a re-render (e.g. saving an edit),
    // re-applying the filter so the visible list matches the preserved query.
    if (searchQuery) {
        searchInput.value = searchQuery;
        clearBtn.hidden = false;
        filterPatches(container, listWrapper, nullEl, searchQuery);
    }
}

export function updatePatchCounts(ui, container) {
    const sections = container.querySelectorAll('.patch-file-section');
    let idx = 0;
    for (const [, { patches }] of Object.entries(ui.patchFiles)) {
        if (patches.length === 0) continue;
        const count = patches.filter((p) => p.enabled).length;
        const countEl = sections[idx]?.querySelector('.patch-count');
        if (countEl) countEl.textContent = `${count} / ${patches.length} enabled`;
        idx++;
    }
    if (ui.onChange) ui.onChange();
}

function filterPatches(container, wrapper, nullEl, query) {
    const q = query.toLowerCase().trim();
    container.dataset.patchSearch = q;
    const sections = wrapper.querySelectorAll('.patch-file-section');
    let anyVisible = false;

    // Remember the user's expand/collapse state on the first keystroke of a
    // search so it can be restored when the query is cleared, instead of
    // force-collapsing every section on each keystroke.
    let savedOpenState = null;
    if (container.dataset.patchSavedOpenState) {
        savedOpenState = new Map(JSON.parse(container.dataset.patchSavedOpenState));
    }
    if (q && !savedOpenState) {
        savedOpenState = new Map();
        for (const section of sections) savedOpenState.set(section.dataset.filename, section.open);
        container.dataset.patchSavedOpenState = JSON.stringify([...savedOpenState.entries()]);
    }

    for (const section of sections) {
        const matchedGroups = new Set();

        const allItems = section.querySelectorAll('.patch-item');
        for (const item of allItems) {
            const nameEl = item.querySelector('.patch-name');
            const isNone = nameEl.classList.contains('patch-name-none');
            if (isNone) continue;

            const match = !q || nameEl.textContent.toLowerCase().includes(q);
            item.classList.toggle('patch-item-hidden', !match);
            if (match) {
                anyVisible = true;
                const group = item.closest('.patch-group');
                if (group) matchedGroups.add(group);
            }
        }

        const groups = section.querySelectorAll('.patch-group');
        for (const group of groups) {
            const hasMatch = matchedGroups.has(group);
            group.classList.toggle('patch-group-hidden', !hasMatch);
            const noneItem = group.querySelector('.patch-name-none')?.closest('.patch-item');
            if (noneItem) noneItem.classList.toggle('patch-item-hidden', !hasMatch);
        }

        if (q) {
            const standaloneItems = section.querySelectorAll(':scope > .patch-list > .patch-item');
            const hasStandalone = Array.from(standaloneItems).some((item) => !item.classList.contains('patch-item-hidden'));
            const hasGroup = Array.from(groups).some((g) => matchedGroups.has(g));
            const sectionVisible = hasStandalone || hasGroup;
            section.classList.toggle('patch-section-hidden', !sectionVisible);
            // Auto-expand sections with matches; collapse those without.
            section.open = sectionVisible;
        } else {
            section.classList.remove('patch-section-hidden');
        }
    }

    if (!q && savedOpenState) {
        for (const section of sections) {
            const filename = section.dataset.filename;
            if (savedOpenState.has(filename)) section.open = savedOpenState.get(filename);
        }
        delete container.dataset.patchSavedOpenState;
    }

    nullEl.hidden = q ? anyVisible : true;
}
