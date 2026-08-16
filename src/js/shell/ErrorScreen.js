/**
 * ErrorScreen.js — The shared error step and global error handling.
 *
 * Owns `step-error` and the `showError(message, log, options)` every flow calls.
 * Also installs the global `error` / `unhandledrejection` handlers that surface
 * unexpected failures on the same screen.
 *
 * The global handling stays here rather than in its own module because
 * `#handleUnexpectedError` calls `showError` and shares its guard flag —
 * splitting the file would cut a genuine coupling. It is no longer a constructor
 * side effect, though: `installGlobalHandlers()` is explicit, so the point at
 * which the app starts catching unexpected errors is findable and orderable.
 */

import { TL } from './Strings.js';
import { $, requireButton, requireElement } from './DOM.js';
import { triggerDownload } from './Transfer.js';
import { showStep, showNav, hideNav, historyIncludes, unwindHistoryTo } from './Navigation.js';
import { ShellScreen } from './ShellScreen.js';

// Whether a script belongs to this app. Browser extensions run injected page
// scripts in the page's own context, so their exceptions reach this handler
// looking exactly like ours — and an extension that throws on every DOM
// change turns the error screen itself into the thing that keeps it
// throwing. A cross-origin script reports an empty filename and the opaque
// "Script error." message, which we cannot attribute either. Neither is the
// app failing, so neither should put a screen in front of the user.
function isOwnScript(filename) {
    if (!filename) return false;
    return filename.startsWith(window.location.origin + '/');
}

export class ErrorScreen extends ShellScreen {
    /** @param {import('../Wizard.js').Wizard} nav */
    constructor(nav) {
        super(nav, 'step-error');

        // `step-patches` is not this screen's element. It is bound because the
        // back-out path unwinds the shared back-stack by element identity, and
        // that stack holds elements rather than ids. Phase 6 made the stack
        // private and named the two operations (`historyIncludes`,
        // `unwindHistoryTo`), so this is a call rather than raw array surgery —
        // but the error screen still has to name another screen's element, and
        // removing that means an owned `Navigation` instance threaded through 62
        // call sites. That belongs with the TypeScript conversion.
        this.stepPatches = requireElement('step-patches');

        this.btnRetry = requireButton('btn-retry');
        this.btnBack = requireButton('btn-error-back');
        this.btnDownloadLog = requireButton('btn-error-download-log');
        this.message = requireElement('error-message');
        this.log = requireElement('error-log');
        this.title = requireElement('error-title');
        this.hint = requireElement('error-hint');
        this.deviceWriteHelp = requireElement('error-device-write-help');

        this.auditLog = null;

        // The safety net stays down once it has caught something. It used to
        // guard only re-entrancy, which is no guard at all against a failure
        // that repeats: each rejection arrives in its own task, so the flag was
        // always back to false by the time the next one came in, and the screen
        // could be rebuilt dozens of times a second for as long as the tab
        // stayed open. Cleared when the user leaves the screen through the back
        // button; the retry button reloads the page, which resets it anyway.
        this.unexpectedErrorShown = false;

        this.#wireListeners(this.listeners.signal);
    }

