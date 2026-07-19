import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const source = resolve(root, 'src/extension');

function readPngSize(path: string): [number, number] {
    const png = readFileSync(path);
    expect(png.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

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

    it('ships a complete, correctly sized PNG icon family', () => {
        const iconDirectory = resolve(source, 'img');
        const sizes = [16, 32, 48, 64, 96, 128, 256];
        for (const size of sizes) {
            expect(readPngSize(resolve(iconDirectory, `ublock${size}.png`)))
                .toEqual([size, size]);
        }
        expect(existsSync(resolve(iconDirectory, 'ublock.svg'))).toBe(false);
        expect(existsSync(resolve(iconDirectory, 'ublock-defs.svg'))).toBe(false);
        expect(existsSync(resolve(iconDirectory, 'brand-icon-master.png'))).toBe(false);
    });
});
