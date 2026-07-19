export const COMPARATOR_SELECTION_SCHEMA_VERSION = 1;

export interface ComparatorSelectionRecord {
  schemaVersion: number;
  comparator: {
    name: string;
    version: string;
    mv3Only: boolean;
    source: string;
    sha256: string;
    installCommand: string;
    rationale: string;
  };
  pinnedAt: string;
}

export interface CorpusSelectionRecord {
  schemaVersion: number;
  networkCorpus: {
    name: string;
    version: string;
    files: string[];
    oracleHash: string;
    license: string;
    rationale: string;
  };
  cosmeticCorpus: {
    name: string;
    version: string;
    files: string[];
    oracleHash: string;
    license: string;
    rationale: string;
  };
  pinnedAt: string;
}

export function validateComparatorSelectionRecord(record: unknown): string[] {
    const errors: string[] = [];
    if (!record || typeof record !== 'object') {
    errors.push('comparator selection record must be an object');
    return errors;
    }
    const r = record as Record<string, unknown>;
    if (r.schemaVersion !== COMPARATOR_SELECTION_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${COMPARATOR_SELECTION_SCHEMA_VERSION}`);
    }
    const c = r.comparator as Record<string, unknown> | undefined;
    if (!c) { errors.push('comparator field is required'); return errors; }
    if (!c.name || typeof c.name !== 'string') errors.push('comparator.name must be a non-empty string');
    if (!c.version || typeof c.version !== 'string') errors.push('comparator.version must be a non-empty string');
    if (c.mv3Only !== true) errors.push('comparator.mv3Only must be true');
    if (!c.source || typeof c.source !== 'string') errors.push('comparator.source must be a non-empty string');
    if (typeof c.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(c.sha256)) errors.push('comparator.sha256 must be a valid SHA-256 hex string');
    if (!r.pinnedAt || typeof r.pinnedAt !== 'string') errors.push('pinnedAt must be a non-empty ISO timestamp string');
    return errors;
}

export function validateCorpusSelectionRecord(record: unknown): string[] {
    const errors: string[] = [];
    if (!record || typeof record !== 'object') {
    errors.push('corpus selection record must be an object');
    return errors;
    }
    const r = record as Record<string, unknown>;
    if (r.schemaVersion !== COMPARATOR_SELECTION_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${COMPARATOR_SELECTION_SCHEMA_VERSION}`);
    }
    const nc = r.networkCorpus as Record<string, unknown> | undefined;
    if (nc) {
        if (!nc.name || typeof nc.name !== 'string') errors.push('networkCorpus.name is required');
        if (typeof nc.oracleHash !== 'string' || !/^[0-9a-f]{64}$/.test(String(nc.oracleHash))) {
      errors.push('networkCorpus.oracleHash must be a valid SHA-256 hex string');
        }
    }
    const cc = r.cosmeticCorpus as Record<string, unknown> | undefined;
    if (cc) {
        if (!cc.name || typeof cc.name !== 'string') errors.push('cosmeticCorpus.name is required');
        if (typeof cc.oracleHash !== 'string' || !/^[0-9a-f]{64}$/.test(String(cc.oracleHash))) {
      errors.push('cosmeticCorpus.oracleHash must be a valid SHA-256 hex string');
        }
    }
    if (!r.pinnedAt || typeof r.pinnedAt !== 'string') errors.push('pinnedAt is required');
    return errors;
}

export function comparatorMatchesRecord(
    record: ComparatorSelectionRecord,
    name: string,
    version: string,
    sha256: string,
): boolean {
    return (
        record.comparator.name === name &&
    record.comparator.version === version &&
    record.comparator.sha256 === sha256
    );
}

export function corpusHashesMatchRecord(
    record: CorpusSelectionRecord,
    networkHash: string,
    cosmeticHash: string,
): boolean {
    const ncHash = record.networkCorpus?.oracleHash;
    const ccHash = record.cosmeticCorpus?.oracleHash;
    if (ncHash && networkHash !== ncHash) return false;
    if (ccHash && cosmeticHash !== ccHash) return false;
    return true;
}

export * as ComparatorSelectionRecord from './comparator-selection-record';
