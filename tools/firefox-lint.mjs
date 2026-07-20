import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB_EXT = resolve(ROOT, 'node_modules/web-ext/bin/web-ext.js');
const SOURCE = resolve(ROOT, 'platform/firefox');
const expectedWarnings = new Map([
    ['UNSAFE_VAR_ASSIGNMENT:js/contentscript.js', 2],
    ['DANGEROUS_EVAL:web_accessible_resources/nobab.js', 2],
    ['DANGEROUS_EVAL:web_accessible_resources/noeval.js', 2],
    ['DANGEROUS_EVAL:web_accessible_resources/noeval-silent.js', 2],
    ['COINMINER_USAGE_DETECTED:dnr/easyprivacy-00.rules.json', 1],
]);

const result = spawnSync(
    process.execPath,
    [
        WEB_EXT,
        'lint',
        '--source-dir',
        SOURCE,
        '--output',
        'json',
        '--no-input',
    ],
    {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
    },
);

if (result.error) throw result.error;
if (result.status !== 0 && result.stdout.trim() === '') {
    throw new Error(result.stderr.trim() || 'web-ext lint failed');
}

const report = JSON.parse(result.stdout);
if (report.errors.length > 0 || report.notices.length > 0) {
    console.error(result.stdout);
    throw new Error(
        `Firefox lint returned ${report.errors.length} errors and ` +
        `${report.notices.length} notices`,
    );
}

const actualWarnings = new Map();
for (const warning of report.warnings) {
    const key = `${warning.code}:${warning.file}`;
    actualWarnings.set(key, (actualWarnings.get(key) ?? 0) + 1);
}

const mismatches = [];
for (const [key, count] of actualWarnings) {
    if (expectedWarnings.get(key) !== count) {
        mismatches.push(`unexpected ${key} (${count})`);
    }
}
for (const [key, count] of expectedWarnings) {
    if (actualWarnings.get(key) !== count) {
        mismatches.push(`missing or changed ${key} (expected ${count})`);
    }
}

const easyPrivacy = JSON.parse(readFileSync(
    resolve(SOURCE, 'dnr/easyprivacy-00.rules.json'),
    'utf8',
));
const coinminerFalsePositiveIsBlockingRule = easyPrivacy.some(rule =>
    rule?.action?.type === 'block' &&
    rule?.condition?.urlFilter === '/coinhive.min.js'
);
if (!coinminerFalsePositiveIsBlockingRule) {
    mismatches.push(
        'coinminer warning is no longer the known blocking-rule false positive',
    );
}

if (mismatches.length > 0) {
    for (const mismatch of mismatches) console.error(`- ${mismatch}`);
    throw new Error('Firefox lint warning baseline changed');
}

console.log(
    `Firefox lint passed with 0 errors and ` +
    `${report.warnings.length} reviewed inherited warnings`,
);
