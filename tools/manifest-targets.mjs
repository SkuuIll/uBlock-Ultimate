export const FIREFOX_EXTENSION_ID = '@ublock-ultimate-skuill';

export function createTargetManifest(source, target) {
    const manifest = structuredClone(source);
    if (target === 'chromium') return manifest;
    if (target !== 'firefox') {
        throw new Error(`Unsupported manifest target: ${target}`);
    }

    manifest.background = {
        scripts: [
            'js/firefox-api-bridge.js',
            'js/sw.js',
        ],
        type: 'module',
    };
    manifest.browser_specific_settings = {
        gecko: {
            id: FIREFOX_EXTENSION_ID,
            strict_min_version: '140.0',
            data_collection_permissions: {
                required: ['none'],
            },
        },
        gecko_android: {
            strict_min_version: '142.0',
        },
    };
    manifest.options_ui = {
        page: 'dashboard.html',
        open_in_tab: true,
    };
    delete manifest.minimum_chrome_version;
    delete manifest.options_page;
    delete manifest.storage;
    delete manifest.action.browser_style;

    for (const contentScript of manifest.content_scripts ?? []) {
        if (contentScript.world === 'MAIN') continue;
        const scripts = contentScript.js ?? [];
        if (!scripts.includes('/js/firefox-api-bridge.js')) {
            contentScript.js = ['/js/firefox-api-bridge.js', ...scripts];
        }
    }

    return manifest;
}
