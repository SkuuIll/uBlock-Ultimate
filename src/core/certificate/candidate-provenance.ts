export const CANDIDATE_PROVENANCE_SCHEMA_VERSION = 1;

export interface SourceProvenance {
  gitCommit: string;
  dirtyWorktree: boolean;
  sourceTreeHash: string;
  packageLockHash: string;
  packageManager: string;
  installCommand: string;
  dependencyTreeHash: string;
  nodeVersion: string;
  npmVersion: string;
}

export interface CandidatePackageHashes {
  unpackedPackageSha256: string;
  submittedPackageSha256: string;
  submittedPackageType: 'zip' | 'crx' | 'directory-manifest';
  manifestSha256: string;
  dnrRulesetSha256: string;
  sourceMapSha256: string;
  unsupportedSyntaxReportSha256: string;
}

export interface CandidateProvenance {
  schemaVersion: number;
  source: SourceProvenance;
  packageHashes: CandidatePackageHashes;
  buildCommand: string;
}

export function validateCandidateProvenance(provenance: unknown): string[] {
    const errors: string[] = [];
    if (!provenance || typeof provenance !== 'object') {
    errors.push('candidate provenance must be an object');
    return errors;
    }
    const p = provenance as Record<string, unknown>;
    if (p.schemaVersion !== CANDIDATE_PROVENANCE_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CANDIDATE_PROVENANCE_SCHEMA_VERSION}`);
    }
    const src = p.source as Record<string, unknown> | undefined;
    if (!src) { errors.push('source is required'); return errors; }
    if (typeof src.gitCommit !== 'string' || !src.gitCommit) errors.push('source.gitCommit must be a non-empty string');
    if (typeof src.dirtyWorktree !== 'boolean') errors.push('source.dirtyWorktree must be a boolean');
    if (src.dirtyWorktree === true && (typeof src.sourceTreeHash !== 'string' || !src.sourceTreeHash)) {
      errors.push('source.sourceTreeHash must be a valid hash when dirtyWorktree is true');
    }
    if (typeof src.packageLockHash !== 'string' || !/^[0-9a-f]{64}$/.test(String(src.packageLockHash))) {
    errors.push('source.packageLockHash must be a valid SHA-256 hex string');
    }
    return errors;
}

export function packageHashesMatch(
    a: CandidatePackageHashes,
    b: CandidatePackageHashes,
): boolean {
    return (
        a.unpackedPackageSha256 === b.unpackedPackageSha256 &&
    a.submittedPackageSha256 === b.submittedPackageSha256 &&
    a.submittedPackageType === b.submittedPackageType &&
    a.manifestSha256 === b.manifestSha256 &&
    a.dnrRulesetSha256 === b.dnrRulesetSha256 &&
    a.sourceMapSha256 === b.sourceMapSha256 &&
    a.unsupportedSyntaxReportSha256 === b.unsupportedSyntaxReportSha256
    );
}

export function allPackageHashesSet(hashes: CandidatePackageHashes): boolean {
    const allSet = (
        hashes.unpackedPackageSha256.length === 64 &&
    hashes.submittedPackageSha256.length === 64 &&
    hashes.manifestSha256.length === 64 &&
    hashes.dnrRulesetSha256.length === 64 &&
    hashes.sourceMapSha256.length === 64 &&
    hashes.unsupportedSyntaxReportSha256.length === 64
    );
    return allSet && !/^0{64}$/.test(hashes.unpackedPackageSha256);
}

export function checkDirtyWorktreeBlocking(
    provenance: CandidateProvenance,
): boolean {
    if (provenance.source.dirtyWorktree) {
        const sourceTreeHash = provenance.source.sourceTreeHash;
        const _dirtyMsg = 'dirty worktree without exact source tree/archive hash';
        return !sourceTreeHash || sourceTreeHash.length < 10;
    }
    return false;
}

export * as CandidateProvenance from './candidate-provenance';
