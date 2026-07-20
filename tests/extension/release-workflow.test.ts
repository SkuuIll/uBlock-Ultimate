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
const publishScript = readFileSync(
    resolve(root, '.github/scripts/publish-release.sh'),
    'utf8',
);

describe('automatic release contract', () => {
    it('builds on main updates and version tags', () => {
        expect(workflow).toContain('branches:\n      - main');
        expect(workflow).toContain("tags:\n      - 'v*'");
        expect(workflow).toContain('actions/upload-artifact@v4');
        expect(workflow).toContain(
            'bash .github/scripts/publish-release.sh',
        );
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
        expect(packageTool).toContain('FORBIDDEN_PROJECT_ENTRY');
        expect(packageTool).toContain(
            'package contains project-only file',
        );
    });

    it('retries transient API failures and verifies every asset digest', () => {
        expect(publishScript).toContain('max_attempts=8');
        expect(publishScript).toContain('gh release view "$tag"');
        expect(publishScript).toContain('release create "$tag"');
        expect(publishScript).toContain('gh "${args[@]}"');
        expect(publishScript).toContain(
            'expected_digest="sha256:$(sha256sum',
        );
        expect(publishScript).toContain(
            'remote_asset_metadata "$name"',
        );
        expect(publishScript).toContain(
            'delete_remote_asset "$asset_id"',
        );
        expect(publishScript).toContain(
            'gh release upload "$tag" "$asset"',
        );
        expect(publishScript).toContain(
            'for asset in "${assets[@]}"; do',
        );
        expect(workflow).not.toContain('softprops/action-gh-release');
    });

    it('only signs Firefox when Mozilla credentials are configured', () => {
        expect(workflow).toContain('secrets.AMO_JWT_ISSUER');
        expect(workflow).toContain('secrets.AMO_JWT_SECRET');
        expect(workflow).toContain('--channel unlisted');
        expect(workflow).toContain('firefox-signed.xpi');
    });
});
