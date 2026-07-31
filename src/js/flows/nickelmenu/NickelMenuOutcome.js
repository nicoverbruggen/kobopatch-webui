/**
 * NickelMenuOutcome.js — What happened when the NickelMenu configuration was
 * applied. Written by `executeNmInstall` on each of its three exit paths, read
 * by the done screen.
 *
 * Separate from `NickelMenuSelection` because the two have different lifetimes:
 * a device reconnect discards the outcome but keeps the user's choices.
 */

export class NickelMenuOutcome {
    constructor() {
        /**
         * @type {'remove'|'written'|'download'|null} which exit path ran.
         *
         * Not cleared by `clear()`, deliberately — see the note there.
         */
        this.mode = null;
        /** @type {Uint8Array|null} the built ZIP, for the download path */
        this.zip = null;
    }

    /**
     * Forget the built ZIP on a device reconnect.
     *
     * **`mode` is deliberately left alone**, and this is not an oversight to
     * tidy up. `renderNmDoneStatus` branches `remove` / `written` / *else
     * download*, so `null` is not a neutral value — it is indistinguishable from
     * `'download'`. Clearing `mode` would therefore protect nothing: a stale
     * `'download'` and a cleared `null` take the same branch and hit the same
     * `triggerDownload(zip)` with the same nulled `zip`. The real protection is
     * that the done screen is reachable only through `executeNmInstall`, which
     * sets `mode` on every one of its three exit paths before navigating there.
     *
     * Contrast `PatchesBuild.clear()`, which does clear both of its fields: there
     * the pairing is load-bearing, because a stale entry list against a fresh
     * archive produces a manifest checksum that can never verify.
     */
    clear() {
        this.zip = null;
    }
}
