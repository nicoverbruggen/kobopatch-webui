/**
 * patch-list-view.js — Rendering and filtering of the patch selection list.
 *
 * Builds the searchable, grouped checkbox/radio UI for a PatchUI's loaded
 * patches, keeps the per-file enabled counts in sync as toggles change, and
 * implements the search filter. Reads patch state and blacklist/modified flags
 * off the passed PatchUI instance; mutates only the DOM and selection state.
 */

import { TL } from '../shell/strings.js';
import { PATCH_FILE_LABELS } from './patch-yaml.js';
import { openPatchEditor } from './patch-editor.js';

/**
 * Render the patch configuration UI into a container element.
 */
export function renderPatchList(ui, container) {
    // Preserve which sections are expanded across re-renders (e.g. after a save).
    const openFiles = new Set(
        [...container.querySelectorAll('.patch-file-section[open]')].map(s => s.dataset.filename)
    );
    // Preserve an active search query so an edit/save (which re-renders) keeps
    // the search box and its filtered view instead of resetting to show all.
    const previousSearch = container.querySelector('.patch-search');
    const searchQuery = previousSearch ? previousSearch.value : '';
    container.innerHTML = '';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'patch-search-wrap';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'patch-search';
    searchInput.placeholder = 'Search patches…';
    searchWrap.appendChild(searchInput);
    const clearBtn = document.createElement('button');
    clearBtn.className = 'patch-search-clear';
    clearBtn.type = 'button';
    clearBtn.textContent = '×';
    clearBtn.hidden = true;
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearBtn.hidden = true;
        filterPatches(ui, listWrapper, nullEl, '');
    });
    searchWrap.appendChild(clearBtn);
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
        const enabledCount = patches.filter(p => p.enabled).length;
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
                noneInput.checked = !patchGroups[patch.patchGroup].some(p => p.enabled);
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
                        other.enabled = (other === patch);
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
            editBtn.className = 'patch-edit-btn';
            editBtn.textContent = '✎';
            editBtn.title = 'Edit patch values';
            editBtn.type = 'button';
            header.appendChild(editBtn);

            if (patch.description) {
                const toggle = document.createElement('button');
                toggle.className = 'patch-desc-toggle';
                toggle.textContent = '?';
                toggle.title = 'Toggle description';
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
                    toggle.textContent = desc.hidden ? '?' : '−';
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
        filterPatches(ui, listWrapper, nullEl, searchInput.value);
    });

    // Restore an in-progress search after a re-render (e.g. saving an edit),
    // re-applying the filter so the visible list matches the preserved query.
    if (searchQuery) {
        searchInput.value = searchQuery;
        clearBtn.hidden = false;
        filterPatches(ui, listWrapper, nullEl, searchQuery);
    }
}

export function updatePatchCounts(ui, container) {
    const sections = container.querySelectorAll('.patch-file-section');
    let idx = 0;
    for (const [, { patches }] of Object.entries(ui.patchFiles)) {
        if (patches.length === 0) continue;
        const count = patches.filter(p => p.enabled).length;
        const countEl = sections[idx]?.querySelector('.patch-count');
        if (countEl) countEl.textContent = `${count} / ${patches.length} enabled`;
        idx++;
    }
    if (ui.onChange) ui.onChange();
}

export function filterPatches(ui, wrapper, nullEl, query) {
    const q = query.toLowerCase().trim();
    const sections = wrapper.querySelectorAll('.patch-file-section');
    let anyVisible = false;

    // Remember the user's expand/collapse state on the first keystroke of a
    // search so it can be restored when the query is cleared, instead of
    // force-collapsing every section on each keystroke.
    if (q && !ui._savedOpenState) {
        ui._savedOpenState = new Map();
        for (const section of sections) ui._savedOpenState.set(section.dataset.filename, section.open);
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
            const hasStandalone = Array.from(standaloneItems).some(
                item => !item.classList.contains('patch-item-hidden')
            );
            const hasGroup = Array.from(groups).some(g => matchedGroups.has(g));
            const sectionVisible = hasStandalone || hasGroup;
            section.classList.toggle('patch-section-hidden', !sectionVisible);
            // Auto-expand sections with matches; collapse those without.
            section.open = sectionVisible;
        } else {
            section.classList.remove('patch-section-hidden');
        }
    }

    if (!q && ui._savedOpenState) {
        for (const section of sections) {
            const filename = section.dataset.filename;
            if (ui._savedOpenState.has(filename)) section.open = ui._savedOpenState.get(filename);
        }
        ui._savedOpenState = null;
    }

    nullEl.hidden = q ? anyVisible : true;
}
