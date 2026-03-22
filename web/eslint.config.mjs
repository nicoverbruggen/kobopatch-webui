export default [
    {
        files: ['src/**/*.js'],
        ignores: ['src/js/wasm_exec.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                // Browser globals
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                fetch: 'readonly',
                URL: 'readonly',
                Blob: 'readonly',
                Uint8Array: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                Event: 'readonly',
                DOMException: 'readonly',
                HTMLElement: 'readonly',
                Worker: 'readonly',
                requestAnimationFrame: 'readonly',
                // JSZip loaded via script tag
                JSZip: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            'no-undef': 'error',
            'no-constant-condition': 'warn',
            'eqeqeq': ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'warn',
        },
    },
    {
        // Worker script uses importScripts, self, Go, globalThis, WebAssembly
        files: ['src/js/patch-worker.js'],
        languageOptions: {
            globals: {
                self: 'readonly',
                importScripts: 'readonly',
                Go: 'readonly',
                globalThis: 'readonly',
                WebAssembly: 'readonly',
                fetch: 'readonly',
                console: 'readonly',
            },
        },
    },
    {
        ignores: ['src/js/wasm_exec.js', 'dist/**', 'node_modules/**'],
    },
];
