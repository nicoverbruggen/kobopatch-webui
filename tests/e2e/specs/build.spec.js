// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { createHash } = require('node:crypto');
const path = require('path');

const appDir = path.join(__dirname, '..', '..', '..');
const distDir = path.join(appDir, 'dist');

test.describe('Build output', () => {
    for (const [file, referrer] of [
        ['bundle.js', 'index.html'],
        ['css/style.css', 'index.html'],
        ['wasm/kobopatch.wasm', 'js/workers/patch-worker.js'],
    ]) {
        test(`${file} can only be cached as an immutable build asset at its content address`, async ({ request }) => {
            const bytes = fs.readFileSync(path.join(distDir, file));
            const fingerprint = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
            const url = `/static/${fingerprint}/${path.basename(file)}`;
            expect(fs.readFileSync(path.join(distDir, referrer), 'utf8')).toContain(url);
            const current = await request.get(url);
            expect(current.status()).toBe(200);
            expect(current.headers()['cache-control']).toContain('immutable');
            expect((await current.body()).equals(bytes)).toBe(true);
            for (const stale of [url.replace(fingerprint, '0000000000000000'), `/${file}?h=00000000`]) {
                const response = await request.get(stale, { headers: { 'If-None-Match': current.headers().etag } });
                expect(response.status()).toBe(404);
                expect(response.headers()['cache-control']).toContain('no-store');
            }
        });
    }

    test('critical CSS is inlined with :root tokens', async () => {
        const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
        // :root block should be inside an inline <style> tag, not in a <link>
        expect(html).toMatch(/<style>[^<]*:root\{[^}]*--primary:/);
        // var() references should be used (not hardcoded hex colors for themed values)
        expect(html).toMatch(/<style>[^<]*var\(--primary\)/);
    });

    test('style.css does not contain a :root block', async () => {
        const css = fs.readFileSync(path.join(distDir, 'css', 'style.css'), 'utf-8');
        expect(css).not.toContain(':root');
    });

    test('--primary-hover differs from --primary', async () => {
        const critical = fs.readFileSync(path.join(appDir, 'src', 'css', 'critical.css'), 'utf-8');
        const primary = critical.match(/--primary:\s*([^;]+);/);
        const hover = critical.match(/--primary-hover:\s*([^;]+);/);
        expect(primary).not.toBeNull();
        expect(hover).not.toBeNull();
        expect(primary[1].trim()).not.toBe(hover[1].trim());
    });

    test('no jszip script tag in built HTML', async () => {
        const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
        // JSZip is bundled, not loaded via a script tag. A plain credits link to the
        // JSZip homepage is fine, so only reject an actual <script> referencing it.
        expect(html).not.toMatch(/<script[^>]*jszip/i);
    });

    test('no unreplaced template placeholders in built HTML', async () => {
        const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
        expect(html).not.toMatch(/\{\{[\w-]+\}\}/);
        expect(html).not.toContain('@critical-css');
    });
});
