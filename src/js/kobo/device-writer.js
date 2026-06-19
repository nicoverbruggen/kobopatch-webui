/**
 * device-writer.js — a thin wrapper around the connected Kobo for the write
 * phase of an install or removal.
 *
 * Its only job is to tag write/remove failures with `deviceWrite` so the error
 * screen can recognise them. It deliberately does NOT roll anything back: once a
 * write fails, the filesystem or USB connection may be unreliable, so the app
 * stops touching the device and tells the user how to recover by hand instead.
 */

function markDeviceWriteError(err) {
    if (err && !err.deviceWrite) {
        err.deviceWrite = true;
    }
    return err;
}

class DeviceWriter {
    constructor(device) {
        this.device = device;
        this.deviceInfo = device.deviceInfo;
        this.directoryHandle = device.directoryHandle;
    }

    async writeFile(pathParts, data) {
        try {
            await this.device.writeFile(pathParts, data);
        } catch (err) {
            throw markDeviceWriteError(err);
        }
    }

    async removeEntry(pathParts, options = {}) {
        try {
            await this.device.removeEntry(pathParts, options);
        } catch (err) {
            throw markDeviceWriteError(err);
        }
    }

    readFile(pathParts) {
        return this.device.readFile(pathParts);
    }

    readFileBytes(pathParts) {
        return this.device.readFileBytes(pathParts);
    }

    readFileRange(pathParts, offset, length) {
        return this.device.readFileRange(pathParts, offset, length);
    }

    listDirectory(pathParts) {
        return this.device.listDirectory(pathParts);
    }

    pathExists(pathParts) {
        return this.device.pathExists(pathParts);
    }

    collectExistingEntries(pathList, progressFn) {
        return this.device.collectExistingEntries(pathList, progressFn);
    }
}

export { DeviceWriter, markDeviceWriteError };
