// On-device audit log. Records each step taken during a NickelMenu install or
// removal — KoboRoot.tgz write, per-feature file writes, removals, and
// Kobo eReader.conf edits — and writes them to a timestamped file under
// .kobopatch-webui/ at the Kobo onboard root, one file per run, for
// troubleshooting and auditing.

function pad2(value) {
    return String(value).padStart(2, '0');
}

/** Build the per-run log filename, e.g. `log-26-06-11_14-30.log`. */
export function auditLogFileName(date) {
    const yy = pad2(date.getFullYear() % 100);
    const mm = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    const hh = pad2(date.getHours());
    const min = pad2(date.getMinutes());
    return `log-${yy}-${mm}-${dd}_${hh}-${min}.log`;
}

export const AUDIT_LOG_DIRECTORY = '.kobopatch-webui';

export class AuditLog {
    /** @param {Date} now - run start time; controls the log filename. */
    constructor(now = new Date()) {
        this.startedAt = now;
        this.lines = [];
    }

    /** Buffer a timestamped line. Returns `this` for convenience. */
    record(message) {
        this.lines.push(`[${new Date().toISOString()}] ${message}`);
        return this;
    }

    /** The path parts the log is written to, relative to the onboard root. */
    get path() {
        return [AUDIT_LOG_DIRECTORY, auditLogFileName(this.startedAt)];
    }

    /** Render the buffered log as text. */
    render() {
        const header = `kobopatch-webui audit log — started ${this.startedAt.toISOString()}`;
        return [header, ...this.lines].join('\n') + '\n';
    }

    /** Write the log to the connected device. */
    async write(device) {
        await device.writeFile(this.path, new TextEncoder().encode(this.render()));
    }
}
