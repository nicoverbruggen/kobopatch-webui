/**
 * patch-list-view.js — Rendering and filtering of the patch selection list.
 *
 * Builds the searchable, themed checkbox/radio UI for a PatchUI's loaded
 * patches, keeps the per-category enabled counts in sync as toggles change, and
 * implements the search filter. Patches are flattened across all patch files
 * and grouped by the user-facing theme declared in patch-metadata.js (not by the
 * binary they patch); each theme renders as one collapsible section. Reads patch
 * state and blacklist/modified flags off the passed PatchUI instance; mutates
 * only the DOM and selection state.
 */

import { CircleHelp, Minus, Pencil } from 'lucide';
import { $ } from '../shell/dom.js';
import { TL } from '../shell/strings.js';
import { getPatchMeta, PATCH_CATEGORIES, OTHER_CATEGORY, PATCH_FILE_LABELS } from './patch-metadata.js';
import { openPatchEditor } from './patch-editor.js';

/**
 * Whether the user has opted (via the Advanced toggle) to see patches the way
 * they appear in the original kobopatch/MobileRead format: grouped by source
 * file and shown under their raw YAML names instead of the themed metadata layer.
 */
function isOriginalFormat(container) {
    return container?.dataset?.originalFormat === 'true';
}

/** The displayed title for a patch: the raw YAML name in original mode, else the metadata label fallback. */
function displayName(name, original) {
    return original ? name : getPatchMeta(name).label || name;
}

/**
 * Flatten patches across all files and bucket them by category, in
 * PATCH_CATEGORIES order, with a trailing "Other" section for anything whose
 * category isn't listed (including the `other` fallback). Each entry keeps its
 * source `filename` so PatchGroup mutual-exclusion stays scoped per file.
 */
function categoryBuckets(ui) {
    const byId = new Map();
    for (const [filename, { patches }] of Object.entries(ui.patchFiles)) {
        for (const patch of patches) {
            const id = getPatchMeta(patch.name).category || OTHER_CATEGORY.id;
            if (!byId.has(id)) byId.set(id, []);
            byId.get(id).push({ patch, filename });
        }
    }

    const ordered = [];
    for (const { id, label } of PATCH_CATEGORIES) {
        if (byId.has(id)) {
            ordered.push({ id, label, entries: byId.get(id) });
            byId.delete(id);
        }
    }
    // Anything left (the `other` fallback plus any unknown ids) folds into one
    // trailing "Other" section, preserving discovery order.
    const leftover = [];
    for (const entries of byId.values()) leftover.push(...entries);
    if (leftover.length > 0) ordered.push({ id: OTHER_CATEGORY.id, label: OTHER_CATEGORY.label, entries: leftover });
    return ordered;
}

/** Bucket patches by their source file (the "original format" view), in file order. */
function fileBuckets(ui) {
    const ordered = [];
    for (const [filename, { patches }] of Object.entries(ui.patchFiles)) {
        if (patches.length === 0) continue;
        ordered.push({
            id: filename,
            label: PATCH_FILE_LABELS[filename] || filename,
            entries: patches.map((patch) => ({ patch, filename })),
        });
    }
    return ordered;
}

/** Section buckets for the current view mode: by file (original) or by theme. */
function sectionBuckets(ui, original) {
    return original ? fileBuckets(ui) : categoryBuckets(ui);
}

/** Stable key for a PatchGroup, scoped per source file. */
function groupKey(filename, group) {
    return `${filename} ${group}`;
}

/**
 * The "X / Y enabled" tally for a section. A mutually-exclusive PatchGroup is a
 * single choice (pick one option or none), so it counts as ONE toward the total
 * and as one enabled when any of its options is selected — not once per option.
 */
function bucketCounts(entries) {
    let total = 0;
    let enabled = 0;
    const groupsSeen = new Set();
    const groupsEnabled = new Set();
    for (const { patch, filename } of entries) {
        if (patch.patchGroup) {
            const key = groupKey(filename, patch.patchGroup);
            if (!groupsSeen.has(key)) {
                groupsSeen.add(key);
                total++;
            }
            if (patch.enabled) groupsEnabled.add(key);
        } else {
            total++;
            if (patch.enabled) enabled++;
        }
    }
    return { enabled: enabled + groupsEnabled.size, total };
}

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
    const tooltip = $('patch-blacklist-version-tooltip');
    if (!tooltip) return;

    const show = () => showFirmwareMatchTooltip(dialog, tooltip, badge);
    const hide = () => hideFirmwareMatchTooltip(tooltip);

    badge.addEventListener('mouseenter', show);
    badge.addEventListener('focus', show);
    badge.addEventListener('mouseleave', hide);
    badge.addEventListener('blur', hide);
    dialog.addEventListener('close', hide, { once: true });
}

