import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const workflow = readFileSync(
    resolve(root, '.github/workflows/release.yml'),
    'utf8',
);
const packageTool = readFileSync(
    resolve(root, 'tools/package-release.mjs'),
    'utf8',
);

describe('automatic release contract', () => {
    it('builds on main updates and version tags', () => {
        expect(workflow).toContain('branches:\n      - main');
        expect(workflow).toContain("tags:\n      - 'v*'");
        expect(workflow).toContain('actions/upload-artifact@v4');
        expect(workflow).toContain('tag_name: continuous');
        expect(workflow).toContain('Create versioned release');
        expect(workflow).toContain(
            'npm install --global npm@11.17.0',
        );
    });

    it('publishes separate Chromium and Firefox ZIP files', () => {
        expect(workflow).toContain(
            'uBlock-Ultimate-${{ env.VERSION }}-chromium.zip',
        );
        expect(workflow).toContain(
            'uBlock-Ultimate-${{ env.VERSION }}-firefox.zip',
        );
        expect(packageTool).toContain('const suffix = `${target}.zip`');
        expect(packageTool).toContain("resolve(RELEASE, 'SHA256SUMS.txt')");
        expect(workflow).toContain('RELEASE_NOTES.md');
        expect(workflow).toContain('Google Chrome / Chromium MV3');
        expect(workflow).toContain('Firefox Desktop / Android');
        expect(workflow).toContain('done < dist/release/SHA256SUMS.txt');
    });

    it('only signs Firefox when Mozilla credentials are configured', () => {
        expect(workflow).toContain('secrets.AMO_JWT_ISSUER');
        expect(workflow).toContain('secrets.AMO_JWT_SECRET');
        expect(workflow).toContain('--channel unlisted');
        expect(workflow).toContain('firefox-signed.xpi');
    });
});
