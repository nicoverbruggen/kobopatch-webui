/**
 * device-paths.js — formatting and validation for device paths.
 *
 * A device path is an array of segments like ['.kobo', 'KoboRoot.tgz']. These
 * pure helpers keep the KoboDevice filesystem methods from re-implementing the
 * same join/validation logic, and let path errors fail with a clear reason.
 */

function formatDevicePath(pathParts) {
    return pathParts.join('/');
}

function invalidPathPartReason(part) {
    if (typeof part !== 'string') return 'path segments must be strings';
    if (part === '') return 'path segments cannot be empty';
    if (part === '.' || part === '..') return 'path segments cannot be "." or ".."';
    if (part.includes('/') || part.includes('\\')) return 'path segments cannot contain path separators';
    return null;
}

function assertValidDevicePath(pathParts, operation) {
    if (!Array.isArray(pathParts) || pathParts.length === 0) {
        throw new Error(`Invalid device path for ${operation}: expected at least one path segment`);
    }

    for (const part of pathParts) {
        const reason = invalidPathPartReason(part);
        if (reason) {
            throw new Error(`Invalid device path for ${operation}: ${formatDevicePath(pathParts)} (${reason})`);
        }
    }
}

export { formatDevicePath, assertValidDevicePath };
