import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const source = resolve(root, 'src/extension');

describe('extension source contract', () => {
    it('contains exactly the supported locales', () => {
        const locales = readdirSync(resolve(source, '_locales'))
            .filter(name => statSync(resolve(source, '_locales', name)).isDirectory())
            .sort();
        expect(locales).toEqual([
            'de', 'en', 'es', 'fr', 'hi', 'it',
            'ja', 'pt_BR', 'pt_PT', 'ru', 'zh_CN', 'zh_TW',
        ]);
    });

    it('uses the professional identity and least known permission set', () => {
        const manifest = JSON.parse(readFileSync(resolve(source, 'manifest.json'), 'utf8'));
        expect(manifest).toMatchObject({
            name: 'uBlock Ultimate',
            version: '0.2.0',
            manifest_version: 3,
        });
        expect(manifest.permissions).not.toContain('unlimitedStorage');
        expect(manifest.commands).not.toHaveProperty('toggle-newtab');
    });
});
