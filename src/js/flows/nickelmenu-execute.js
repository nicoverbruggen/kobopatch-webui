import { triggerDownload, setProgressDetail } from '../shell/dom.js';
import { TL } from '../shell/strings.js';
import { track } from '../shell/analytics.js';
import { AuditLog } from '../kobo/audit-log.js';
import { DeviceWriter } from '../kobo/device-writer.js';
import { executeNickelMenuRemoval } from '../nickelmenu/uninstaller.js';
import { featuresToInstall, alwaysCleanupFeatures, optionalCleanupToRemove } from '../nickelmenu/selection.js';
import { getExcludeSyncFoldersLine } from '../nickelmenu/installer.js';
import { CONF_DESC_DEFAULT, CONF_DESC_EXCLUDE_CALIBRE } from '../shell/instructions.js';

const NM_LEGACY_ITEMS_FILE = '.adds/nm/items';

function trackFeatures(features) {
    if (features.some((f) => f.id === 'koreader')) track('add-koreader');
    if (features.some((f) => f.id === 'nickelclock')) track('add-nickelclock');
    if (features.some((f) => f.id === 'cadmus')) track('add-cadmus');
    if (features.some((f) => f.id === 'additional-fonts')) track('add-fonts');
    if (features.some((f) => f.id === 'screensaver')) track('add-screensaver');
    if (features.some((f) => ['hide-recommendations', 'hide-row2col2', 'hide-notices'].includes(f.id))) track('add-minimal-home');
    if (features.some((f) => f.id === 'simplify-tabs')) track('add-basic-tabs');
    if (features.some((f) => f.id === 'sideloaded-mode')) track('add-sideloaded-mode');
}

export async function executeNmInstall({ state, flow, _terminal, dom, showError }) {
    const progressFn = (msg, detail = null, fraction = null) => {
        dom.progress.textContent = msg;
        setProgressDetail(dom.progressDetail, detail, fraction);
    };
    let audit = null;
    await flow.go('installing', state);

    try {
        if (state.nickelMenuOption === 'remove') {
            audit = new AuditLog('remove-nickelmenu', new Date(), state.device);
            const writer = new DeviceWriter(state.device);
            await executeNickelMenuRemoval({
                device: writer,
                installer: state.nmInstaller,
                cleanupFeatures: [...alwaysCleanupFeatures(), ...optionalCleanupToRemove(state, dom.detectedOptionalCleanupFeatures)],
                shouldRemoveSyncExclusions: async () => {
                    const entries = await state.device.listDirectory(['.adds']);
                    return !entries.some((entry) => entry.kind === 'directory' && entry.name !== 'nm');
                },
                onProgress: progressFn,
                audit,
            });
            state._nmDoneMode = 'remove';
            await flow.go('done', state);
            return;
        }

        const features = state.nickelMenuOption === 'preset' ? featuresToInstall(state, state.device.deviceInfo) : [];
        trackFeatures(features);

        if (dom.writeToDevice && state.device.directoryHandle) {
            const writer = new DeviceWriter(state.device);
            if (dom.legacyItemsDetected && state.nickelMenuOption === 'preset') {
                if (!state.nmKeepLegacyConfig) {
                    try {
                        await writer.removeEntry(NM_LEGACY_ITEMS_FILE.split('/'));
                    } catch {}
                }
            }
            try {
                const legacyScriptPath = ['.adds', 'scripts', 'toggle_typography.sh'];
                if (await writer.pathExists(legacyScriptPath)) {
                    await writer.removeEntry(legacyScriptPath);
                }
            } catch {}
            audit = new AuditLog('install-nickelmenu', new Date(), state.device);
            await state.nmInstaller.installToDevice(writer, features, progressFn, {
                audit,
                menuCustomization: state.nickelMenuCustomization,
            });
            state._nmDoneMode = 'written';
            await flow.go('done', state);
        } else {
            state.resultNmZip = await state.nmInstaller.buildDownloadZip(features, progressFn, state.device.deviceInfo, {
                menuCustomization: state.nickelMenuCustomization,
                isPreset: state.nickelMenuOption === 'preset',
            });
            state._nmDoneMode = 'download';
            await flow.go('done', state);
        }
    } catch (err) {
        // A failure during a device write means the connection or filesystem may
        // be unreliable, so we stop here without trying to undo anything. A read
        // failure on the config file (not a write) is treated as a connection
        // issue too, but didn't change anything on the device.
        const configReadFailed = !err.deviceWrite && /Kobo eReader\.conf/.test(err.message || '');
        audit?.record(`Failed: ${err.message}`);
        showError(TL.STATUS.NM_INSTALL_FAILED(err.message), null, {
            deviceWrite: !!err.deviceWrite,
            connectionTips: configReadFailed,
            configReadFailed,
            auditLog: audit,
            title: state.nickelMenuOption === 'remove' ? TL.ERROR.NM_REMOVE_FAILED_TITLE : TL.ERROR.NM_INSTALL_FAILED_TITLE,
        });
    }
}

