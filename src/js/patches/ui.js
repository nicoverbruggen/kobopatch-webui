import JSZip from 'jszip';
import yaml from 'js-yaml';
import { TL } from '../shell/strings.js';
import { fetchOrThrow } from '../shell/dom.js';

/**
 * Friendly display names for patch files.
 */
const PATCH_FILE_LABELS = {
    'src/nickel.yaml': 'Nickel (UI patches)',
    'src/nickel_custom.yaml': 'Nickel Custom',
    'src/libadobe.so.yaml': 'Adobe (PDF patches)',
    'src/libnickel.so.1.0.0.yaml': 'Nickel Library (core patches)',
    'src/librmsdk.so.1.0.0.yaml': 'Adobe RMSDK (ePub patches)',
    'src/cloud_sync.yaml': 'Cloud Sync',
};

/**
 * Parse a kobopatch YAML file and extract patch metadata.
 * Returns an array of patch objects with: name, enabled, description, patchGroup,
 * lineStart (0-indexed), and lineEnd (exclusive).
 */
function parsePatchYAML(content) {
    const patches = [];
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Top-level key (patch name): not indented, begins at column 0, ends with ':'
        if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('#') && line.endsWith(':')) {
            const name = line.slice(0, -1).trim();
            const patch = { name, enabled: false, description: '', patchGroup: null, lineStart: i };
            i++;

            // Parse the array items for this patch
            while (i < lines.length) {
                const itemLine = lines[i];

                // Stop at next top-level key or EOF
                if (itemLine.length > 0 && !itemLine.startsWith(' ') && !itemLine.startsWith('#')) {
                    break;
                }

                const trimmed = itemLine.trim();

                // Match "- Enabled: yes/no"
                const enabledMatch = trimmed.match(/^- Enabled:\s*(yes|no)$/);
                if (enabledMatch) {
                    patch.enabled = enabledMatch[1] === 'yes';
                    i++;
                    continue;
                }

                // Match "- PatchGroup: ..."
                const pgMatch = trimmed.match(/^- PatchGroup:\s*(.+)$/);
                if (pgMatch) {
                    patch.patchGroup = pgMatch[1].trim();
                    i++;
                    continue;
                }

                // Match "- Description: ..." (single line or multi-line block)
                const descMatch = trimmed.match(/^- Description:\s*(.*)$/);
                if (descMatch) {
                    const rest = descMatch[1].trim();
                    if (rest === '|' || rest === '>') {
                        // Multi-line block scalar
                        i++;
                        const descLines = [];
                        while (i < lines.length) {
                            const dl = lines[i];
                            // Block continues while indented more than the "- Description" level
                            if (dl.match(/^\s{6,}/) || dl.trim() === '') {
                                descLines.push(dl.trim());
                                i++;
                            } else {
                                break;
                            }
                        }
                        patch.description = descLines.join('\n').trim();
                    } else {
                        patch.description = rest;
                        i++;
                    }
                    continue;
                }

                i++;
            }

            patch.lineEnd = i;
            patches.push(patch);
        } else {
            i++;
        }
    }

    return patches;
}

/**
 * Parse the `patches:` section from kobopatch.yaml to get the file→target mapping.
 * Returns e.g. { "src/nickel.yaml": "usr/local/Kobo/nickel", ... }
 */
