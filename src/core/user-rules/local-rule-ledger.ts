/**
 * src/core/user-rules/local-rule-ledger.ts
 *
 * Pure, immutable ledger model for user-authored rules.
 *
 * The ledger is the single source of truth for rules the user has
 * added locally (manual editor, file import, clipboard paste).
 * It is intentionally not coupled to DNR or any runtime API.
 */

export type UserRuleLane =
  | 'persistent-safe-dynamic'
  | 'persistent-unsafe-dynamic'
  | 'temporary-session'
  | 'cosmetic-local';

export type UserRuleSource =
  | 'manual-editor'
  | 'local-file-import'
  | 'clipboard-paste';

export interface UserRuleLedgerEntry {
  id: string;
  lane: UserRuleLane;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  source: UserRuleSource;
  originalText: string;
  compiledRuleIds: number[];
  notes: string[];
}

export interface UserRuleLedger {
  version: 1;
  entries: UserRuleLedgerEntry[];
}

const VALID_LANES: readonly UserRuleLane[] = [
  'persistent-safe-dynamic',
  'persistent-unsafe-dynamic',
  'temporary-session',
  'cosmetic-local',
];

const VALID_SOURCES: readonly UserRuleSource[] = [
  'manual-editor',
  'local-file-import',
  'clipboard-paste',
];

export interface LedgerValidation {
  ok: boolean;
  errors: string[];
}

export function createEmptyUserRuleLedger(): UserRuleLedger {
    return { version: 1, entries: [] };
}

function isValidIsoString(s: unknown): boolean {
    if (typeof s !== 'string' || s.length === 0) return false;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return false;
    // toISOString round-trips only if the input was ISO 8601 in the
    // exact form `YYYY-MM-DDTHH:mm:ss[.sss]Z` (or with offset).
    return d.toISOString() === s || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(s);
}

export function validateUserRuleLedgerEntry(
    entry: UserRuleLedgerEntry,
): LedgerValidation {
    const errors: string[] = [];

    if (typeof entry.id !== 'string' || entry.id.length === 0) {
    errors.push('id is empty');
    }

    if (!VALID_LANES.includes(entry.lane)) {
    errors.push('lane is invalid');
    }

    if (!isValidIsoString(entry.createdAt)) {
    errors.push('createdAt is not a valid ISO string');
    }

    if (!isValidIsoString(entry.updatedAt)) {
    errors.push('updatedAt is not a valid ISO string');
    }

    if (!VALID_SOURCES.includes(entry.source)) {
    errors.push('source is invalid');
    }

    if (typeof entry.originalText !== 'string' || entry.originalText.length === 0) {
    errors.push('originalText is empty');
    }

    if (!Array.isArray(entry.compiledRuleIds)) {
    errors.push('compiledRuleIds is not an array');
    } else {
        for (const id of entry.compiledRuleIds) {
            if (!Number.isInteger(id) || id <= 0) {
        errors.push('compiledRuleIds contains a non-positive integer');
        break;
            }
        }
    }

    if (!Array.isArray(entry.notes)) {
    errors.push('notes is not an array');
    }

    return { ok: errors.length === 0, errors };
}

export function upsertUserRuleLedgerEntry(
    ledger: UserRuleLedger,
    entry: UserRuleLedgerEntry,
): UserRuleLedger {
    const idx = ledger.entries.findIndex(e => e.id === entry.id);
    if (idx === -1) {
        return {
      version: 1,
      entries: [...ledger.entries, entry],
        };
    }
    const next = ledger.entries.slice();
    next[idx] = entry;
    return { version: 1, entries: next };
}

export function removeUserRuleLedgerEntry(
    ledger: UserRuleLedger,
    id: string,
): UserRuleLedger {
    return {
    version: 1,
    entries: ledger.entries.filter(e => e.id !== id),
    };
}

export function countLedgerEntriesByLane(
    ledger: UserRuleLedger,
): Record<UserRuleLane, number> {
    const out: Record<UserRuleLane, number> = {
    'persistent-safe-dynamic': 0,
    'persistent-unsafe-dynamic': 0,
    'temporary-session': 0,
    'cosmetic-local': 0,
    };
    for (const e of ledger.entries) {
        if (e.lane in out) {
            out[e.lane]++;
        }
    }
    return out;
}
