/**
 * deploy-log.mjs — record each deploy/boot of the production server to the
 * persistent log volume, so a redeploy's history survives the ephemeral
 * container filesystem (see PROJECT.md "Production Serving" / the Coolify volume).
 *
 * One file per app version: `<logDir>/deploy-<version>.log`, one line appended per
 * server start. The CLI (`log-deploy.mjs`) points `logDir` at the `logs/`
 * subdirectory of the persistent storage volume (`${STORAGE_DIR}/logs`). Bumping
 * the version each release (package.json) gives a new file per release while
 * restarts of the same version append to its file — so the directory accumulating
 * across deploys is the proof the volume persists.
 *
 * Deliberately tiny and best-effort: a logging failure must never crash or block
 * the server, mirroring how the audit log and analytics are non-fatal.
 *
 * Scope note: this records a structured *boot record* per deploy (timestamp,
 * version, commit, runtime). Capturing the full build/deploy stdout would need a
 * different mechanism (Coolify's build logs or a post-deploy hook) since the
 * volume isn't mounted during the Nixpacks build phase.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Filename-safe version segment: a tag/hash is fine, but never let a stray `/`
// or `..` escape the deploys directory.
function safeVersionSegment(version) {
    return String(version).replace(/[^a-zA-Z0-9._-]/g, '_') || 'unknown';
}

/**
 * Resolve the version (and best-effort commit) for a deploy record from the repo
 * at `appDir`. `package.json` is the source of truth the maintainer bumps by
 * hand. `.version.json` adds the commit; it's written by `generateVersion()`,
 * which the build runs automatically (`vite.config.mjs`), so it's present in a
 * deployed image — but it's treated as optional here, never required.
 */
export function resolveDeployInfo(appDir) {
    let version = 'unknown';
    let commit = null;
    try {
        version = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8')).version || 'unknown';
    } catch {
        // No package.json (or unreadable) — fall back to 'unknown'.
    }
    try {
        commit = JSON.parse(readFileSync(join(appDir, '.version.json'), 'utf-8')).commit || null;
    } catch {
        // .version.json is optional.
    }
    return { version, commit };
}

/**
 * Append one boot record to `<logDir>/deploy-<version>.log`. Returns the file
 * path written, or null when logging is disabled (`logDir` falsy) or a write
 * failed. Never throws.
 */
export function logDeploy({ logDir, version = 'unknown', commit = null, port = null, now = new Date() } = {}) {
    if (!logDir) return null; // logging disabled (STORAGE_DIR not configured)
    try {
        mkdirSync(logDir, { recursive: true });
        const file = join(logDir, `deploy-${safeVersionSegment(version)}.log`);
        const line =
            [
                now.toISOString(),
                'deploy',
                `version=${version}`,
                commit ? `commit=${String(commit).slice(0, 7)}` : null,
                `node=${process.version}`,
                `pid=${process.pid}`,
                port != null ? `port=${port}` : null,
            ]
                .filter(Boolean)
                .join('  ') + '\n';
        appendFileSync(file, line);
        return file;
    } catch (err) {
        // Surface to the operator via the server log, but never fatal.
        console.warn(`deploy-log: failed to write deploy log: ${err.message}`);
        return null;
    }
}
