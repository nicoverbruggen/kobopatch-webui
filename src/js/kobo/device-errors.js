/**
 * device-errors.js — error classification and factories for device I/O.
 *
 * The File System Access API throws DOMExceptions that mean little to the user
 * and don't say which device path failed. These helpers wrap them into Errors
 * carrying `devicePath`/`deviceOperation`/`deviceWrite` metadata, which the
 * error screen reads to explain the failure and offer the right recovery.
 */

import { formatDevicePath } from './device-paths.js';

function describeError(err) {
    return err?.message || String(err);
}

function isNotFoundError(err) {
    return err?.name === 'NotFoundError';
}

function isTypeMismatchError(err) {
    return err?.name === 'TypeMismatchError';
}

function devicePathError(operation, pathParts, err) {
    const wrapped = new Error(
        `Could not ${operation} ${formatDevicePath(pathParts)}: ${describeError(err)}`,
        { cause: err }
    );
    wrapped.devicePath = formatDevicePath(pathParts);
    wrapped.deviceOperation = operation;
    wrapped.deviceWrite = operation === 'write';
    return wrapped;
}

function deviceWriteError(pathParts, phase, err) {
    const wrapped = new Error(
        `Could not write ${formatDevicePath(pathParts)} while ${phase}: ${describeError(err)}`,
        { cause: err }
    );
    wrapped.devicePath = formatDevicePath(pathParts);
    wrapped.deviceOperation = 'write';
    wrapped.deviceWrite = true;
    wrapped.devicePhase = phase;
    return wrapped;
}

function deviceWriteProbeError(err, probePathParts) {
    const wrapped = new Error(
        'Could not verify write access to the Kobo drive. The app could read ' +
        '.kobo/version, but a small test write failed. Direct install is not safe ' +
        `for this connection. Details: ${describeError(err)}`,
        { cause: err }
    );
    wrapped.devicePath = formatDevicePath(probePathParts);
    wrapped.deviceOperation = 'write probe';
    wrapped.deviceWrite = true;
    return wrapped;
}

export {
    describeError,
    isNotFoundError,
    isTypeMismatchError,
    devicePathError,
    deviceWriteError,
    deviceWriteProbeError,
};