function parsePatchConfig(configYAML) {
    const patches = {};
    let version = null;
    const lines = configYAML.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let inPatches = false;

    for (const line of lines) {
        // Extract version
        const versionMatch = line.match(/^version:\s*(.+)$/);
        if (versionMatch) {
            version = versionMatch[1].trim().replace(/['"]/g, '');
            continue;
        }

        if (line.match(/^patches:\s*$/)) {
            inPatches = true;
            continue;
        }

        // A new top-level key ends the patches section
        if (inPatches && line.length > 0 && !line.startsWith(' ') && !line.startsWith('#')) {
            inPatches = false;
        }

        if (inPatches) {
            const match = line.match(/^\s+([\w/.]+\.yaml):\s*(.+)$/);
            if (match) {
                patches[match[1]] = match[2].trim();
            }
        }
    }

    return { version, patches };
}

/**
 * Scan the patches/ directory for available patch zips.
 * Returns an array of { filename, version } objects.
 * Each entry in index.json may list multiple versions; these are flattened
 * so that each version gets its own entry pointing to the same filename.
 */
async function scanAvailablePatches() {
    try {
        const resp = await fetch('patches/index.json');
        if (!resp.ok) return [];
        const list = await resp.json();
        const result = [];
        for (const entry of list) {
            for (const version of entry.versions) {
                result.push({ filename: entry.filename, version });
            }
        }
        return result;
    } catch (err) {
        console.error('Failed to load patch index:', err);
        return [];
    }
}

class PatchUI {
    constructor() {
        // Map of filename -> { raw: string, patches: Array }
        this.patchFiles = {};
        // Parsed from kobopatch.yaml inside the zip
        this.patchConfig = {};
        this.firmwareVersion = null;
        this.configYAML = null;
        // Blacklisted patches keyed by short version -> filename -> [names]
        this.blacklist = null;
        // Called when patch selection changes
        this.onChange = null;
    }

    /** Load the blacklist of incompatible patches. */
    async loadBlacklist() {
        try {
            const resp = await fetch('patches/blacklist.json');
            if (resp.ok) this.blacklist = await resp.json();
        } catch {
            // No blacklist available — all patches are allowed.
        }
    }

    /** Check if a patch is blacklisted for the current firmware version. */
    isBlacklisted(filename, patchName) {
        if (!this.blacklist || !this.firmwareVersion) return false;
        // Match against short version (e.g. "4.45" from "4.45.23646")
        const parts = this.firmwareVersion.split('.');
        const shortVersion = parts[0] + '.' + parts[1];
        const versionBlacklist = this.blacklist[shortVersion];
        if (!versionBlacklist) return false;
        const fileBlacklist = versionBlacklist[filename];
        if (!fileBlacklist) return false;
        return fileBlacklist.includes(patchName);
    }

    /**
     * Load patches from a zip file (ArrayBuffer or Uint8Array).
     * The zip should contain kobopatch.yaml and src/*.yaml.
     */
    async loadFromZip(zipData) {
        const zip = await JSZip.loadAsync(zipData);

        // Load kobopatch.yaml
        const configFile = zip.file('kobopatch.yaml');
        if (!configFile) {
            throw new Error('Patch zip does not contain kobopatch.yaml');
        }
        this.configYAML = await configFile.async('string');
        const { version, patches } = parsePatchConfig(this.configYAML);
        this.firmwareVersion = version;
        this.patchConfig = patches;

        // Load each patch YAML file referenced in the config
        this.patchFiles = {};
        for (const filename of Object.keys(patches)) {
            const yamlFile = zip.file(filename);
            if (!yamlFile) {
                console.warn('Patch file referenced in config but missing from zip:', filename);
                continue;
            }
            const raw = await yamlFile.async('string');
            const parsed = parsePatchYAML(raw);
            this.patchFiles[filename] = { raw, patches: parsed };
        }
    }

    /**
     * Load patches from a URL pointing to a zip file.
     */
    async loadFromURL(url) {
        const resp = await fetchOrThrow(url, 'Failed to fetch patch zip');
        const data = await resp.arrayBuffer();
        await this.loadFromZip(data);
    }

    /**
     * Render the patch configuration UI into a container element.
     */
    render(container) {
        container.innerHTML = '';

        const searchWrap = document.createElement('div');
        searchWrap.className = 'patch-search-wrap';
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'patch-search';
        searchInput.placeholder = 'Search patches\u2026';
        searchWrap.appendChild(searchInput);
        const clearBtn = document.createElement('button');
        clearBtn.className = 'patch-search-clear';
        clearBtn.type = 'button';
        clearBtn.textContent = '\u00d7';
        clearBtn.hidden = true;
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.hidden = true;
            this._filterPatches(listWrapper, nullEl, '');
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

        for (const [filename, { patches }] of Object.entries(this.patchFiles)) {
            if (patches.length === 0) continue;

            const section = document.createElement('details');
            section.className = 'patch-file-section';

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
                    if (this.isBlacklisted(filename, p.name)) return 2;
                    return 1;
                };
                return rank(a) - rank(b);
            });

            const renderedGroupNone = {};
            // Group wrapper elements keyed by patchGroup name.
            const groupWrappers = {};

            for (const patch of sorted) {
                const isGrouped = !!patch.patchGroup;
                const blacklisted = this.isBlacklisted(filename, patch.name);

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
                        this._updateCounts(container);
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
                        this._updateCounts(container);
                    });
                } else {
                    input.type = 'checkbox';
                    input.checked = patch.enabled;
                    input.addEventListener('change', () => {
                        patch.enabled = input.checked;
                        this._updateCounts(container);
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

                const editBtn = document.createElement('button');
                editBtn.className = 'patch-edit-btn';
                editBtn.textContent = '\u270E';
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
                    this._openEditor(patch, filename, container);
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
                        toggle.textContent = desc.hidden ? '?' : '\u2212';
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
            this._filterPatches(listWrapper, nullEl, searchInput.value);
        });
    }

    _updateCounts(container) {
        const sections = container.querySelectorAll('.patch-file-section');
        let idx = 0;
        for (const [, { patches }] of Object.entries(this.patchFiles)) {
            if (patches.length === 0) continue;
            const count = patches.filter(p => p.enabled).length;
            const countEl = sections[idx]?.querySelector('.patch-count');
            if (countEl) countEl.textContent = `${count} / ${patches.length} enabled`;
            idx++;
        }
        if (this.onChange) this.onChange();
    }

    _filterPatches(wrapper, nullEl, query) {
        const q = query.toLowerCase().trim();
        const sections = wrapper.querySelectorAll('.patch-file-section');
        let anyVisible = false;

        for (const section of sections) {
            section.open = !!q;

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
                group.style.display = hasMatch ? '' : 'none';
                const noneItem = group.querySelector('.patch-name-none')?.closest('.patch-item');
                if (noneItem) noneItem.classList.toggle('patch-item-hidden', !hasMatch);
            }

            if (q) {
                const standaloneItems = section.querySelectorAll(':scope > .patch-list > .patch-item');
                const hasStandalone = Array.from(standaloneItems).some(
                    item => !item.classList.contains('patch-item-hidden')
                );
                const hasGroup = Array.from(groups).some(
                    g => g.style.display !== 'none'
                );
                section.style.display = (hasStandalone || hasGroup) ? '' : 'none';
            } else {
                section.style.display = '';
            }
        }

        nullEl.hidden = q ? anyVisible : true;
    }

    _getDialog() {
        return document.getElementById('patch-editor-dialog');
    }

    _openEditor(patch, filename, container) {
        const lines = this.patchFiles[filename].raw.split('\n');
        const patchYaml = lines.slice(patch.lineStart, patch.lineEnd).join('\n');

        const dialog = this._getDialog();
        if (!dialog) return;

        const titleEl = dialog.querySelector('.patch-editor-title');
        const textarea = dialog.querySelector('.patch-editor-textarea');
        const statusEl = dialog.querySelector('.patch-editor-status');
        const footer = dialog.querySelector('.modal-footer');

        titleEl.textContent = `Edit: ${patch.name}`;
        textarea.value = patchYaml;
        statusEl.textContent = '';
        statusEl.className = 'patch-editor-status';

        // Use event delegation on the footer so we never deal with stale listeners
        const onFooterClick = (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;

            if (btn.classList.contains('patch-editor-validate')) {
                this._validateEdit(textarea, statusEl);
            } else if (btn.classList.contains('patch-editor-save')) {
                if (this._validateEdit(textarea, statusEl)) {
                    this._saveEdit(patch, filename, textarea.value, container);
                    dialog.close();
                }
            } else if (btn.classList.contains('patch-editor-cancel')) {
                dialog.close();
            }
        };
        footer.addEventListener('click', onFooterClick);

        const closeHandler = (e) => {
            if (e.target === dialog || e.target.closest('.patch-editor-cancel')) dialog.close();
        };
        dialog.addEventListener('click', closeHandler);

        dialog.addEventListener('close', () => {
            footer.removeEventListener('click', onFooterClick);
            dialog.removeEventListener('click', closeHandler);
        }, { once: true });

        dialog.showModal();
        textarea.focus();
    }

    _validateEdit(textarea, statusEl) {
        const value = textarea.value.trim();
        if (!value) {
            statusEl.textContent = 'Error: Patch definition cannot be empty.';
            statusEl.className = 'patch-editor-status patch-editor-status--error';
            return false;
        }

        // Use js-yaml to validate syntax and structure
        let doc;
        try {
            doc = yaml.load(value);
        } catch (err) {
            const msg = err.mark
                ? `Line ${err.mark.line + 1}, col ${err.mark.column + 1}: ${err.message}`
                : err.message;
            statusEl.textContent = `YAML error: ${msg}`;
            statusEl.className = 'patch-editor-status patch-editor-status--error';
            return false;
        }

        // Must be a mapping (object) with exactly one key — the patch name
        if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
            statusEl.textContent = 'Error: Patch definition must be a mapping (key: value pairs).';
            statusEl.className = 'patch-editor-status patch-editor-status--error';
            return false;
        }

        const keys = Object.keys(doc);
        if (keys.length === 0) {
            statusEl.textContent = 'Error: No patch name found. Must start with a name followed by a colon.';
            statusEl.className = 'patch-editor-status patch-editor-status--error';
            return false;
        }

        if (keys.length > 1) {
            statusEl.textContent = `Error: Multiple root keys detected (${keys.join(', ')}). Edit one patch at a time.`;
            statusEl.className = 'patch-editor-status patch-editor-status--error';
            return false;
        }

        const patchName = keys[0];
        const body = doc[patchName];

        // Body must be an array of operation items
        if (!Array.isArray(body)) {
            statusEl.textContent = 'Error: Patch body must be an array of items (indented lines starting with "-").';
            statusEl.className = 'patch-editor-status patch-editor-status--error';
            return false;
        }

        // Validate each item
        const knownOps = ['Enabled', 'Description', 'PatchGroup', 'FindZlib', 'ReplaceZlib', 'ReplaceZlibGroup', 'FindZlibHash', 'FindReplaceString', 'ReplaceBytes', 'ReplaceFloat', 'BaseAddress', 'MustMatchLength'];
        for (const item of body) {
            if (typeof item !== 'object' || item === null) continue;
            for (const key of Object.keys(item)) {
                if (!knownOps.includes(key)) {
                    statusEl.textContent = `Warning: Unknown operation "${key}" in patch "${patchName}". Check for typos.`;
                    statusEl.className = 'patch-editor-status patch-editor-status--warning';
                    break;
                }
            }
            // Only check first unknown key
            break;
        }

        // Validate Enabled value (must be yes/no)
        const enabledEntry = body.find(item => item && typeof item === 'object' && 'Enabled' in item);
        if (enabledEntry) {
            const val = enabledEntry.Enabled;
            if (val !== 'yes' && val !== 'no') {
                statusEl.textContent = `Error: Enabled must be "yes" or "no", got "${String(val)}".`;
                statusEl.className = 'patch-editor-status patch-editor-status--error';
                return false;
            }
        }

        statusEl.textContent = `Valid \u2014 patch "${patchName}" ready.`;
        statusEl.className = 'patch-editor-status patch-editor-status--ok';
        return true;
    }

    _saveEdit(patch, filename, newYaml, container) {
        const rawLines = this.patchFiles[filename].raw.split('\n');
        const before = rawLines.slice(0, patch.lineStart);
        const after = rawLines.slice(patch.lineEnd);
        const updatedRaw = before.join('\n') + (before.length > 0 ? '\n' : '') + newYaml + (after.length > 0 ? '\n' : '') + after.join('\n');

        const oldPatches = this.patchFiles[filename].patches;
        this.patchFiles[filename].raw = updatedRaw;
        this.patchFiles[filename].patches = parsePatchYAML(updatedRaw);

        for (const newPatch of this.patchFiles[filename].patches) {
            const old = oldPatches.find(p => p.name === newPatch.name);
            if (old && newPatch.name !== patch.name) {
                newPatch.enabled = old.enabled;
            }
        }

        this.render(container);
        this._updateCounts(container);
    }

    /**
     * Count total enabled patches across all files.
     */
    getEnabledCount() {
        let count = 0;
        for (const [, { patches }] of Object.entries(this.patchFiles)) {
            count += patches.filter(p => p.enabled).length;
        }
        return count;
    }

    /**
     * Get names of all enabled patches across all files.
     */
    getEnabledPatches() {
        const names = [];
        for (const [, { patches }] of Object.entries(this.patchFiles)) {
            for (const p of patches) {
                if (p.enabled) names.push(p.name);
            }
        }
        return names;
    }

    /**
     * Build the overrides map for the WASM patcher.
     */
    getOverrides() {
        const overrides = {};
        for (const [filename, { patches }] of Object.entries(this.patchFiles)) {
            overrides[filename] = {};
            for (const patch of patches) {
                overrides[filename][patch.name] = patch.enabled;
            }
        }
        return overrides;
    }

    /**
     * Generate the kobopatch.yaml config string with current overrides.
     */
    generateConfig() {
        const overrides = this.getOverrides();
        let yaml = `version: "${this.firmwareVersion}"\n`;
        yaml += `in: firmware.zip\n`;
        yaml += `out: out/KoboRoot.tgz\n`;
        yaml += `log: out/log.txt\n`;
        yaml += `patchFormat: kobopatch\n`;
        yaml += `\npatches:\n`;
        for (const [filename, target] of Object.entries(this.patchConfig)) {
            yaml += `  ${filename}: ${target}\n`;
        }
        yaml += `\noverrides:\n`;
        for (const [filename, patches] of Object.entries(overrides)) {
            yaml += `  ${filename}:\n`;
            for (const [name, enabled] of Object.entries(patches)) {
                yaml += `    ${name}: ${enabled ? 'yes' : 'no'}\n`;
            }
        }
        return yaml;
    }

    /**
     * Get raw patch file contents as a map for the WASM patcher.
     */
    getPatchFileBytes() {
        const files = {};
        for (const [filename, { raw }] of Object.entries(this.patchFiles)) {
            files[filename] = new TextEncoder().encode(raw);
        }
        return files;
    }

}

export { PatchUI, scanAvailablePatches };
