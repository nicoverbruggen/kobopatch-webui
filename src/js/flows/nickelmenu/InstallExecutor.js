/**
 * InstallExecutor.js — Executes the NickelMenu install/remove writes.
 *
 * The NickelMenu flow (flows/nickelmenu/) owns the wizard UI; this module runs
 * the actual device writes (or builds the download ZIP) once the user commits,
 * and renders the final "done" screen for each outcome (remove / write / download).
 */

import { renderDownloadConfSettings } from '../../shell/DOM.js';
import { triggerDownload, setProgressDetail } from '../../shell/Transfer.js';
import { TL } from '../../shell/Strings.js';
import { track } from '../../shell/Analytics.js';
import { AuditLog } from '../../kobo/AuditLog.js';
import { DeviceWriter } from '../../kobo/DeviceWriter.js';
import { executeNickelMenuFeatureCleanups, executeNickelMenuRemoval } from '../../nickelmenu/Uninstaller.js';
import { featuresToInstall, featuresToRemove, alwaysCleanupFeatures, optionalCleanupToRemove } from '../../nickelmenu/Selection.js';
import { featureAnalyticsEvents } from '../../nickelmenu/features/index.js';
import { getExcludeSyncFoldersLine } from '../../nickelmenu/NickelMenuInstaller.js';
import { CONF_DESC_DEFAULT, CONF_DESC_EXCLUDE_CALIBRE } from '../../shell/Instructions.js';

const NM_LEGACY_ITEMS_FILE = '.adds/nm/items';

function trackFeatures(features) {
    for (const event of featureAnalyticsEvents(features)) track(event);
}

/**
 * Run the NickelMenu install, removal, or download build.
 *
 * The four values taken from the device probe are passed as plain values rather
 * than as the `DetectedInstallation` itself, so each is read when the button is
 * pressed rather than at some point inside this async function. That is the same
 * rule Phase 2a applied to the two it already extracted.
 *
 * @param {object} opts
 * @param {object} opts.state - the shared wizard session, for the device and installer
 * @param {object} opts.selection - the user's NickelMenu choices
 * @param {object} opts.outcome - written here: which path ran, and the built ZIP
 * @param {object} opts.flow - the step machine flow, for the installing/done transitions
 * @param {object|null} opts.previousConfiguration - the previous preset configuration, for feature reconciles
 * @param {string[]} opts.installedFeatureIds - feature ids the device probe found installed
 * @param {object[]} opts.optionalCleanupFeatures - optional cleanups the device probe found
 * @param {boolean} opts.legacyItemsDetected - a pre-existing `.adds/nm/items` file was found
 * @param {{progress: HTMLElement, progressDetail: HTMLElement, writeToDevice: boolean}} opts.dom
 * @param {function} opts.showError
 */
