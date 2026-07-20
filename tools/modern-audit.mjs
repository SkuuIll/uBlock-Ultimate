import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

function auditTarget(target) {
    const extension = resolve(ROOT, `platform/${target}`);
    const requireFile = (path, owner) => {
        if (
            typeof path !== 'string' ||
            !existsSync(resolve(extension, path.replace(/^\//, '')))
        ) {
            errors.push(`${target}: ${owner} references missing file: ${path}`);
        }
    };

    if (!existsSync(extension)) {
        errors.push(`platform/${target} does not exist; run npm run build`);
        return { files: [], bytes: 0 };
    }

    const manifestPath = resolve(extension, 'manifest.json');
    if (!existsSync(manifestPath)) {
        errors.push(`${target}: manifest.json is missing`);
        return { files: walk(extension), bytes: 0 };
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.name !== 'uBlock Ultimate') {
        errors.push(`${target}: unexpected extension name`);
    }
    if (manifest.version !== '0.2.0') {
        errors.push(`${target}: unexpected extension version`);
    }
    if (manifest.manifest_version !== 3) {
        errors.push(`${target}: Manifest V3 is required`);
    }
    if (manifest.permissions?.includes('unlimitedStorage')) {
        errors.push(`${target}: unlimitedStorage must not be requested`);
    }

    if (target === 'chromium') {
        requireFile(
            manifest.background?.service_worker,
            'background.service_worker',
        );
        if (manifest.browser_specific_settings !== undefined) {
            errors.push('chromium: Firefox settings leaked into manifest');
        }
    } else {
        if (manifest.background?.service_worker !== undefined) {
            errors.push('firefox: service_worker is not supported');
        }
        for (const script of manifest.background?.scripts ?? []) {
            requireFile(script, 'background.scripts');
        }
        if (manifest.browser_specific_settings?.gecko?.id === undefined) {
            errors.push('firefox: stable Gecko extension id is missing');
        }
        if (manifest.options_ui?.page !== 'dashboard.html') {
            errors.push('firefox: options_ui must open dashboard.html');
        }
        if (manifest.minimum_chrome_version !== undefined) {
            errors.push('firefox: minimum_chrome_version leaked into manifest');
        }
        if (manifest.storage?.managed_schema !== undefined) {
            errors.push('firefox: Chromium managed storage schema leaked');
        }
    }

    requireFile(manifest.action?.default_popup, 'action.default_popup');
    requireFile(
        manifest.options_page ?? manifest.options_ui?.page,
        'options page',
    );
    for (const [index, contentScript] of
        (manifest.content_scripts ?? []).entries()) {
        for (const file of contentScript.js ?? []) {
            requireFile(file, `content_scripts[${index}]`);
        }
        for (const file of contentScript.css ?? []) {
            requireFile(file, `content_scripts[${index}]`);
        }
    }
    for (const ruleset of
        manifest.declarative_net_request?.rule_resources ?? []) {
        requireFile(ruleset.path, `ruleset ${ruleset.id}`);
    }
    for (const block of manifest.web_accessible_resources ?? []) {
        for (const resource of block.resources ?? []) {
            if (!resource.includes('*')) {
                requireFile(resource, 'web_accessible_resources');
            }
        }
    }

    const localesPath = resolve(extension, '_locales');
    const locales = existsSync(localesPath)
        ? readdirSync(localesPath)
            .filter(name => statSync(join(localesPath, name)).isDirectory())
            .sort()
        : [];
    if (JSON.stringify(locales) !== JSON.stringify([...EXPECTED_LOCALES].sort())) {
        errors.push(
            `${target}: locales must be exactly: ${EXPECTED_LOCALES.join(', ')}`,
        );
    }

    const forbidden = [
        /\.ts$/,
        /\.unsupported\.json$/,
        /\.source-map\.json$/,
        /\.budget\.json$/,
        /(^|\/)_metadata\//,
        /manifest\.release\.json$/,
    ];
    for (const file of walk(extension)) {
        const rel = relative(extension, file).replaceAll('\\', '/');
        if (forbidden.some(pattern => pattern.test(rel))) {
            errors.push(`${target}: forbidden development file: ${rel}`);
        }
    }

    for (const file of walk(extension).filter(path => path.endsWith('.html'))) {
        const html = readFileSync(file, 'utf8');
        const owner = relative(extension, file).replaceAll('\\', '/');
        const references = html.matchAll(/\b(?:href|src)=["']([^"'#]+)["']/g);
        for (const match of references) {
            const reference = match[1];
            if (/^(?:https?:|data:|mailto:|tel:|javascript:)/i.test(reference)) {
                continue;
            }
            const cleanReference = reference.split(/[?#]/, 1)[0];
            if (cleanReference === '') continue;
            const candidate = cleanReference.startsWith('/')
                ? resolve(extension, cleanReference.slice(1))
                : resolve(dirname(file), cleanReference);
            if (!candidate.startsWith(extension) || !existsSync(candidate)) {
                errors.push(
                    `${target}: ${owner} references missing file: ${reference}`,
                );
            }
        }
    }

    const staticResources =
        manifest.declarative_net_request?.rule_resources ?? [];
    if (staticResources.length > 100) {
        errors.push(
            `${target}: manifest declares ${staticResources.length} static rulesets`,
        );
    }
    const enabledStaticRulesets =
        staticResources.filter(resource => resource.enabled).length;
    if (enabledStaticRulesets > 50) {
        errors.push(
            `${target}: manifest enables ${enabledStaticRulesets} static rulesets`,
        );
    }
    let enabledStaticRuleCount = 0;
    for (const resource of staticResources) {
        const path = resolve(extension, resource.path);
        if (!existsSync(path)) continue;
        let rules;
        try {
            rules = JSON.parse(readFileSync(path, 'utf8'));
        } catch (error) {
            errors.push(
                `${target}: ruleset ${resource.id} is invalid JSON: ${error.message}`,
            );
            continue;
        }
        if (!Array.isArray(rules)) {
            errors.push(`${target}: ruleset ${resource.id} is not an array`);
            continue;
        }
        const ids = new Set();
        for (const rule of rules) {
            if (!Number.isInteger(rule?.id) || rule.id <= 0) {
                errors.push(
                    `${target}: ruleset ${resource.id} has an invalid rule id`,
                );
                break;
            }
            if (ids.has(rule.id)) {
                errors.push(
                    `${target}: ruleset ${resource.id} duplicates id ${rule.id}`,
                );
                break;
            }
            ids.add(rule.id);
        }
        if (resource.enabled) enabledStaticRuleCount += rules.length;
    }
    if (enabledStaticRuleCount > 30_000) {
        errors.push(
            `${target}: enabled static rules (${enabledStaticRuleCount}) ` +
            'exceed the guaranteed 30,000-rule capacity',
        );
    }

    const files = walk(extension);
    const activeText = files
        .filter(file => /\.(?:html|css|js|json)$/.test(file))
        .map(file => readFileSync(file, 'utf8'))
        .join('\n');
    if (/uBlockResurrected|uBlock Resurrected/i.test(activeText)) {
        errors.push(`${target}: legacy Resurrected branding remains`);
    }

    return {
        files,
        bytes: files.reduce((sum, file) => sum + statSync(file).size, 0),
    };
}

const summaries = new Map();
for (const target of ['chromium', 'firefox']) {
    summaries.set(target, auditTarget(target));
}

const testFiles = walk(resolve(ROOT, 'tests'))
    .filter(file => /\.(?:spec|test)\.(?:ts|js)$/.test(file));
if (testFiles.length === 0) errors.push('No executable tests were found');

if (errors.length > 0) {
    console.error(`Audit failed with ${errors.length} issue(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
}

for (const [target, summary] of summaries) {
    console.log(
        `${target} audit passed: ${summary.files.length} runtime files, ` +
        `${(summary.bytes / 1024 / 1024).toFixed(2)} MiB`,
    );
}
