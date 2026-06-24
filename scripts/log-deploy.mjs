/**
 * log-deploy.mjs — CLI entry that records one deploy/boot record, invoked from
 * nixpacks.toml's `[start]` command *before* the server launches:
 *
 *     cmd = "node scripts/log-deploy.mjs && npm start"
 *
 * Living in the start phase (not build — the persistent volume isn't mounted
 * during the Nixpacks build) keeps deploy logging out of the file server
 * (`serve-dist.mjs` stays a pure static server) and ensures the record is written
 * even if the server later fails to boot. The actual logic lives in
 * `deploy-log.mjs` and is unit-tested there.
 */

import { join } from 'node:path';

import { resolveDeployInfo, logDeploy } from './deploy-log.mjs';
import { storageDir } from './storage.mjs';

const APP_DIR = join(import.meta.dirname, '..');

// Deploy logs live under the `logs/` subdir of the persistent data root
// (`storageDir()`: $STORAGE_DIR in production, ./tmp/storage locally). Error
// logging uses the same root (${STORAGE_DIR}/errors.sqlite).
const LOGS_DIR = join(storageDir(), 'logs');
const PORT = process.env.PORT || 8888;

const { version, commit } = resolveDeployInfo(APP_DIR);
const written = logDeploy({ logDir: LOGS_DIR, version, commit, port: PORT });
if (written) console.log(`Deploy logged to ${written}`);