export async function executeNmInstall({
    state,
    selection,
    outcome,
    flow,
    previousConfiguration,
    installedFeatureIds,
    optionalCleanupFeatures,
    legacyItemsDetected,
    dom,
    showError,
}) {
    const progressFn = (msg, detail = null, fraction = null) => {
        dom.progress.textContent = msg;
        setProgressDetail(dom.progressDetail, detail, fraction);
    };
    let audit = null;
    // The step's markup is static, so a retry (or a download after an install)
    // would otherwise show the previous run's status and part-filled bar until
    // the first report replaces them.
    progressFn(TL.STATUS.BUILDING_STARTING);
    await flow.go('installing', state);

    try {
        if (selection.option === 'remove') {
            audit = new AuditLog('remove-nickelmenu', new Date(), state.device);
            const writer = new DeviceWriter(state.device);
            await executeNickelMenuRemoval({
                device: writer,
                installer: state.nmInstaller,
                cleanupFeatures: [...alwaysCleanupFeatures(), ...optionalCleanupToRemove(selection, optionalCleanupFeatures)],
                shouldRemoveSyncExclusions: async () => {
                    const entries = await state.device.listDirectory(['.adds']);
                    return !entries.some((entry) => entry.kind === 'directory' && entry.name !== 'nm');
                },
                onProgress: progressFn,
                audit,
            });
            outcome.mode = 'remove';
            await flow.go('done', state);
            return;
        }

        const features = selection.option === 'preset' ? featuresToInstall(selection, state.device.deviceInfo) : [];
        trackFeatures(features);

        if (dom.writeToDevice && state.device.directoryHandle) {
            const writer = new DeviceWriter(state.device);
            audit = new AuditLog('install-nickelmenu', new Date(), state.device);
            await executeNickelMenuFeatureCleanups({
                device: writer,
                features: featuresToRemove(selection, installedFeatureIds, state.device.deviceInfo),
                onProgress: progressFn,
                audit,
            });
            for (const feature of features) {
                if (!feature.reconcile) continue;
                progressFn(`Updating ${feature.title.toLowerCase()}...`);
                await feature.reconcile({
                    device: writer,
                    deviceInfo: state.device.deviceInfo,
                    features,
                    previousConfiguration,
                    menuCustomization: selection.menuCustomization,
                    tabsCustomization: selection.tabsCustomization,
                    fontsCustomization: selection.fontsCustomization,
                    audit,
                });
            }
            if (legacyItemsDetected && selection.option === 'preset') {
                if (!selection.keepLegacyConfig) {
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
            await state.nmInstaller.installToDevice(writer, features, progressFn, {
                audit,
                menuCustomization: selection.menuCustomization,
                tabsCustomization: selection.tabsCustomization,
                fontsCustomization: selection.fontsCustomization,
            });
            outcome.mode = 'written';
            await flow.go('done', state);
        } else {
            outcome.zip = await state.nmInstaller.buildDownloadZip(features, progressFn, state.device.deviceInfo, {
                menuCustomization: selection.menuCustomization,
                tabsCustomization: selection.tabsCustomization,
                fontsCustomization: selection.fontsCustomization,
                isPreset: selection.option === 'preset',
            });
            outcome.mode = 'download';
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
            title: selection.option === 'remove' ? TL.ERROR.NM_REMOVE_FAILED_TITLE : TL.ERROR.NM_INSTALL_FAILED_TITLE,
        });
    }
}

function getFeatureConfSettings(features, deviceInfo, fontsCustomization = null) {
    const ctx = { deviceInfo: deviceInfo ?? null, features, fontsCustomization };
    return features.flatMap((feature) => (feature.confSettings ? feature.confSettings(ctx) : []));
}

/**
 * Render the done screen for whichever path `executeNmInstall` took.
 *
 * @param {object} state - the shared wizard session, for the device info
 * @param {object} selection - the user's NickelMenu choices
 * @param {object} outcome - what the run produced
 * @param {object} terminal - the flow's terminal, for the end event and feedback
 * @param {object} dom - the done screen's elements
 */
export function renderNmDoneStatus(state, selection, outcome, terminal, dom) {
    dom.doneStatus.textContent = '';
    dom.writeInstructions.hidden = true;
    dom.downloadInstructions.hidden = true;
    dom.rebootInstructions.hidden = true;

    if (outcome.mode === 'remove') {
        dom.doneStatus.textContent = TL.STATUS.NM_REMOVED_ON_REBOOT;
        dom.rebootInstructions.hidden = false;
        terminal.end('nm-remove');
    } else if (outcome.mode === 'written') {
        dom.doneStatus.textContent = TL.STATUS.NM_INSTALLED;
        dom.writeInstructions.hidden = false;
        terminal.end('nm-write');
    } else {
        dom.doneStatus.textContent = TL.STATUS.NM_DOWNLOAD_READY;
        triggerDownload(outcome.zip, 'NickelMenu-install.zip', 'application/zip');
        dom.downloadInstructions.hidden = false;
        const features = selection.option === 'preset' ? featuresToInstall(selection, state.device.deviceInfo) : [];
        const hasExcludeCalibre = features.some((f) => f.id === 'exclude-calibre');
        dom.downloadConfStep.hidden = selection.option !== 'preset';
        dom.downloadRebootStep.hidden = selection.option !== 'preset';
        dom.downloadConfLine.textContent = getExcludeSyncFoldersLine(features);
        dom.downloadConfDesc.textContent = hasExcludeCalibre ? CONF_DESC_EXCLUDE_CALIBRE : CONF_DESC_DEFAULT;
        const confSettings = getFeatureConfSettings(features, state.device.deviceInfo, selection.fontsCustomization);
        renderDownloadConfSettings(dom.downloadConfSettings, confSettings);
        dom.downloadConfSettingsStep.hidden = confSettings.length === 0;
        terminal.end('nm-download');
    }

    terminal.wireFeedback();
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
