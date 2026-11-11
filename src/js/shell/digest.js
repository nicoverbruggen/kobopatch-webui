/**
 * digest.js — SHA-256 over bytes, for verifying downloads and stored archives.
 *
 * Shared rather than owned by one flow: the patches flow checks the archive it
 * wrote next to a manifest, and the NickelMenu installer checks every add-on it
 * downloads against the digest pinned at build time.
 */

/** Lowercase hex SHA-256 of the given bytes. */
export async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
