import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    FIREFOX_EXTENSION_ID,
    createTargetManifest,
} from '../../tools/manifest-targets.mjs';

const source = JSON.parse(readFileSync(
    resolve(import.meta.dirname, '../../src/extension/manifest.json'),
    'utf8',
));

describe('target manifests', () => {
    it('keeps the Chromium service worker contract unchanged', () => {
        const manifest = createTargetManifest(source, 'chromium');
        expect(manifest.background).toEqual({
            service_worker: 'js/sw.js',
            type: 'module',
        });
        expect(manifest.minimum_chrome_version).toBe('120');
        expect(manifest.browser_specific_settings).toBeUndefined();
    });

    it('creates a Firefox Desktop and Android MV3 manifest', () => {
        const manifest = createTargetManifest(source, 'firefox');
        expect(manifest.background).toEqual({
            scripts: ['js/firefox-api-bridge.js', 'js/sw.js'],
            type: 'module',
        });
        expect(manifest.background.service_worker).toBeUndefined();
        expect(manifest.minimum_chrome_version).toBeUndefined();
        expect(manifest.storage).toBeUndefined();
        expect(manifest.options_ui).toEqual({
            page: 'dashboard.html',
            open_in_tab: true,
        });
        expect(manifest.browser_specific_settings).toMatchObject({
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
        });

        const isolated = manifest.content_scripts.find(
            (entry: { world?: string }) => entry.world !== 'MAIN',
        );
        expect(isolated.js[0]).toBe('/js/firefox-api-bridge.js');
    });

    it('does not mutate the canonical manifest', () => {
        createTargetManifest(source, 'firefox');
        expect(source.background.service_worker).toBe('js/sw.js');
        expect(source.browser_specific_settings).toBeUndefined();
    });
});
