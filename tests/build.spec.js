// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'web', 'dist');

test.describe('Build output', () => {
  test('CSS cache-bust hash is present on style.css link', async () => {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
    expect(html).toMatch(/css\/style\.css\?h=[0-9a-f]{8}/);
  });

  test('JS cache-bust hash is present on bundle.js script', async () => {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
    expect(html).toMatch(/bundle\.js\?h=[0-9a-f]{8}/);
  });

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
    const critical = fs.readFileSync(
      path.join(__dirname, '..', 'web', 'src', 'css', 'critical.css'), 'utf-8'
    );
    const primary = critical.match(/--primary:\s*([^;]+);/);
    const hover = critical.match(/--primary-hover:\s*([^;]+);/);
    expect(primary).not.toBeNull();
    expect(hover).not.toBeNull();
    expect(primary[1].trim()).not.toBe(hover[1].trim());
  });

  test('no jszip script tag in built HTML', async () => {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
    expect(html).not.toContain('jszip');
  });

  test('no unreplaced template placeholders in built HTML', async () => {
    const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf-8');
    expect(html).not.toMatch(/\{\{[\w-]+\}\}/);
    expect(html).not.toContain('@critical-css');
  });
});
