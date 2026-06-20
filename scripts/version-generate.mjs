import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const appDir = join(import.meta.dirname, '..');
const repo = 'nicoverbruggen/kobopatch-webui';

function tryExec(cmd) {
    try {
        return String(execSync(cmd, { cwd: appDir, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
    } catch {
        return '';
    }
}

async function resolveTagFromGitHub(sha) {
    try {
        const res = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=100`);
        if (!res.ok) return '';
        const tags = await res.json();
        const match = tags.find((t) => t.commit && t.commit.sha === sha);
        return match ? match.name : '';
    } catch {
        return '';
    }
}

export async function generateVersion() {
    const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8'));
    const versionStr = pkg.version || 'unknown';

    const fullHash = (process.env.SOURCE_COMMIT ?? '').trim() || tryExec('git rev-parse HEAD');

    let tag = (process.env.SOURCE_TAG ?? '').trim() || (fullHash ? tryExec(`git describe --tags --exact-match ${fullHash}`) : '');

    if (!tag && fullHash && !tryExec('git tag --list')) {
        tag = await resolveTagFromGitHub(fullHash);
    }

    const versionLink = tag
        ? `https://github.com/${repo}/releases/tag/${tag}`
        : fullHash
          ? `https://github.com/${repo}/tree/${fullHash}`
          : `https://github.com/${repo}`;

    const data = { versionStr, versionLink, commit: fullHash, tag: tag || null };
    writeFileSync(join(appDir, '.version.json'), JSON.stringify(data, null, 2) + '\n');
    return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const data = await generateVersion();
    console.log(`version:generate: ${data.versionStr} -> ${data.versionLink}`);
}
