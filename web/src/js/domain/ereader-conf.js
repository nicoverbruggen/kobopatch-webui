const SECTION_HEADER_PATTERN = /^\s*\[([^\]]+)\]\s*$/;
const FEATURE_SETTINGS_SECTION = 'FeatureSettings';
const EXCLUDE_SYNC_FOLDERS_KEY = 'ExcludeSyncFolders';

function detectNewline(content) {
    return content.includes('\r\n') ? '\r\n' : '\n';
}

function parseSettingLine(line) {
    const match = line.match(/^\s*([^=;\s][^=]*?)\s*=\s*(.*)$/);
    if (!match) return null;

    return {
        key: match[1].trim(),
        value: match[2].trim(),
    };
}

function splitConfLines(content) {
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
}

function parseEReaderConf(content = '') {
    const sections = [];
    let current = null;
    const lines = splitConfLines(content);

    for (let index = 0; index < lines.length; index++) {
        const raw = lines[index];
        const sectionMatch = raw.match(SECTION_HEADER_PATTERN);
        if (sectionMatch) {
            current = {
                name: sectionMatch[1].trim(),
                line: index,
                settings: {},
            };
            sections.push(current);
            continue;
        }

        if (!current) continue;

        const setting = parseSettingLine(raw);
        if (!setting) continue;

        current.settings[setting.key] = {
            value: setting.value,
            line: index,
        };
    }

    return { sections };
}

function findSectionBounds(lines, sectionName) {
    let start = -1;
    let end = lines.length;

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(SECTION_HEADER_PATTERN);
        if (!match) continue;

        if (match[1].trim() === sectionName) {
            start = i;
            continue;
        }

        if (start !== -1) {
            end = i;
            break;
        }
    }

    return start === -1 ? null : { start, end };
}

function setConfSetting(content = '', sectionName, key, value) {
    const newline = detectNewline(content);
    const hadTrailingNewline = content.endsWith('\n');
    const lines = splitConfLines(content);

    const bounds = findSectionBounds(lines, sectionName);
    const settingLine = `${key}=${value}`;

    if (!bounds) {
        if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
        lines.push(`[${sectionName}]`, settingLine);
        return lines.join(newline) + newline;
    }

    for (let i = bounds.start + 1; i < bounds.end; i++) {
        const setting = parseSettingLine(lines[i]);
        if (setting?.key === key) {
            lines[i] = settingLine;
            return lines.join(newline) + (hadTrailingNewline ? newline : '');
        }
    }

    lines.splice(bounds.start + 1, 0, settingLine);
    return lines.join(newline) + (hadTrailingNewline ? newline : '');
}

function removeConfSetting(content = '', sectionName, key) {
    const newline = detectNewline(content);
    const hadTrailingNewline = content.endsWith('\n');
    const lines = splitConfLines(content);
    const bounds = findSectionBounds(lines, sectionName);
    if (!bounds) return content;

    for (let i = bounds.start + 1; i < bounds.end; i++) {
        const setting = parseSettingLine(lines[i]);
        if (setting?.key === key) {
            lines.splice(i, 1);
            return lines.join(newline) + (hadTrailingNewline ? newline : '');
        }
    }

    return content;
}

function parseExcludeSyncFoldersLine(line) {
    const setting = parseSettingLine(line);
    if (!setting || setting.key !== EXCLUDE_SYNC_FOLDERS_KEY) {
        throw new Error('Expected an ExcludeSyncFolders setting line.');
    }

    return setting.value;
}

function normalizeKoboRegexValue(value) {
    return value.replaceAll('\\\\', '\\');
}

function createExcludeSyncFoldersMatcher(value) {
    const normalized = normalizeKoboRegexValue(value);
    return new RegExp(`^(?:${normalized})$`);
}

function validateExcludeSyncFoldersRegex(value) {
    const errors = [];
    let regex = null;

    try {
        regex = createExcludeSyncFoldersMatcher(value);
    } catch (err) {
        errors.push('ExcludeSyncFolders is not a valid regular expression: ' + err.message);
        return { valid: false, mode: null, errors };
    }

    const mode = value.includes('calibre|') ? 'calibre' : 'default';
    const shouldMatch = ['.adds', 'fonts/.hidden'];
    const shouldNotMatch = ['.kobo', '.adobe', 'fonts/regular.ttf'];

    if (mode === 'calibre') {
        shouldMatch.push('calibre');
    } else {
        shouldNotMatch.push('calibre');
    }

    for (const sample of shouldMatch) {
        if (!regex.test(sample)) {
            errors.push(`ExcludeSyncFolders should match ${sample}.`);
        }
    }

    for (const sample of shouldNotMatch) {
        if (regex.test(sample)) {
            errors.push(`ExcludeSyncFolders should not match ${sample}.`);
        }
    }

    return { valid: errors.length === 0, mode, errors };
}

function validateExcludeSyncFoldersLine(line) {
    try {
        const value = parseExcludeSyncFoldersLine(line);
        return {
            value,
            ...validateExcludeSyncFoldersRegex(value),
        };
    } catch (err) {
        return {
            valid: false,
            value: null,
            mode: null,
            errors: [err.message],
        };
    }
}

function setExcludeSyncFoldersLine(content, settingLine) {
    const value = parseExcludeSyncFoldersLine(settingLine);
    return setConfSetting(
        content,
        FEATURE_SETTINGS_SECTION,
        EXCLUDE_SYNC_FOLDERS_KEY,
        value
    );
}

function removeExcludeSyncFoldersLine(content) {
    return removeConfSetting(
        content,
        FEATURE_SETTINGS_SECTION,
        EXCLUDE_SYNC_FOLDERS_KEY
    );
}

export {
    EXCLUDE_SYNC_FOLDERS_KEY,
    FEATURE_SETTINGS_SECTION,
    createExcludeSyncFoldersMatcher,
    parseEReaderConf,
    parseExcludeSyncFoldersLine,
    removeExcludeSyncFoldersLine,
    setExcludeSyncFoldersLine,
    validateExcludeSyncFoldersLine,
    validateExcludeSyncFoldersRegex,
};
