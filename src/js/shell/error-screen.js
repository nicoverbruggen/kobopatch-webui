/**
 * error-screen.js — The shared error step and global error handling.
 *
 * Owns `step-error` and exposes `state.showError(message, log, options)` for
 * every flow to call. Also installs the global `error` / `unhandledrejection`
 * handlers that surface unexpected failures on the same screen.
 */

import { TL } from './strings.js';
import { collect, triggerDownload } from './dom.js';
import { showStep, showNav, hideNav, stepHistory } from './navigation.js';
import { getActiveFlow } from './step-machine.js';

export function initErrorScreen(state) {
    const {
        'step-error': stepError,
        'step-patches': stepPatches,
        'btn-retry': btnRetry,
        'btn-error-back': btnErrorBack,
        'btn-error-download-log': btnErrorDownloadLog,
        'error-message': errorMessage,
        'error-log': errorLog,
        'error-title': errorTitle,
        'error-hint': errorHint,
        'error-device-write-help': errorDeviceWriteHelp,
    } = collect([
        'step-error', 'step-patches',
        'btn-retry', 'btn-error-back', 'btn-error-download-log',
        'error-message', 'error-log', 'error-title', 'error-hint', 'error-device-write-help',
    ]);

    let errorAuditLog = null;

    function showError(message, log, options = {}) {
        errorAuditLog = options.auditLog || null;
        errorMessage.textContent = message;
        errorDeviceWriteHelp.hidden = !options.deviceWrite;
        btnErrorDownloadLog.hidden = !errorAuditLog;
        if (log) {
            errorLog.textContent = log;
            errorLog.hidden = false;
            requestAnimationFrame(() => {
                errorLog.scrollTop = errorLog.scrollHeight;
            });
        } else {
            errorLog.hidden = true;
        }

        const flow = getActiveFlow();
        const hasRecovery = flow && flow.recoveryTarget() && flow.current();
        const hasBackStep = stepHistory.includes(stepPatches);

        if (options.deviceWrite) {
            if (options.writeProbe) {
                errorTitle.textContent = TL.ERROR.DEVICE_PROBE_FAILED_TITLE;
                errorMessage.textContent = TL.ERROR.DEVICE_PROBE_FAILED_MESSAGE;
            } else {
                errorTitle.textContent = TL.ERROR.DEVICE_WRITE_FAILED_TITLE;
                errorMessage.textContent = TL.ERROR.DEVICE_WRITE_FAILED_MESSAGE;
            }
            errorHint.hidden = true;
            btnErrorBack.hidden = true;
            btnRetry.classList.remove('danger');
        } else if (options.title) {
            errorTitle.textContent = options.title;
            errorHint.hidden = true;
            btnErrorBack.hidden = true;
            btnRetry.classList.remove('danger');
        } else if (hasRecovery) {
            errorTitle.textContent = TL.ERROR.PATCH_FAILED;
            errorHint.hidden = false;
            btnErrorBack.hidden = false;
            btnRetry.classList.add('danger');
        } else if (hasBackStep) {
            errorTitle.textContent = TL.ERROR.PATCH_FAILED;
            errorHint.hidden = false;
            btnErrorBack.hidden = false;
            btnRetry.classList.add('danger');
        } else {
            errorTitle.textContent = TL.ERROR.SOMETHING_WENT_WRONG;
            errorHint.hidden = true;
            btnErrorBack.hidden = true;
            btnRetry.classList.remove('danger');
        }
        hideNav();
        showStep(stepError);
    }

    state.showError = showError;

    let handlingUnexpectedError = false;
    function handleUnexpectedError(err) {
        if (handlingUnexpectedError) return;
        if (err && err.name === 'AbortError') return;
        handlingUnexpectedError = true;
        try {
            const detail = err ? (err.stack || err.message || String(err)) : 'Unknown error';
            showError(TL.ERROR.UNEXPECTED_MESSAGE, detail, { title: TL.ERROR.UNEXPECTED_TITLE });
        } catch (e) {
            console.error('Failed to display the error screen:', e);
        } finally {
            handlingUnexpectedError = false;
        }
    }

    window.addEventListener('error', (event) => {
        if (!event.error) return;
        handleUnexpectedError(event.error);
    });
    window.addEventListener('unhandledrejection', (event) => {
        handleUnexpectedError(event.reason);
    });

    btnErrorBack.addEventListener('click', () => {
        const flow = getActiveFlow();
        const recoveryDomId = flow && flow.recoveryTarget();

        if (recoveryDomId) {
            showNav();
            btnErrorBack.hidden = true;
            btnErrorDownloadLog.hidden = true;
            errorAuditLog = null;
            btnRetry.classList.remove('danger');
            const recoveryDomStep = document.getElementById(recoveryDomId);
            if (recoveryDomStep) {
                showStep(recoveryDomStep);
            }
            return;
        }

        btnErrorBack.hidden = true;
        btnErrorDownloadLog.hidden = true;
        errorAuditLog = null;
        btnRetry.classList.remove('danger');
        stepHistory.pop();
        while (stepHistory.length > 0 && stepHistory[stepHistory.length - 1] !== stepPatches) {
            stepHistory.pop();
        }
        showNav();
        showStep(stepPatches);
    });

    btnErrorDownloadLog.addEventListener('click', () => {
        if (!errorAuditLog) return;
        const filename = errorAuditLog.path[errorAuditLog.path.length - 1] || 'kobopatch-webui.log';
        triggerDownload(errorAuditLog.render(), filename, 'text/plain');
    });

    btnRetry.addEventListener('click', () => {
        location.reload();
    });

    return { showError };
}
