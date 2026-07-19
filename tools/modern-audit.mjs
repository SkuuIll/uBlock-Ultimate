import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION = resolve(ROOT, 'platform/chromium');
const EXPECTED_LOCALES = [
    'de', 'en', 'es', 'fr', 'hi', 'it', 'ja',
    'pt_BR', 'pt_PT', 'ru', 'zh_CN', 'zh_TW',
];
const errors = [];

function walk(root) {
    if (!existsSync(root)) return [];
    const files = [];
    const visit = directory => {
        for (const name of readdirSync(directory)) {
            const absolute = join(directory, name);
            if (statSync(absolute).isDirectory()) visit(absolute);
            else files.push(absolute);
        }
    };
    visit(root);
    return files;
}

function requireFile(path, owner) {
    if (!existsSync(resolve(EXTENSION, path.replace(/^\//, '')))) {
        errors.push(`${owner} references missing file: ${path}`);
    }
}

if (!existsSync(EXTENSION)) {
    errors.push('platform/chromium does not exist; run npm run build');
} else {
    const manifestPath = resolve(EXTENSION, 'manifest.json');
    if (!existsSync(manifestPath)) {
        errors.push('manifest.json is missing');
    } else {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.name !== 'uBlock Ultimate') errors.push('Unexpected extension name');
        if (manifest.version !== '0.2.0') errors.push('Unexpected extension version');
        if (manifest.manifest_version !== 3) errors.push('Manifest V3 is required');
        if (manifest.permissions?.includes('unlimitedStorage')) {
            errors.push('unlimitedStorage must not be requested');
        }
        requireFile(manifest.background?.service_worker, 'background.service_worker');
        requireFile(manifest.action?.default_popup, 'action.default_popup');
        requireFile(manifest.options_page, 'options_page');
        for (const [index, contentScript] of (manifest.content_scripts ?? []).entries()) {
            for (const file of contentScript.js ?? []) requireFile(file, `content_scripts[${index}]`);
            for (const file of contentScript.css ?? []) requireFile(file, `content_scripts[${index}]`);
        }
        for (const ruleset of manifest.declarative_net_request?.rule_resources ?? []) {
            requireFile(ruleset.path, `ruleset ${ruleset.id}`);
        }
        for (const block of manifest.web_accessible_resources ?? []) {
            for (const resource of block.resources ?? []) {
                if (!resource.includes('*')) requireFile(resource, 'web_accessible_resources');
            }
        }
    }

    const localesPath = resolve(EXTENSION, '_locales');
    const locales = existsSync(localesPath)
        ? readdirSync(localesPath).filter(name => statSync(join(localesPath, name)).isDirectory()).sort()
        : [];
    if (JSON.stringify(locales) !== JSON.stringify([...EXPECTED_LOCALES].sort())) {
        errors.push(`Locales must be exactly: ${EXPECTED_LOCALES.join(', ')}`);
    }

    const forbidden = [
        /\.ts$/,
        /\.unsupported\.json$/,
        /\.source-map\.json$/,
        /\.budget\.json$/,
        /(^|\/)_metadata\//,
        /manifest\.release\.json$/,
    ];
    for (const file of walk(EXTENSION)) {
        const rel = relative(EXTENSION, file).replaceAll('\\', '/');
        if (forbidden.some(pattern => pattern.test(rel))) {
            errors.push(`Forbidden generated/development file: ${rel}`);
        }
    }

    const activeText = walk(EXTENSION)
        .filter(file => /\.(?:html|css|js|json)$/.test(file))
        .map(file => readFileSync(file, 'utf8'))
        .join('\n');
    if (/uBlockResurrected|uBlock Resurrected/i.test(activeText)) {
        errors.push('Legacy uBlock Resurrected branding remains in active output');
    }
}

const testFiles = walk(resolve(ROOT, 'tests'))
    .filter(file => /\.(?:spec|test)\.(?:ts|js)$/.test(file));
if (testFiles.length === 0) errors.push('No executable tests were found');

if (errors.length > 0) {
    console.error(`Audit failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
}

const files = walk(EXTENSION);
const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
console.log(`Audit passed: ${files.length} runtime files, ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
