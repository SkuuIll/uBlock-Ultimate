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

    for (const file of walk(EXTENSION).filter(path => path.endsWith('.html'))) {
        const html = readFileSync(file, 'utf8');
        const owner = relative(EXTENSION, file).replaceAll('\\', '/');
        const references = html.matchAll(/\b(?:href|src)=["']([^"'#]+)["']/g);
        for (const match of references) {
            const reference = match[1];
            if (/^(?:https?:|data:|mailto:|tel:|javascript:)/i.test(reference)) continue;
            const cleanReference = reference.split(/[?#]/, 1)[0];
            if (cleanReference === '') continue;
            const target = cleanReference.startsWith('/')
                ? resolve(EXTENSION, cleanReference.slice(1))
                : resolve(dirname(file), cleanReference);
            if (!target.startsWith(EXTENSION) || !existsSync(target)) {
                errors.push(`${owner} references missing file: ${reference}`);
            }
        }
    }

    const manifest = JSON.parse(readFileSync(resolve(EXTENSION, 'manifest.json'), 'utf8'));
    const staticResources =
        manifest.declarative_net_request?.rule_resources ?? [];
    if (staticResources.length > 100) {
        errors.push(`Manifest declares ${staticResources.length} static rulesets; Chrome allows 100`);
    }
    const enabledStaticRulesets =
        staticResources.filter(resource => resource.enabled).length;
    if (enabledStaticRulesets > 50) {
        errors.push(`Manifest enables ${enabledStaticRulesets} static rulesets; Chrome allows 50`);
    }
    let enabledStaticRuleCount = 0;
    for (const resource of staticResources) {
        const path = resolve(EXTENSION, resource.path);
        if (!existsSync(path)) continue;
        let rules;
        try {
            rules = JSON.parse(readFileSync(path, 'utf8'));
        } catch (error) {
            errors.push(`Ruleset ${resource.id} is not valid JSON: ${error.message}`);
            continue;
        }
        if (!Array.isArray(rules)) {
            errors.push(`Ruleset ${resource.id} must be a JSON array`);
            continue;
        }
        const ids = new Set();
        for (const rule of rules) {
            if (!Number.isInteger(rule?.id) || rule.id <= 0) {
                errors.push(`Ruleset ${resource.id} contains an invalid rule id`);
                break;
            }
            if (ids.has(rule.id)) {
                errors.push(`Ruleset ${resource.id} contains duplicate rule id ${rule.id}`);
                break;
            }
            ids.add(rule.id);
        }
        if (resource.enabled) enabledStaticRuleCount += rules.length;
    }
    if (enabledStaticRuleCount > 30_000) {
        errors.push(
            `Enabled static rules (${enabledStaticRuleCount}) exceed Chrome's guaranteed 30,000-rule capacity`
        );
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
