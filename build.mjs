import * as esbuild from 'esbuild';
import {
    cpSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTargetManifest } from './tools/manifest-targets.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const STATIC_SOURCE = resolve(ROOT, 'src/extension');
const isDevelopment = process.argv.includes('--dev');
const cleanOnly = process.argv.includes('--clean');
const targetArgument = process.argv.find(argument => argument.startsWith('--target='));
const requestedTarget = targetArgument?.split('=', 2)[1] ?? 'all';
const supportedTargets = new Set(['all', 'chromium', 'firefox']);

if (!supportedTargets.has(requestedTarget)) {
    throw new Error(
        `Unsupported target "${requestedTarget}". Use chromium, firefox, or all.`,
    );
}

const targets = requestedTarget === 'all'
    ? ['chromium', 'firefox']
    : [requestedTarget];

const entries = {
    'src/js/popup-fenix.ts': 'js/popup-fenix-bundle.js',
    'src/js/epicker-ui.ts': 'js/epicker-ui-bundle.js',
    'src/js/code-viewer.ts': 'js/code-viewer-bundle.js',
    'src/js/logger-ui.ts': 'js/logger-ui-bundle.js',
    'src/js/logger-ui-inspector.ts': 'js/logger-ui-inspector-bundle.js',
    'src/js/i18n.ts': 'js/i18n.js',
    'src/js/fa-icons.ts': 'js/fa-icons.js',
    'src/js/theme.ts': 'js/theme.js',
    'src/js/dashboard-common.ts': 'js/dashboard-common.js',
    'src/js/dashboard.ts': 'js/dashboard.js',
    'src/js/settings.ts': 'js/settings.js',
    'src/js/3p-filters.ts': 'js/3p-filters.js',
    'src/js/1p-filters.ts': 'js/1p-filters.js',
    'src/js/dyna-rules.ts': 'js/dyna-rules.js',
    'src/js/whitelist.ts': 'js/whitelist.js',
    'src/js/about.ts': 'js/about.js',
    'src/js/advanced-settings.ts': 'js/advanced-settings.js',
    'src/js/asset-viewer.ts': 'js/asset-viewer.js',
    'src/js/document-blocked.ts': 'js/document-blocked.js',
    'src/js/matched-rules.ts': 'js/matched-rules.js',
    'src/js/click2load.ts': 'js/click2load.js',
    'src/js/protections.ts': 'js/protections.js',
    'src/js/contentscript/contentscript-entry.ts': 'js/contentscript.js',
    'src/js/contentscript/youtube-adblock-main.ts': 'js/youtube-adblock-main.js',
    'src/js/contentscript/fluid-player-ad-config-hardener-main.ts': 'js/fluid-player-ad-config-hardener-main.js',
    'src/js/contentscript/youtube-smart-main.ts': 'js/youtube-smart-main.js',
    'src/js/contentscript/youtube-smart-isolated.ts': 'js/youtube-smart-isolated.js',
    'src/js/contentscript/universal-ad-interceptor-main.ts': 'js/universal-ad-interceptor-main.js',
    'src/js/smart-content.ts': 'js/smart-content.js',
    'src/js/mv3/stealth-surrogates.ts': 'js/stealth-surrogates.js',
    'src/js/video-adblock/index.ts': 'js/video-adblock-generic.js',
    'src/js/mv3/youtube-engine.ts': 'js/youtube-engine.js',
    'src/js/mv3/logger-runtime.ts': 'js/logger-runtime.js',
    'src/js/scriptlets/cosmetic-logger.ts': 'js/scriptlets/cosmetic-logger.js',
    'src/core/smart-cosmetic/engine.ts': 'js/smart-engine.js',
};

const moduleOutputs = new Set([
    'js/stealth-surrogates.js',
    'js/youtube-engine.js',
    'js/logger-runtime.js',
    'js/smart-engine.js',
]);

function listFiles(root) {
    const files = [];
    const visit = directory => {
        for (const name of readdirSync(directory)) {
            const absolute = join(directory, name);
            if (statSync(absolute).isDirectory()) {
                visit(absolute);
            } else {
                files.push(absolute);
            }
        }
    };
    visit(root);
    return files;
}

