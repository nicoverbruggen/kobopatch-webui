/**
 * PatchesBuild.js — The artifacts of the last custom-patches build: the
 * KoboRoot.tgz and the Additional File entries that went into it.
 *
 * **These two are cleared together, and that pairing is the point of this
 * class.** The manifest written to the device records the entry list and a
 * checksum over an archive built from those same entries, so a stale entry list
 * against a fresh archive produces a manifest that can never verify — the
 * failure mode `PHASE-2B-BASELINE-SPEC.md` §2.3 describes, which is silent and
 * permanent. Before Phase 3 `tgz` was cleared on a device reconnect and the
 * entries were not; nothing enforced the pairing and the safety was accidental.
 */

export class PatchesBuild {
    constructor() {
        /** @type {Uint8Array|null} the built KoboRoot.tgz */
        this.tgz = null;
        /** @type {{path: string, data: Uint8Array, sourceName: string, size: number}[]} */
        this.additionalFileEntries = [];
    }

    /**
     * Forget the last build. Both fields, always together.
     *
     * Contrast `NickelMenuOutcome.clear()`, which deliberately clears only one of
     * its two fields. The asymmetry is real: there, a null `mode` is
     * indistinguishable from `'download'` to the done screen, so clearing it
     * would protect nothing. Here the pairing is load-bearing, because the
     * manifest records the entry list alongside a checksum over an archive built
     * from it.
     */
    clear() {
        this.tgz = null;
        this.additionalFileEntries = [];
    }
}
