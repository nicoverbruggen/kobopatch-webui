import { $, triggerDownload, setupFeedback } from './dom.js';
import { isEnabled as analyticsEnabled, track } from './analytics.js';
import { AuditLog } from '../kobo/audit-log.js';
import { DeviceWriter, markDeviceWriteError } from '../kobo/device-writer.js';

/**
 * The shared "terminal" of a flow — the build/result tail that both the patches
 * and NickelMenu flows funnel into. It owns the mechanics that were duplicated
 * across the two flows: post-completion feedback wiring, `flow-end` analytics,
 * ZIP bundling for downloads, and the device-write + audit-log + error-routing
 * sequence.
 *
 * It deliberately does NOT own step transitions or per-flow copy/buttons: the
 * two flows reach their result phase very differently (patches builds on a
 * dedicated step then offers write/download; NM builds-and-writes in one action
 * and also has a no-artifact "remove" path), so a single `run({mode})` would not
 * fit either. These composable helpers capture only what is genuinely shared.
 *
 * @param {object}  opts
 * @param {Element|string} opts.doneStep  The flow's "done" step (element or id).
 * @param {(message: string, log: ?string, options: object) => void} opts.showError
 */
export function createTerminal({ doneStep, showError }) {
    const doneStepEl = typeof doneStep === 'string' ? $(doneStep) : doneStep;

    // Wire the post-completion feedback widget. `setupFeedback` is itself
    // idempotent (it guards on a data attribute), so this is safe to call on
    // every entry to the done step even if it is re-entered.
    function wireFeedback() {
        if (!analyticsEnabled()) return;
        setupFeedback(doneStepEl, (vote) => track('feedback', { vote }));
    }

    function end(result) {
        track('flow-end', { result });
    }

    /**
     * Bundle entries into a ZIP and trigger a browser download.
     *
     * @param {object} opts
     * @param {{path: string, data: *}[]} opts.entries
     * @param {string|Uint8Array} [opts.instructions]  Written as instructions.txt.
     * @param {string} opts.filename
     * @returns {Promise<Uint8Array>} the generated ZIP bytes.
     */
    async function download({ entries, instructions, filename }) {
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        for (const entry of entries) {
            zip.file(entry.path, entry.data);
        }
        if (instructions) {
            zip.file('instructions.txt', instructions);
        }
        const bytes = await zip.generateAsync({ type: 'uint8array' });
        triggerDownload(bytes, filename, 'application/zip');
        return bytes;
    }

    /**
     * Write a set of pre-built files to the device under a single audit log,
     * with the shared device-write error routing. On failure the error screen is
     * shown (carrying the audit log and the `deviceWrite` flag) and the failed
     * result is returned rather than thrown, so callers can restore button state.
     *
     * @param {object} opts
     * @param {object} opts.device
     * @param {string} opts.auditName
     * @param {{path: string[], data: *, label?: string, optional?: boolean}[]} opts.writes
     *        `optional` writes that fail are logged to the console and skipped
     *        instead of failing the whole operation.
     * @param {(err: Error) => string} [opts.failMessage]
     * @returns {Promise<{ok: boolean, audit: AuditLog, error?: Error}>}
     */
    async function writeToDevice({ device, auditName, writes, failMessage }) {
        const audit = new AuditLog(auditName, new Date(), device);
        const writer = new DeviceWriter(device);
        try {
            for (const write of writes) {
                if (write.optional) {
                    try {
                        await writer.writeFile(write.path, write.data);
                        if (write.label) audit.record(write.label);
                    } catch (err) {
                        console.warn(`Could not write ${write.path.join('/')}:`, err);
                    }
                    continue;
                }
                await writer.writeFile(write.path, write.data);
                if (write.label) audit.record(write.label);
            }
            await audit.write();
            return { ok: true, audit };
        } catch (err) {
            // Stop on the first write failure without trying to undo anything:
            // the connection or filesystem may be unreliable.
            markDeviceWriteError(err);
            audit.record(`Failed: ${err.message}`);
            showError(failMessage ? failMessage(err) : err.message, null, {
                deviceWrite: !!err.deviceWrite,
                auditLog: audit,
            });
            return { ok: false, audit, error: err };
        }
    }

    return { wireFeedback, end, download, writeToDevice };
}
