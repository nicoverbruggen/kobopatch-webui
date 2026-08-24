/**
 * eject-watch.js — Notices when a connected Kobo goes away.
 *
 * The File System Access API has no eject or unmount event, so this polls a
 * cheap read of a file every Kobo has. Once the volume is unmounted the handle
 * stops resolving, which is exactly what we see when someone pulls the cable
 * out instead: the two are indistinguishable from here. Callers must therefore
 * describe the result as the device having disconnected, never as a *safe*
 * eject, because claiming the latter would hide a write that never flushed.
 */

// Read target for the probe. Every Kobo has this file — `connect()` refuses the
// directory without it — and it is small enough to poll for minutes.
const PROBE_PATH = ['.kobo', 'version'];

// One missed read is not enough: a busy volume can drop a single probe without
// having gone anywhere. Two consecutive misses is the signal.
const DEFAULT_FAILURES_BEFORE_GONE = 2;

const DEFAULT_INTERVAL_MS = 1000;

// Stop polling eventually. Someone who leaves the Kobo plugged in should not
// leave a timer running for the rest of the session.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Poll `device` until it stops responding.
 *
 * @param {object} device  A connected KoboDevice.
 * @param {object} opts
 * @param {() => void} [opts.onGone]    Called once, when the device stops responding.
 * @param {() => void} [opts.onGiveUp]  Called once, when `timeoutMs` passes with the device still there.
 * @param {number} [opts.intervalMs]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.failuresBeforeGone]
 * @param {() => number} [opts.now]     Injectable clock, for tests.
 * @returns {{stop: () => void}} `stop()` is idempotent and safe after the watch has ended.
 */
export function watchForEject(
    device,
    {
        onGone,
        onGiveUp,
        intervalMs = DEFAULT_INTERVAL_MS,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        failuresBeforeGone = DEFAULT_FAILURES_BEFORE_GONE,
        now = () => Date.now(),
    } = {},
) {
    let stopped = false;
    let failures = 0;
    let timer = null;
    const startedAt = now();

    function stop() {
        stopped = true;
        if (timer !== null) clearTimeout(timer);
        timer = null;
    }

    async function responding() {
        try {
            return await device.pathExists(PROBE_PATH);
        } catch {
            // A volume that has gone away throws rather than reporting the file
            // as missing, so an error counts as a miss like a `false` does.
            return false;
        }
    }

    async function tick() {
        timer = null;
        if (stopped) return;

        failures = (await responding()) ? 0 : failures + 1;
        // The probe is async, so the watch may have been stopped while it ran.
        if (stopped) return;

        if (failures >= failuresBeforeGone) {
            stop();
            onGone?.();
            return;
        }
        if (now() - startedAt >= timeoutMs) {
            stop();
            onGiveUp?.();
            return;
        }
        timer = setTimeout(tick, intervalMs);
    }

    timer = setTimeout(tick, intervalMs);
    return { stop };
}
