// On-device audit log. Records each step taken during a NickelMenu install or
// removal — KoboRoot.tgz write, per-feature file writes, removals, and
// Kobo eReader.conf edits — and writes them to a timestamped file under
// .kobopatch-webui/logs/ at the Kobo onboard root, one file per run, for
// troubleshooting and auditing.
//
// Records are appended to the device in real-time (best-effort) so a partial
// log survives a crash. The final write() ensures a complete log regardless.

function pad2(value) {
    return String(value).padStart(2, '0');
}

/** Build the per-run log filename, e.g. `26-06-11_14-30-install-nickelmenu.log`. */
export function auditLogFileName(date, type) {
    const yy = pad2(date.getFullYear() % 100);
    const mm = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    const hh = pad2(date.getHours());
    const min = pad2(date.getMinutes());
    return `${yy}-${mm}-${dd}_${hh}-${min}-${type}.log`;
}

export const AUDIT_LOG_DIRECTORY = '.kobopatch-webui';

export class AuditLog {
    /**
     * @param {string} type - operation type, e.g. 'install-nickelmenu', 'remove-nickelmenu', 'custom-patches'
     * @param {Date} [now] - run start time; controls the log filename
     * @param {object} [device] - connected device handle for real-time writes
     */
    constructor(type, now = new Date(), device = null) {
        this.type = type;
        this.startedAt = now;
        this.lines = [];
        this._device = device;
    }

    /** Buffer a timestamped line and attempt a real-time append to the device.
     *  Returns `this` for convenience. */
    record(message) {
        this.lines.push(`[${new Date().toISOString()}] ${message}`);
        this._flush();
        return this;
    }

    /** The path parts the log is written to, relative to the onboard root. */
    get path() {
        return [AUDIT_LOG_DIRECTORY, 'logs', auditLogFileName(this.startedAt, this.type)];
    }

    /** Render the buffered log as text. */
    render() {
        const header = `kobopatch-webui audit log — started ${this.startedAt.toISOString()}`;
        return [header, ...this.lines].join('\n') + '\n';
    }

    /** Best-effort real-time write of all buffered content to the device. */
    _flush() {
        if (!this._device) return;
        this._rawWrite(this._device).catch(() => {});
    }

    /** Write the full log to the connected device. Overwrites the file. */
    async write(device) {
        const dev = device || this._device;
        if (!dev) return;
        await this._rawWrite(dev);
    }

    async _rawWrite(device) {
        await device.writeFile(this.path, new TextEncoder().encode(this.render()));
    }
}