    /**
     * Show the error screen for a failure.
     *
     * @param {string} message - shown unless a branch below replaces it
     * @param {?string} [log] - technical detail; reveals the log pane when present
     * @param {object} [options] - `deviceWrite`, `writeProbe`, `title`,
     *   `configReadFailed`, `connectionTips`, `auditLog`
     */
    showError(message, log, options = {}) {
        this.auditLog = options.auditLog || null;
        this.message.textContent = message;
        this.btnDownloadLog.hidden = !this.auditLog;
        // A device-write failure (or a connection-related read failure) gets the
        // connection tips shown inline. The app no longer rolls anything back.
        const showConnectionTips = !!options.deviceWrite || !!options.connectionTips;
        if (log) {
            this.log.textContent = log;
            this.log.hidden = false;
            requestAnimationFrame(() => {
                this.log.scrollTop = this.log.scrollHeight;
            });
        } else {
            this.log.hidden = true;
        }

        const flow = this.nav.activeFlow;
        const hasRecovery = flow && flow.recoveryTarget() && flow.current();
        const hasBackStep = historyIncludes(this.stepPatches);

        // Ordered: a device-write failure outranks an explicit title, which
        // outranks a recovery target. Do not reorder — each branch picks a
        // different title, a different set of affordances, and a different
        // analytics category.
        if (options.deviceWrite) {
            if (options.writeProbe) {
                this.title.textContent = TL.ERROR.DEVICE_PROBE_FAILED_TITLE;
                this.message.textContent = TL.ERROR.DEVICE_PROBE_FAILED_MESSAGE;
            } else {
                this.title.textContent = TL.ERROR.DEVICE_WRITE_FAILED_TITLE;
                this.message.textContent = TL.ERROR.DEVICE_WRITE_FAILED_MESSAGE;
            }
            this.deviceWriteHelp.hidden = !showConnectionTips;
            this.hint.hidden = true;
            this.btnBack.hidden = true;
            this.btnRetry.classList.remove('danger');
        } else if (options.title) {
            this.title.textContent = options.title;
            if (options.configReadFailed) {
                this.message.textContent = TL.ERROR.DEVICE_CONFIG_READ_FAILED_MESSAGE;
            }
            this.deviceWriteHelp.hidden = !showConnectionTips;
            this.hint.hidden = true;
            this.btnBack.hidden = true;
            this.btnRetry.classList.remove('danger');
        } else if (hasRecovery) {
            this.title.textContent = TL.ERROR.PATCH_FAILED;
            this.deviceWriteHelp.hidden = true;
            this.hint.hidden = false;
            this.btnBack.hidden = false;
            this.btnRetry.classList.add('danger');
        } else if (hasBackStep) {
            this.title.textContent = TL.ERROR.PATCH_FAILED;
            this.deviceWriteHelp.hidden = true;
            this.hint.hidden = false;
            this.btnBack.hidden = false;
            this.btnRetry.classList.add('danger');
        } else {
            this.title.textContent = TL.ERROR.SOMETHING_WENT_WRONG;
            this.deviceWriteHelp.hidden = true;
            this.hint.hidden = true;
            this.btnBack.hidden = true;
            this.btnRetry.classList.remove('danger');
        }
        hideNav();
        showStep(this.root);
    }

    /**
     * Start catching unexpected errors on the window.
     *
     * Separate from the constructor on purpose. The old `initErrorScreen`
     * installed these as a side effect and `app.js` called it *third*, after both
     * flows were built, so a throw during flow construction was not caught.
     * `ErrorScreen` is now built first — everyone needs its `showError` — which
     * would have started catching earlier and changed behavior on a failure path.
     * Keeping installation as its own call lets `Wizard` invoke it at the same
     * relative point as before.
     *
     * Installing them first would be an improvement, and it is a one-line change
     * that deserves its own justification rather than riding along with a refactor.
     */
    installGlobalHandlers() {
        const signal = this.listeners.signal;
        window.addEventListener(
            'error',
            (event) => {
                if (!event.error) return;
                if (!isOwnScript(event.filename)) return;
                this.#handleUnexpectedError(event.error);
            },
            { signal },
        );
        window.addEventListener(
            'unhandledrejection',
            (event) => {
                this.#handleUnexpectedError(event.reason);
            },
            { signal },
        );
    }

    #handleUnexpectedError(err) {
        if (this.unexpectedErrorShown) return;
        if (err && err.name === 'AbortError') return;
        this.unexpectedErrorShown = true;
        try {
            const detail = err ? err.stack || err.message || String(err) : 'Unknown error';
            this.showError(TL.ERROR.UNEXPECTED_MESSAGE, detail, { title: TL.ERROR.UNEXPECTED_TITLE });
        } catch (e) {
            console.error('Failed to display the error screen:', e);
        }
    }

    #wireListeners(signal) {
        this.btnBack.addEventListener(
            'click',
            () => {
                this.unexpectedErrorShown = false;
                const flow = this.nav.activeFlow;
                const recoveryDomId = flow && flow.recoveryTarget();

                if (recoveryDomId) {
                    showNav();
                    this.btnBack.hidden = true;
                    this.btnDownloadLog.hidden = true;
                    this.auditLog = null;
                    this.btnRetry.classList.remove('danger');
                    const recoveryDomStep = $(recoveryDomId);
                    if (recoveryDomStep) {
                        showStep(recoveryDomStep);
                    }
                    return;
                }

                this.btnBack.hidden = true;
                this.btnDownloadLog.hidden = true;
                this.auditLog = null;
                this.btnRetry.classList.remove('danger');
                unwindHistoryTo(this.stepPatches);
                showNav();
                showStep(this.stepPatches);
            },
            { signal },
        );

        this.btnDownloadLog.addEventListener(
            'click',
            () => {
                if (!this.auditLog) return;
                const filename = this.auditLog.path[this.auditLog.path.length - 1] || 'kobopatch-webui.log';
                triggerDownload(this.auditLog.render(), filename, 'text/plain');
            },
            { signal },
        );

        this.btnRetry.addEventListener(
            'click',
            () => {
                location.reload();
            },
            { signal },
        );
    }
}
