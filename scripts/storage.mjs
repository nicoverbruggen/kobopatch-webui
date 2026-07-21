/**
 * storage.mjs — resolve the persistent data directory shared by deploy logging
 * and error logging.
 *
 * Production: Coolify mounts a volume and sets `STORAGE_DIR=/app/storage`.
 * Local: falls back to `./tmp/storage` (gitignored) so persisted data is easy to
 * inspect. See PROJECT.md "Deploy Logging".
 */

import { join } from 'node:path';

const APP_DIR = join(import.meta.dirname, '..');

/** The persistent data root: `$STORAGE_DIR`, else `./tmp/storage` locally. */
export function storageDir() {
    return process.env.STORAGE_DIR || join(APP_DIR, 'tmp', 'storage');
}
