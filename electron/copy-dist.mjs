import { cpSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const src = join(dir, '..', 'web', 'dist');
const dst = join(dir, 'dist');

if (!existsSync(src)) {
    console.error('web/dist/ does not exist — run "cd web && npm run build" first.');
    process.exit(1);
}

rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log(`Copied ${src} -> ${dst}`);
