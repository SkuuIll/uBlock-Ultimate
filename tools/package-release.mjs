import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = resolve(ROOT, 'platform/chromium');
const RELEASE = resolve(ROOT, 'dist/release');
const ZIP = resolve(RELEASE, 'uBlock-Ultimate-0.2.0-chromium.zip');

if (!existsSync(resolve(EXTENSION, 'manifest.json'))) {
    throw new Error('Missing production build; run npm run build first');
}

mkdirSync(RELEASE, { recursive: true });
rmSync(ZIP, { force: true });

const result = spawnSync(
    'tar',
    ['-a', '-cf', ZIP, '-C', EXTENSION, '.'],
    { cwd: ROOT, encoding: 'utf8' },
);
if (result.status !== 0 || !existsSync(ZIP)) {
    throw new Error(`Unable to create release ZIP: ${result.stderr || result.stdout}`);
}

const content = readFileSync(ZIP);
const sha256 = createHash('sha256').update(content).digest('hex');
console.log(`Package: ${ZIP}`);
console.log(`Size: ${(statSync(ZIP).size / 1024 / 1024).toFixed(2)} MiB`);
console.log(`SHA-256: ${sha256}`);
