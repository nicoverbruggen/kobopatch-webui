/**
 * ui.js — The PatchUI model.
 *
 * Owns the loaded patch state: parsing patch zips, blacklist lookups,
 * enabled/disabled selections, manual-edit tracking, reload-manifest
 * application, and config generation for the WASM patcher. DOM rendering lives
 * in patch-list-view.js and the editor dialog in patch-editor.js; this class
 * holds the state both of those operate on and exposes `render()` as the entry
 * point into the view.
 */

import JSZip from 'jszip';
import { fetchOrThrow } from '../shell/dom.js';
import { parsePatchYAML, replacePatchLines, yamlScalar, parsePatchConfig } from './patch-yaml.js';
import { renderPatchList, updatePatchCounts } from './patch-list-view.js';
import { fetchPatchBlacklist } from './catalog.js';

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
        // Pristine patch text keyed by filename -> name, captured at load time so
        // edits can be detected (and reverts cleared) by comparison.
        this.pristineText = {};
        // Names of user-edited patches keyed by filename -> Set<name>.
        this.modifiedPatches = {};
        // Called when patch selection changes
        this.onChange = null;
    }

    /** Load the blacklist of incompatible patches. */
    async loadBlacklist() {
        this.blacklist = await fetchPatchBlacklist();
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

        // Load each patch YAML file referenced in the config. A fresh load is a
        // clean slate, so any previously tracked edits are discarded here.
        this.patchFiles = {};
        this.pristineText = {};
        this.modifiedPatches = {};
        for (const filename of Object.keys(patches)) {
            const yamlFile = zip.file(filename);
            if (!yamlFile) {
                console.warn('Patch file referenced in config but missing from zip:', filename);
                continue;
            }
            const raw = await yamlFile.async('string');
            const parsed = parsePatchYAML(raw);
            this.patchFiles[filename] = { raw, patches: parsed };
            this.pristineText[filename] = {};
            for (const p of parsed) {
                this.pristineText[filename][p.name] = this._patchText(raw, p.lineStart, p.lineEnd);
            }
        }
    }

    /** Extract and normalize a patch's text block for edit comparison. */
    _patchText(raw, lineStart, lineEnd) {
        return raw
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split('\n')
            .slice(lineStart, lineEnd)
            .map((l) => l.replace(/\s+$/, ''))
            .join('\n')
            .replace(/\n+$/, '');
    }

    /** Whether a patch's definition differs from its pristine loaded form. */
    isModified(filename, name) {
        return !!this.modifiedPatches[filename]?.has(name);
    }

    /** Whether any patch across any file has been edited by the user. */
    hasEdits() {
        return Object.values(this.modifiedPatches).some((set) => set.size > 0);
    }

    /**
     * Load patches from a URL pointing to a zip file.
     */
    async loadFromURL(url) {
        const resp = await fetchOrThrow(url, 'Failed to fetch patch zip');
        const data = await resp.arrayBuffer();
        await this.loadFromZip(data);
    }

    /** Render the patch configuration UI into a container element. */
    render(container) {
        renderPatchList(this, container);
    }

    /**
     * Apply an edited patch block: rewrite the file text, reparse, restore live
     * toggle state, and track the modification. `displayedEnabled` is the Enabled
     * value the editor opened with (or undefined), passed in by the editor so the
     * model never has to reach back into editor state.
     */
    applyEdit(patch, filename, newYaml, container, displayedEnabled) {
        const updatedRaw = replacePatchLines(this.patchFiles[filename].raw, patch.lineStart, patch.lineEnd, newYaml);

        const oldPatches = this.patchFiles[filename].patches;
        this.patchFiles[filename].raw = updatedRaw;
        this.patchFiles[filename].patches = parsePatchYAML(updatedRaw);

        // The reparse derives `enabled` from each patch's file text, but the live
        // toggle state lives on the patch objects, not in the file. Restore it so
        // an edit doesn't reset selections to the file's defaults.
        const editedName = parsePatchYAML(newYaml)[0]?.name ?? patch.name;

        for (const newPatch of this.patchFiles[filename].patches) {
            if (newPatch.name === editedName) {
                // Keep the edited patch's live toggle unless the user actually
                // changed the Enabled line in the editor itself.
                const enabledEditedInPlace = displayedEnabled !== undefined && newPatch.enabled !== displayedEnabled;
                if (!enabledEditedInPlace) newPatch.enabled = patch.enabled;
            } else {
                const old = oldPatches.find((p) => p.name === newPatch.name);
                if (old) newPatch.enabled = old.enabled;
            }
        }

        this._trackEdit(filename, patch.name, newYaml);

        this.render(container);
        updatePatchCounts(this, container);
    }

    /**
     * Update the modified-patch set after an edit. The edit is flagged as a
     * modification unless it restores the patch to its pristine loaded form, in
     * which case the flag is cleared. The patch name may have changed, so the
     * edited name is derived from the new YAML. Returns the edited name.
     */
    _trackEdit(filename, oldName, newYaml) {
        const editedName = parsePatchYAML(newYaml)[0]?.name ?? oldName;
        const set = this.modifiedPatches[filename] || (this.modifiedPatches[filename] = new Set());
        set.delete(oldName);
        const pristine = this.pristineText[filename]?.[editedName];
        if (pristine !== undefined && this._patchText(newYaml, 0, newYaml.split('\n').length) === pristine) {
            set.delete(editedName);
        } else {
            set.add(editedName);
        }
        return editedName;
    }

    /**
     * Count total enabled patches across all files.
     */
    getEnabledCount() {
        let count = 0;
        for (const [, { patches }] of Object.entries(this.patchFiles)) {
            count += patches.filter((p) => p.enabled).length;
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
     * Capture user-edited patches as raw YAML blocks, keyed by filename → name.
     * Only patches actually modified from their pristine loaded form are included,
     * so a reload can transfer manual edits as-is. Enabled/disabled state is not
     * stored here (that travels in the overrides map).
     */
    getCustomizations() {
        const result = {};
        for (const [filename, set] of Object.entries(this.modifiedPatches)) {
            if (!set || set.size === 0) continue;
            const file = this.patchFiles[filename];
            if (!file) continue;
            const lines = file.raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            const out = {};
            for (const name of set) {
                const p = file.patches.find((pp) => pp.name === name);
                if (!p) continue;
                out[name] = lines.slice(p.lineStart, p.lineEnd).join('\n').replace(/\n+$/, '');
            }
            if (Object.keys(out).length > 0) result[filename] = out;
        }
        return result;
    }

    /**
     * Re-apply a previously saved manifest to the currently loaded patches:
     * first the manual edits (`customized`), then the enabled/disabled state
     * (`overrides`). Entries referencing a file or patch that is not present in
     * the current set (e.g. a different firmware version) are skipped and counted
     * as `missing`. Returns `{ edits, enabled, missing }`.
     */
    applyReloadManifest(manifest) {
        const summary = { matched: 0, edits: 0, enabled: 0, missing: 0 };
        if (!manifest || typeof manifest !== 'object') return summary;

        // Manual edits first, reparsing after each so later lookups (and override
        // matching) see the final patch text and any shifted line ranges.
        for (const [filename, patches] of Object.entries(manifest.customized || {})) {
            const file = this.patchFiles[filename];
            if (!file || !patches || typeof patches !== 'object') {
                summary.missing += patches ? Object.keys(patches).length : 0;
                continue;
            }
            for (const [name, text] of Object.entries(patches)) {
                const p = file.patches.find((pp) => pp.name === name);
                if (!p) {
                    summary.missing++;
                    continue;
                }
                file.raw = replacePatchLines(file.raw, p.lineStart, p.lineEnd, text);
                file.patches = parsePatchYAML(file.raw);
                this._trackEdit(filename, name, text);
                summary.edits++;
            }
        }

        // Then enabled/disabled selections.
        for (const [filename, patches] of Object.entries(manifest.overrides || {})) {
            const file = this.patchFiles[filename];
            if (!file || !patches || typeof patches !== 'object') continue;
            for (const p of file.patches) {
                if (Object.prototype.hasOwnProperty.call(patches, p.name)) {
                    p.enabled = !!patches[p.name];
                    summary.matched++;
                    if (p.enabled) summary.enabled++;
                }
            }
        }

        return summary;
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
                yaml += `    ${yamlScalar(name)}: ${enabled ? 'yes' : 'no'}\n`;
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

export { PatchUI };
