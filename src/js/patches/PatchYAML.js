/**
 * PatchYAML.js — Pure parsing and serialization for kobopatch YAML.
 *
 * No DOM, no state: just functions that read patch metadata, rewrite patch
 * line ranges, and quote scalars. Shared by the PatchUI model, the editor
 * dialog, and the unit tests.
 */

import yaml from 'js-yaml';

/**
 * Extract the key name from a top-level YAML mapping line, or null if the line
 * is not a top-level key (indented, blank, a comment, or a list item).
 *
 * A top-level key starts at column 0 and is followed by a colon that is either
 * at end-of-line or followed by whitespace (YAML's rule for `key:` vs a plain
 * `name:value` scalar). Handles trailing spaces, inline comments, and quoting.
 */
function topLevelKeyName(line) {
    if (!line || /^[\s#]/.test(line)) return null;
    const match = line.match(/^(.+?)\s*:(?:\s.*)?$/);
    if (!match) return null;
    let key = match[1].trim();
    if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
        key = key.slice(1, -1);
    }
    return key;
}

function isBlank(line) {
    return line.trim() === '';
}

function isTopLevelComment(line) {
    return line.startsWith('#');
}

function patchLineEnd(lines, lineStart, nominalEnd) {
    let beforeTrailingBlanks = nominalEnd;
    while (beforeTrailingBlanks > lineStart && isBlank(lines[beforeTrailingBlanks - 1])) {
        beforeTrailingBlanks--;
    }

    if (beforeTrailingBlanks <= lineStart || !isTopLevelComment(lines[beforeTrailingBlanks - 1])) {
        return nominalEnd;
    }

    let commentStart = beforeTrailingBlanks;
    while (commentStart > lineStart && isTopLevelComment(lines[commentStart - 1])) {
        commentStart--;
    }

    if (commentStart > lineStart && isBlank(lines[commentStart - 1])) {
        return commentStart;
    }

    return nominalEnd;
}

/**
 * Parse a kobopatch YAML file and extract patch metadata.
 * Returns an array of patch objects with: name, enabled, description, patchGroup,
 * lineStart (0-indexed), and lineEnd (exclusive).
 *
 * Field values are derived from a single js-yaml parse so that what we report
 * here always agrees with what the editor's validator (also js-yaml) accepts.
 * The raw lines are only used to record each patch's line range, which the
 * editor needs for surgical text replacement on save.
 */
export function parsePatchYAML(content) {
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');

    let doc;
    try {
        doc = yaml.load(normalized);
    } catch {
        doc = null;
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        return [];
    }

    const names = new Set(Object.keys(doc));

    // Locate the starting line of each patch by matching top-level keys against
    // the names js-yaml actually parsed. Tying detection to known keys avoids the
    // guesswork (and corruption risk) of inferring boundaries from punctuation.
    const boundaries = [];
    for (let i = 0; i < lines.length; i++) {
        const key = topLevelKeyName(lines[i]);
        if (key !== null && names.has(key)) {
            boundaries.push({ name: key, lineStart: i });
        }
    }

    return boundaries.map((boundary, idx) => {
        const nominalEnd = idx + 1 < boundaries.length ? boundaries[idx + 1].lineStart : lines.length;
        const lineEnd = patchLineEnd(lines, boundary.lineStart, nominalEnd);
        const body = doc[boundary.name];
        const items = Array.isArray(body) ? body : [];

        let enabled = false;
        let description = '';
        let patchGroup = null;
        for (const item of items) {
            if (!item || typeof item !== 'object') continue;
            if ('Enabled' in item) enabled = item.Enabled === 'yes' || item.Enabled === true;
            if ('Description' in item && item.Description !== null) description = String(item.Description).trim();
            if ('PatchGroup' in item && item.PatchGroup !== null) patchGroup = String(item.PatchGroup).trim();
        }

        return { name: boundary.name, enabled, description, patchGroup, lineStart: boundary.lineStart, lineEnd };
    });
}

/**
 * Replace the line range [lineStart, lineEnd) of `raw` with `replacement`,
 * operating entirely on line arrays so boundaries can't produce stray or
 * missing newlines. Trailing newlines on the replacement are trimmed to avoid
 * doubling up against the lines that follow.
 */
export function replacePatchLines(raw, lineStart, lineEnd, replacement) {
    const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const before = lines.slice(0, lineStart);
    const after = lines.slice(lineEnd);
    const replacementLines = replacement.replace(/\n+$/, '').split('\n');
    return [...before, ...replacementLines, ...after].join('\n');
}

/**
 * Quote a string for safe use as a YAML scalar (mapping key or value).
 * Plain scalars are returned as-is; anything containing YAML-significant
 * characters is double-quoted with backslashes and quotes escaped.
 */
export function yamlScalar(str) {
    const s = String(str);
    // Safe if it's a non-empty run of unambiguous plain-scalar characters and
    // doesn't collide with a boolean/null-ish token that would change meaning.
    if (s.length > 0 && /^[A-Za-z0-9 ._/+()-]+$/.test(s) && !/^[-.]/.test(s) && !/^(yes|no|true|false|null|~|on|off)$/i.test(s)) {
        return s;
    }
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
