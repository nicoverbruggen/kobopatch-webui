/**
 * Runs kobopatch WASM in a Web Worker for non-blocking UI.
 */
class KoboPatchRunner {
    constructor() {
        this._worker = null;
    }

    /**
     * Run the patching pipeline in a Web Worker.
     *
     * @param {string} configYAML - kobopatch.yaml content
     * @param {Uint8Array} firmwareZip - firmware zip file bytes
     * @param {Object<string, Uint8Array>} patchFiles - map of filename -> YAML content bytes
     * @param {Function} [onProgress] - optional callback(message) for progress updates
     * @returns {Promise<{tgz: Uint8Array, log: string}>}
     */
    patchFirmware(configYAML, firmwareZip, patchFiles, onProgress) {
        return new Promise((resolve, reject) => {
            const worker = new Worker('js/patch-worker.js');
            this._worker = worker;

            worker.onmessage = (e) => {
                const msg = e.data;
                if (msg.type === 'progress') {
                    if (onProgress) onProgress(msg.message);
                } else if (msg.type === 'done') {
                    worker.terminate();
                    this._worker = null;
                    resolve({ tgz: msg.tgz, log: msg.log });
                } else if (msg.type === 'error') {
                    worker.terminate();
                    this._worker = null;
                    reject(new Error(msg.message));
                }
            };

            worker.onerror = (e) => {
                worker.terminate();
                this._worker = null;
                reject(new Error('Worker error: ' + e.message));
            };

            // Transfer the firmwareZip buffer to avoid copying
            worker.postMessage({
                type: 'patch',
                configYAML,
                firmwareZip,
                patchFiles,
            }, [firmwareZip.buffer]);
        });
    }
}

export { KoboPatchRunner };