function assertStaticSourceIsClean() {
    if (!existsSync(STATIC_SOURCE)) {
        throw new Error(`Missing static source directory: ${STATIC_SOURCE}`);
    }
    const allowedLocales = new Set([
        'de', 'en', 'es', 'fr', 'hi', 'it', 'ja',
        'pt_BR', 'pt_PT', 'ru', 'zh_CN', 'zh_TW',
    ]);
    for (const file of listFiles(STATIC_SOURCE)) {
        const rel = relative(STATIC_SOURCE, file).replaceAll('\\', '/');
        if (
            rel.endsWith('.unsupported.json') ||
            rel.endsWith('.source-map.json') ||
            rel.endsWith('.budget.json') ||
            rel.includes('/_metadata/') ||
            rel.endsWith('-bundle.js')
        ) {
            throw new Error(`Generated artifact found in static source: ${rel}`);
        }
        const localeMatch = /^_locales\/([^/]+)\//.exec(rel);
        if (localeMatch && !allowedLocales.has(localeMatch[1])) {
            throw new Error(`Unexpected locale in static source: ${localeMatch[1]}`);
        }
    }
}

async function bundle(staging, entryRelative, outputRelative, format = 'iife') {
    const outfile = resolve(staging, outputRelative);
    mkdirSync(dirname(outfile), { recursive: true });
    await esbuild.build({
        entryPoints: [resolve(ROOT, entryRelative)],
        outfile,
        bundle: true,
        platform: 'browser',
        format,
        target: 'es2022',
        treeShaking: true,
        minify: !isDevelopment,
        sourcemap: isDevelopment ? 'external' : false,
        legalComments: 'none',
        charset: 'utf8',
        define: {
            'process.env.NODE_ENV': isDevelopment ? '"development"' : '"production"',
        },
        logLevel: 'warning',
    });
    const header = `// Generated from ${entryRelative}. Run npm run build; do not edit.\n`;
    const content = readFileSync(outfile, 'utf8');
    writeFileSync(outfile, header + content, 'utf8');
}

if (cleanOnly) {
    for (const target of ['chromium', 'firefox']) {
        rmSync(resolve(ROOT, `platform/${target}`), {
            recursive: true,
            force: true,
        });
        rmSync(resolve(ROOT, `dist/.${target}-build`), {
            recursive: true,
            force: true,
        });
    }
    process.exit(0);
}

function configureManifest(staging, target) {
    const path = resolve(staging, 'manifest.json');
    const sourceManifest = JSON.parse(readFileSync(path, 'utf8'));
    if (sourceManifest.version !== '0.2.0') {
        throw new Error(
            `Static manifest version must be 0.2.0, found ${sourceManifest.version}`,
        );
    }

    if (target === 'chromium') {
        rmSync(resolve(staging, 'js/firefox-api-bridge.js'), { force: true });
        return;
    }

    const manifest = createTargetManifest(sourceManifest, target);
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function injectFirefoxBridge(staging) {
    for (const file of listFiles(staging).filter(path => path.endsWith('.html'))) {
        const html = readFileSync(file, 'utf8');
        if (
            !html.includes('</head>') ||
            html.includes('firefox-api-bridge.js')
        ) {
            continue;
        }
        writeFileSync(
            file,
            html.replace(
                '</head>',
                '<script src="/js/firefox-api-bridge.js"></script>\n</head>',
            ),
            'utf8',
        );
    }
}

async function buildTarget(target) {
    const output = resolve(ROOT, `platform/${target}`);
    const staging = resolve(ROOT, `dist/.${target}-build`);

    rmSync(staging, { recursive: true, force: true });
    mkdirSync(dirname(staging), { recursive: true });
    cpSync(STATIC_SOURCE, staging, { recursive: true });
    for (const file of listFiles(staging)) {
        if (file.endsWith('.ts')) rmSync(file, { force: true });
    }

    for (const [entry, outfile] of Object.entries(entries)) {
        await bundle(
            staging,
            entry,
            outfile,
            moduleOutputs.has(outfile) ? 'esm' : 'iife',
        );
    }
    await bundle(staging, 'src/extension/js/sw-entry.ts', 'js/sw.js', 'esm');
    configureManifest(staging, target);
    if (target === 'firefox') injectFirefoxBridge(staging);

    rmSync(output, { recursive: true, force: true });
    mkdirSync(dirname(output), { recursive: true });
    renameSync(staging, output);

    const files = listFiles(output);
    const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
    console.log(
        `${target === 'firefox' ? 'Firefox' : 'Chromium'} ` +
        `${isDevelopment ? 'development' : 'production'} build: ` +
        `${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB`,
    );
}

assertStaticSourceIsClean();
for (const target of targets) {
    await buildTarget(target);
}
