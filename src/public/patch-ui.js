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
 * We only need: name, enabled, description, patchGroup.
 * This is a targeted parser, not a full YAML parser.
 */
function parsePatchYAML(content) {
    const patches = [];
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Top-level key (patch name): not indented, ends with ':'
        // Skip comments and blank lines
        if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('#') && line.endsWith(':')) {
            const name = line.slice(0, -1).trim();
            const patch = { name, enabled: false, description: '', patchGroup: null };
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
 * Returns an array of { filename, version } sorted by version descending.
 */
async function scanAvailablePatches() {
    try {
        const resp = await fetch('patches/index.json');
        if (!resp.ok) return [];
        const list = await resp.json();
        return list;
    } catch {
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
        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error('Failed to fetch patch zip: ' + resp.statusText);
        }
        const data = await resp.arrayBuffer();
        await this.loadFromZip(data);
    }

    /**
     * Render the patch configuration UI into a container element.
     */
    render(container) {
        container.innerHTML = '';

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

            for (const patch of patches) {
                const item = document.createElement('div');
                item.className = 'patch-item';

                const header = document.createElement('label');
                header.className = 'patch-header';

                const input = document.createElement('input');
                const isGrouped = patch.patchGroup && patchGroups[patch.patchGroup].length > 1;

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

                if (patch.patchGroup) {
                    const groupBadge = document.createElement('span');
                    groupBadge.className = 'patch-group-badge';
                    groupBadge.textContent = patch.patchGroup;
                    header.appendChild(groupBadge);
                }

                item.appendChild(header);

                if (patch.description) {
                    const desc = document.createElement('p');
                    desc.className = 'patch-description';
                    desc.textContent = patch.description;
                    item.appendChild(desc);
                }

                list.appendChild(item);
            }

            section.appendChild(list);
            container.appendChild(section);
        }
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