function getFeatureConfSettings(features, deviceInfo) {
    const ctx = { deviceInfo: deviceInfo ?? null, features };
    return features.flatMap((feature) => (feature.confSettings ? feature.confSettings(ctx) : []));
}

export function renderNmDoneStatus(state, terminal, dom) {
    dom.doneStatus.textContent = '';
    dom.writeInstructions.hidden = true;
    dom.downloadInstructions.hidden = true;
    dom.rebootInstructions.hidden = true;

    if (state._nmDoneMode === 'remove') {
        dom.doneStatus.textContent = TL.STATUS.NM_REMOVED_ON_REBOOT;
        dom.rebootInstructions.hidden = false;
        terminal.end('nm-remove');
    } else if (state._nmDoneMode === 'written') {
        dom.doneStatus.textContent = TL.STATUS.NM_INSTALLED;
        dom.writeInstructions.hidden = false;
        terminal.end('nm-write');
    } else {
        dom.doneStatus.textContent = TL.STATUS.NM_DOWNLOAD_READY;
        triggerDownload(state.resultNmZip, 'NickelMenu-install.zip', 'application/zip');
        dom.downloadInstructions.hidden = false;
        const features = state.nickelMenuOption === 'preset' ? featuresToInstall(state, state.device.deviceInfo) : [];
        const hasExcludeCalibre = features.some((f) => f.id === 'exclude-calibre');
        dom.downloadConfStep.hidden = state.nickelMenuOption !== 'preset';
        dom.downloadRebootStep.hidden = state.nickelMenuOption !== 'preset';
        dom.downloadConfLine.textContent = getExcludeSyncFoldersLine(features);
        dom.downloadConfDesc.textContent = hasExcludeCalibre ? CONF_DESC_EXCLUDE_CALIBRE : CONF_DESC_DEFAULT;
        const confSettings = getFeatureConfSettings(features, state.device.deviceInfo);
        renderDownloadConfSettings(dom.downloadConfSettings, confSettings);
        dom.downloadConfSettingsStep.hidden = confSettings.length === 0;
        terminal.end('nm-download');
    }

    terminal.wireFeedback();
}

function renderDownloadConfSettings(container, settings) {
    container.innerHTML = '';

    const sections = new Map();
    for (const { section, key, value } of settings) {
        if (!sections.has(section)) sections.set(section, []);
        sections.get(section).push(`${key}=${value}`);
    }

    for (const [section, lines] of sections) {
        const intro = document.createElement('p');
        const sectionCode = document.createElement('code');
        sectionCode.textContent = `[${section}]`;
        intro.append('In the ', sectionCode, ' section (add it if it is missing):');
        container.appendChild(intro);

        for (const line of lines) {
            const lineCode = document.createElement('code');
            lineCode.textContent = line;
            container.append(lineCode, document.createElement('br'));
        }
    }
}

export function renderReviewNotices(container, notices) {
    container.innerHTML = '';
    container.hidden = notices.length === 0;

    for (const notice of notices) {
        const banner = document.createElement('div');
        banner.className = `banner banner--${notice.type || 'info'}`;

        if (notice.title) {
            const heading = document.createElement('div');
            heading.className = 'banner-heading';
            heading.textContent = notice.title;
            banner.appendChild(heading);
        }

        for (const paragraphText of notice.paragraphs || []) {
            const paragraph = document.createElement('p');
            paragraph.textContent = paragraphText;
            banner.appendChild(paragraph);
        }

        if (notice.link) {
            const paragraph = document.createElement('p');
            const link = document.createElement('a');
            link.href = notice.link.href;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = notice.link.label;
            paragraph.append('See ', link, ' for details.');
            banner.appendChild(paragraph);
        }

        container.appendChild(banner);
    }
}
