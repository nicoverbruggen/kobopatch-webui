import { countTableRows } from './sqlite-count.js';

const KOBO_READER_DB = ['.kobo', 'KoboReader.sqlite'];

/**
 * Count rows in the connected Kobo's KoboReader.sqlite `user` table. A device
 * signed into an account has at least one row there; a factory-reset device that
 * was never signed in has zero.
 *
 * Returns null when the database can't be read (file missing, table absent,
 * unexpected format), so callers can treat sign-in state as *unknown* and carry
 * on rather than blocking the flow on a best-effort check.
 *
 * Reads the database a page at a time via `readFileRange`, so it never loads the
 * (potentially hundreds-of-MB) KoboReader.sqlite into memory just to count one
 * tiny table.
 *
 * @param {object} device - KoboDevice (or compatible) exposing readFileRange
 * @returns {Promise<number|null>}
 */
export async function countKoboUsers(device) {
    return countTableRows(
        (offset, length) => device.readFileRange(KOBO_READER_DB, offset, length),
        'user'
    );
}

/**
 * Whether the connected Kobo appears to be signed into an account. Returns
 * false only when we positively read zero user rows; an unreadable database
 * yields null (unknown) so we never wrongly claim a device isn't signed in.
 *
 * @returns {Promise<boolean|null>}
 */
export async function isKoboSignedIn(device) {
    const count = await countKoboUsers(device);
    if (count === null) return null;
    return count > 0;
}
