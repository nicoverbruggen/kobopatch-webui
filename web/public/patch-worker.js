// Web Worker for running kobopatch WASM off the main thread.
// Communicates with the main thread via postMessage.

importScripts('wasm_exec.js');

let wasmReady = false;

async function loadWasm() {
    if (wasmReady) return;

    const go = new Go();
    const result = await WebAssembly.instantiateStreaming(
        fetch('kobopatch.wasm?ts=1773666969'),
        go.importObject
    );
    go.run(result.instance);

    if (typeof globalThis.patchFirmware !== 'function') {
        throw new Error('WASM module loaded but patchFirmware() not found');
    }
    wasmReady = true;
}

self.onmessage = async function(e) {
    const { type, configYAML, firmwareZip, patchFiles } = e.data;

    if (type !== 'patch') return;

    try {
        self.postMessage({ type: 'progress', message: 'Loading WASM patcher...' });
        await loadWasm();
        self.postMessage({ type: 'progress', message: 'WASM module loaded' });

        self.postMessage({ type: 'progress', message: 'Applying patches...' });

        const result = await globalThis.patchFirmware(configYAML, firmwareZip, patchFiles, (msg) => {
            self.postMessage({ type: 'progress', message: msg });
        });

        // Transfer the tgz buffer to avoid copying
        const tgzBuffer = result.tgz.buffer;
        self.postMessage({
            type: 'done',
            tgz: result.tgz,
            log: result.log,
        }, [tgzBuffer]);
    } catch (err) {
        self.postMessage({ type: 'error', message: err.message });
    }
};
