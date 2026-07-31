/**
 * html-includes.mjs — The `<!-- include: … -->` directive used by `src/index.html`.
 *
 * The single implementation. `vite.config.mjs` expands the directives when it
 * serves and when it builds; `tests/unit/dom-harness.js` expands them to build
 * the jsdom document the unit tests run against. Those two must agree, or the
 * tests pass against a page the browser never sees, so there is one function
 * rather than two copies that look alike.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Replace every `<!-- include: path -->` with the contents of `<htmlDir>/path`,
 * repeating until no directives remain so an included file may include another.
 *
 * @param {string} html - the document to expand
 * @param {string} htmlDir - directory the include paths are relative to (`src/html`)
 * @returns {string}
 */
export function expandIncludes(html, htmlDir) {
    const includeRe = /<!--\s*include:\s*([\w./-]+)\s*-->/g;
    while (includeRe.test(html)) {
        html = html.replace(includeRe, (_, path) => readFileSync(join(htmlDir, path), 'utf-8'));
    }
    return html;
}