/**
 * Bucket the blacklisted patch names for the modal so it mirrors the patch list.
 * In themed mode the blacklist (keyed by file) is flattened and re-bucketed by
 * category; in original mode it stays grouped by file under the file labels.
 */
function blacklistGroups(ui, original) {
    if (original) {
        return ui.getCurrentBlacklist().map(({ filename, names }) => ({
            label: PATCH_FILE_LABELS[filename] || filename,
            names,
        }));
    }

    const byId = new Map();
    for (const { names } of ui.getCurrentBlacklist()) {
        for (const name of names) {
            const id = getPatchMeta(name).category || OTHER_CATEGORY.id;
            if (!byId.has(id)) byId.set(id, []);
            byId.get(id).push(name);
        }
    }

    const ordered = [];
    for (const { id, label } of PATCH_CATEGORIES) {
        if (byId.has(id)) {
            ordered.push({ label, names: byId.get(id) });
            byId.delete(id);
        }
    }
    const leftover = [];
    for (const names of byId.values()) leftover.push(...names);
    if (leftover.length > 0) ordered.push({ label: OTHER_CATEGORY.label, names: leftover });
    return ordered;
}

function renderBlacklistDialog(ui, original) {
    const dialog = $('patch-blacklist-dialog');
    if (!dialog) return null;

    const version = ui.firmwareVersion || ui.currentBlacklistVersion() || TL.PATCH.BLACKLIST_UNKNOWN_VERSION;
    const testedVersion = ui.testedFirmwareVersion || version;
    const descriptionEl = $('patch-blacklist-description');
    const firmwareEl = $('patch-blacklist-current-version');
    const updatedEl = $('patch-blacklist-updated');
    const listEl = $('patch-blacklist-list');
    const emptyEl = $('patch-blacklist-empty');
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

    const groups = blacklistGroups(ui, original);
    const hasEntries = groups.length > 0;
    emptyEl.hidden = hasEntries;
    listEl.hidden = !hasEntries;

    if (!hasEntries) {
        emptyEl.textContent = TL.PATCH.BLACKLIST_EMPTY;
        return dialog;
    }

    for (const group of groups) {
        const section = document.createElement('section');
        section.className = 'patch-blacklist-group';

        const title = document.createElement('h3');
        title.textContent = group.label;
        section.appendChild(title);

        const list = document.createElement('ul');
        for (const name of group.names) {
            const item = document.createElement('li');
            item.textContent = displayName(name, original);
            list.appendChild(item);
        }
        section.appendChild(list);
        listEl.appendChild(section);
    }

    return dialog;
}

/**
 * Open the incompatible-patches modal (the "Patch History" entry in the Advanced
 * section) for the patch list's current view mode. Exported so the flow can wire
 * the button that now lives in static HTML rather than in the rendered list.
 */
