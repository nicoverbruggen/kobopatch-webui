/**
 * Loads and manages the kobopatch WASM module.
 */
class KobopatchRunner {
    constructor() {
        this.ready = false;
        this._go = null;
    }

    /**
     * Load the WASM module. Must be called before patchFirmware().
     */
    async load() {
        if (this.ready) return;

        this._go = new Go();
        const result = await WebAssembly.instantiateStreaming(
            fetch('kobopatch.wasm'),
            this._go.importObject
        );
        // Go WASM runs as a long-lived instance.
        this._go.run(result.instance);

        // Wait for the global function to become available.
        if (typeof globalThis.patchFirmware !== 'function') {
            throw new Error('WASM module loaded but patchFirmware() not found');
        }
        this.ready = true;
    }

    /**
     * Run the patching pipeline.
     *
     * @param {string} configYAML - kobopatch.yaml content
     * @param {Uint8Array} firmwareZip - firmware zip file bytes
     * @param {Object<string, Uint8Array>} patchFiles - map of filename -> YAML content bytes
     * @param {Function} [onProgress] - optional callback(message) for progress updates
     * @returns {Promise<{tgz: Uint8Array, log: string}>}
     */
    async patchFirmware(configYAML, firmwareZip, patchFiles, onProgress) {
        if (!this.ready) {
            throw new Error('WASM module not loaded. Call load() first.');
        }
        return globalThis.patchFirmware(configYAML, firmwareZip, patchFiles, onProgress || null);
    }
}
