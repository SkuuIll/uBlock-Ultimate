export interface EvidenceManifest {
  schemaVersion: number;
  inputManifestHash: string;
  allArtifactsRegeneratedInThisRun: boolean;
  artifactHashes: { [artifactPath: string]: string };
}

export const EVIDENCE_MANIFEST_SCHEMA_VERSION = 1;

export function checkStaleArtifacts(
    manifest: EvidenceManifest,
    currentInputManifestHash: string,
    currentArtifactHashes: { [path: string]: string },
): { stale: boolean; mismatches: string[] } {
    const mismatches: string[] = [];
    if (manifest.inputManifestHash !== currentInputManifestHash) {
    mismatches.push(
        `input manifest hash changed: ${manifest.inputManifestHash} -> ${currentInputManifestHash}`,
    );
    }
    for (const [p, currentHash] of Object.entries(currentArtifactHashes)) {
        const recordedHash = manifest.artifactHashes[p];
        if (!recordedHash) {
      mismatches.push(`artifact ${p} is not in the evidence manifest`);
      continue;
        }
        if (recordedHash !== currentHash) {
      mismatches.push(`artifact ${p} hash mismatch: recorded=${recordedHash} current=${currentHash}`);
        }
    }
    for (const p of Object.keys(manifest.artifactHashes)) {
        if (!(p in currentArtifactHashes)) {
      mismatches.push(`artifact ${p} recorded in manifest but not in current artifacts`);
        }
    }
    return { stale: mismatches.length > 0, mismatches };
}

export function buildEvidenceManifest(
    inputManifestHash: string,
    artifactHashes: { [path: string]: string },
): EvidenceManifest {
    return {
    schemaVersion: EVIDENCE_MANIFEST_SCHEMA_VERSION,
    inputManifestHash,
    allArtifactsRegeneratedInThisRun: true,
    artifactHashes,
    };
}

export function hasFixturePaths(artifactHashes: { [path: string]: string }): boolean {
    return Object.keys(artifactHashes).some(
        p => p.includes('/fixture/') || p.includes('/test/') || p.includes('/mock/') || p.includes('/__tests__/'),
    );
}

export * as EvidenceManifest from './evidence-manifest';
