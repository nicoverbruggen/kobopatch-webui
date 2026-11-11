import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

for (const failure of ['transport', 'http']) {
    test(`firmware URL validation reports a ${failure} failure and still checks the remaining URLs`, async (t) => {
        const scratch = join(process.cwd(), 'tmp');
        await mkdir(scratch, { recursive: true });
        const fixture = await mkdtemp(join(scratch, 'firmware-url-test-'));
        t.after(() => rm(fixture, { recursive: true, force: true }));
        const scriptDir = join(fixture, 'tests/e2e/scripts');
        const bin = join(fixture, 'bin');
        await Promise.all([mkdir(scriptDir, { recursive: true }), mkdir(bin), mkdir(join(fixture, 'patches'))]);
        const script = join(scriptDir, 'validate-dl-urls.sh');
        await writeFile(script, await readFile(new URL('../e2e/scripts/validate-dl-urls.sh', import.meta.url)));
        await writeFile(
            join(fixture, 'patches/downloads.json'),
            JSON.stringify({ '4.46.23852': { kobo14: 'https://test.invalid/bad', kobo13: 'https://test.invalid/good' } }),
        );
        // Model curl's final outcome after it has exhausted its retry budget.
        await writeFile(
            join(bin, 'curl'),
            `#!/bin/sh\nfor arg do url="$arg"; done\ncase "$url" in\n*/bad) ${failure === 'transport' ? 'printf 000; exit 35' : 'printf 404'};;\n*) printf 200;;\nesac\n`,
            { mode: 0o755 },
        );
        let result;
        try {
            await run('bash', [script], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
            assert.fail('a failed URL must fail validation');
        } catch (error) {
            result = error;
        }
        assert.equal(result.code, 1);
        assert.match(result.stdout, /FAIL.*https:\/\/test.invalid\/bad/);
        assert.match(result.stdout, /OK.*200.*https:\/\/test.invalid\/good/);
        assert.match(result.stdout, /2 URLs checked, 1 failed/);
    });
}