export function openBlacklistDialog(ui, container) {
    const dialog = renderBlacklistDialog(ui, isOriginalFormat(container));
    if (!dialog) return;
    dialog.showModal();
    $('btn-patch-blacklist-close')?.focus();
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

    const original = isOriginalFormat(container);

    // Preserve which sections are expanded across re-renders (e.g. after a save).
    const openCategories = new Set([...container.querySelectorAll('.patch-file-section[open]')].map((s) => s.dataset.category));
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

    container.appendChild(searchWrap);

    const listWrapper = document.createElement('div');
    listWrapper.className = 'patch-list-wrapper';
    container.appendChild(listWrapper);

    const nullEl = document.createElement('div');
    nullEl.className = 'patch-search-none';
    nullEl.textContent = 'No patches match your search.';
    nullEl.hidden = true;
    container.appendChild(nullEl);

    for (const { id, label, entries } of sectionBuckets(ui, original)) {
        if (entries.length === 0) continue;

        const section = document.createElement('details');
        section.className = 'patch-file-section';
        section.dataset.category = id;
        section.open = openCategories.has(id);

        const summary = document.createElement('summary');
        const { enabled: enabledCount, total } = bucketCounts(entries);
        summary.innerHTML = `<span class="patch-file-name">${label}</span> <span class="patch-count">${enabledCount} / ${total} enabled</span>`;
        section.appendChild(summary);

        const list = document.createElement('div');
        list.className = 'patch-list';

        // Group patches by PatchGroup (scoped per file) for mutual exclusion.
        const patchGroups = {};
        for (const { patch, filename } of entries) {
            if (patch.patchGroup) {
                const key = groupKey(filename, patch.patchGroup);
                if (!patchGroups[key]) patchGroups[key] = [];
                patchGroups[key].push(patch);
            }
        }

        // Sort: grouped patches first, then compatible standalone, then incompatible
        // standalone. In themed mode, order by display label within a rank so related
        // patches (e.g. a "part 1 of 2"/"part 2 of 2" pair, or the "Default ePub …
        // font" family) sit together; in original mode keep the source-file order.
        const sorted = [...entries].sort((a, b) => {
            const rank = ({ patch, filename }) => {
                if (patch.patchGroup) return 0;
                if (ui.isBlacklisted(filename, patch.name)) return 2;
                return 1;
            };
            const byRank = rank(a) - rank(b);
            if (byRank !== 0 || original) return byRank;
            return displayName(a.patch.name, false).localeCompare(displayName(b.patch.name, false), undefined, {
                sensitivity: 'base',
                numeric: true,
            });
        });

        const renderedGroupNone = {};
        // Group wrapper elements keyed by the composite group key.
        const groupWrappers = {};

        for (const { patch, filename } of sorted) {
            const isGrouped = !!patch.patchGroup;
            const key = isGrouped ? groupKey(filename, patch.patchGroup) : null;
            const blacklisted = ui.isBlacklisted(filename, patch.name);

            // Create a group wrapper and "None" option before the first patch in each group.
            if (isGrouped && !renderedGroupNone[key]) {
                renderedGroupNone[key] = true;

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
                noneInput.checked = !patchGroups[key].some((p) => p.enabled);
                noneInput.addEventListener('change', () => {
                    for (const other of patchGroups[key]) {
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

                groupWrappers[key] = wrapper;
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
                    for (const other of patchGroups[key]) {
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
            nameSpan.textContent = displayName(patch.name, original);

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
            editBtn.setAttribute('aria-label', `Edit values for ${displayName(patch.name, original)}`);
            editBtn.type = 'button';
            header.appendChild(editBtn);

            // Prose to surface: a metadata description (preferred) or the YAML
            // Description, plus an optional metadata note and author credit.
            const meta = getPatchMeta(patch.name);
            const descText = meta.description ?? patch.description;
            const hasNotes = !!(descText || meta.note || meta.author);

            if (hasNotes) {
                const toggle = document.createElement('button');
                toggle.className = 'patch-icon-btn patch-desc-toggle';
                toggle.appendChild(iconSvg(CircleHelp));
                toggle.title = 'Toggle description';
                toggle.setAttribute('aria-label', `Toggle description for ${displayName(patch.name, original)}`);
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

            if (hasNotes) {
                const notes = document.createElement('div');
                notes.className = 'patch-notes';
                notes.hidden = true;

                if (descText) {
                    const desc = document.createElement('p');
                    desc.className = 'patch-description';
                    desc.textContent = descText;
                    notes.appendChild(desc);
                }
                if (meta.note) {
                    const note = document.createElement('p');
                    note.className = 'patch-note';
                    note.textContent = meta.note;
                    notes.appendChild(note);
                }
                if (meta.author) {
                    const author = document.createElement('p');
                    author.className = 'patch-author';
                    author.textContent = `Patch by ${meta.author}`;
                    notes.appendChild(author);
                }
                item.appendChild(notes);

                const toggle = header.querySelector('.patch-desc-toggle');
                toggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    notes.hidden = !notes.hidden;
                    toggle.setAttribute('aria-expanded', notes.hidden ? 'false' : 'true');
                    toggle.replaceChildren(iconSvg(notes.hidden ? CircleHelp : Minus));
                });
            }

            if (isGrouped) {
                groupWrappers[key].appendChild(item);
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
    const buckets = sectionBuckets(ui, isOriginalFormat(container));
    const byId = new Map(buckets.map((b) => [b.id, b]));
    for (const section of sections) {
        const bucket = byId.get(section.dataset.category);
        if (!bucket) continue;
        const { enabled, total } = bucketCounts(bucket.entries);
        const countEl = section.querySelector('.patch-count');
        if (countEl) countEl.textContent = `${enabled} / ${total} enabled`;
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
        for (const section of sections) savedOpenState.set(section.dataset.category, section.open);
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
            const category = section.dataset.category;
            if (savedOpenState.has(category)) section.open = savedOpenState.get(category);
        }
        delete container.dataset.patchSavedOpenState;
    }

    nullEl.hidden = q ? anyVisible : true;
}
