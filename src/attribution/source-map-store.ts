/**
 * src/attribution/source-map-store.ts
 *
 * In-memory index of compiled DNR source-map entries. Reads the
 * `<rulesetId>.source-map.json` files written by
 * `src/mv3/static-ruleset-packager.ts` and provides O(1) lookup
 * by `${rulesetId}:${ruleId}` (the `makeDnrSourceMapKey`
 * convention).
 *
 * Pure module. No chrome. No I/O at construction time
 * (use `loadFromDisk` for that). `setRuntimeEntry` lets the
 * SW register dynamic source-map entries produced by
 * `dynamic-source-map-builder` after the static ones are loaded.
 */

import {
    makeDnrSourceMapKey,
    validateDnrSourceMapEntry,
    type DnrSourceMapEntry,
    type DnrSourceMapKey,
} from '../core/evidence/source-map-schema';

export type SourceMapFileSystem = {
  readFile: (_path: string) => string;
  readDir: (_path: string) => string[];
  exists: (_path: string) => boolean;
};

export interface NodeSourceMapFileSystem extends SourceMapFileSystem {
  readFile: (_path: string) => string;
  readDir: (_path: string) => string[];
  exists: (_path: string) => boolean;
}

export const UNKNOWN_SOURCE_MAP_ENTRY: Pick<
  DnrSourceMapEntry,
  'sourceList' | 'sourceLine' | 'sourceTextHash'
> = Object.freeze({
  sourceList: 'unknown',
  sourceLine: null,
  sourceTextHash: null,
});

export interface SourceMapStoreLoadResult {
  loaded: number;
  skipped: number;
  errors: string[];
}

export class SourceMapStore {
    private readonly entries: Map<DnrSourceMapKey, DnrSourceMapEntry> = new Map();

    size(): number {
        return this.entries.size;
    }

    has(rulesetId: string, ruleId: number): boolean {
        return this.entries.has(makeDnrSourceMapKey(rulesetId, ruleId));
    }

    /**
   * Look up a source-map entry by rulesetId and ruleId. Returns
   * `null` if not found — callers should fall back to
   * `UNKNOWN_SOURCE_MAP_ENTRY` for UI display.
   */
    get(rulesetId: string, ruleId: number): DnrSourceMapEntry | null {
        return this.entries.get(makeDnrSourceMapKey(rulesetId, ruleId)) ?? null;
    }

    /**
   * Resolve with a guaranteed-non-null result. If the key is
   * missing, returns the canonical "unknown" sentinel merged
   * with the requested rulesetId/ruleId so the UI can still
   * render a row.
   */
    resolve(rulesetId: string, ruleId: number): DnrSourceMapEntry {
        return (
      this.entries.get(makeDnrSourceMapKey(rulesetId, ruleId)) ?? {
        ...UNKNOWN_SOURCE_MAP_ENTRY,
        rulesetId,
        ruleId,
        compiledAction: 'unknown',
        originalFilter: '',
            }
        );
    }

    /**
   * Insert or replace a runtime source-map entry (e.g. for
   * dynamic rules produced by `dynamic-source-map-builder`).
   * Throws on invalid entries; callers should validate first.
   */
    setRuntimeEntry(entry: DnrSourceMapEntry): DnrSourceMapKey {
        const v = validateDnrSourceMapEntry(entry);
        if (!v.ok) {
            throw new Error(
                `invalid source-map entry for ${entry.rulesetId}:${entry.ruleId}: ${v.errors.join('; ')}`,
            );
        }
        const key = makeDnrSourceMapKey(entry.rulesetId, entry.ruleId);
    this.entries.set(key, entry);
    return key;
    }

    /**
   * Remove entries matching the predicate. Returns the count
   * removed.
   */
    prune(predicate: (_entry: DnrSourceMapEntry) => boolean): number {
        let removed = 0;
        for (const [key, entry] of this.entries) {
            if (predicate(entry)) {
        this.entries.delete(key);
        removed++;
            }
        }
        return removed;
    }

    entries_(): readonly DnrSourceMapEntry[] {
        return Array.from(this.entries.values());
    }

    static loadFromDisk(
        rootDir: string,
        fs: SourceMapFileSystem,
    ): { store: SourceMapStore; result: SourceMapStoreLoadResult } {
        const store = new SourceMapStore();
        const result: SourceMapStoreLoadResult = { loaded: 0, skipped: 0, errors: [] };
        if (!fs.exists(rootDir)) {
            return { store, result };
        }
        const files = fs.readDir(rootDir).filter(name => name.endsWith('.source-map.json'));
        for (const file of files) {
            const path = `${rootDir}/${file}`;
            let text: string;
            try {
                text = fs.readFile(path);
            } catch (err) {
        console.warn('[uBR] source-map-store: read failed', file, err);
        result.errors.push(`read failed ${file}: ${(err as Error).message}`);
        result.skipped++;
        continue;
            }
            let payload: unknown;
            try {
                payload = JSON.parse(text);
            } catch (err) {
        console.warn('[uBR] source-map-store: JSON parse failed', file, err);
        result.errors.push(`json parse failed ${file}: ${(err as Error).message}`);
        result.skipped++;
        continue;
            }
            const arr = Array.isArray(payload) ? payload : extractEntries(payload);
            if (!arr) {
        result.errors.push(`unrecognized payload shape in ${file}`);
        result.skipped++;
        continue;
            }
            for (const raw of arr) {
                if (!isDnrSourceMapEntry(raw)) {
          result.errors.push(`invalid entry in ${file}: missing required field`);
          result.skipped++;
          continue;
                }
                const v = validateDnrSourceMapEntry(raw);
                if (!v.ok) {
          result.errors.push(
              `validation failed in ${file} for ${raw.rulesetId}:${raw.ruleId}: ${v.errors.join('; ')}`,
          );
          result.skipped++;
          continue;
                }
        store.setRuntimeEntry(raw);
        result.loaded++;
            }
        }
        return { store, result };
    }
}

function extractEntries(payload: unknown): unknown[] | null {
    if (!payload || typeof payload !== 'object') return null;
    const candidate = (payload as { entries?: unknown }).entries;
    return Array.isArray(candidate) ? candidate : null;
}

function isDnrSourceMapEntry(value: unknown): value is DnrSourceMapEntry {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.rulesetId === 'string' &&
    v.rulesetId.length > 0 &&
    typeof v.ruleId === 'number' &&
    Number.isInteger(v.ruleId) &&
    v.ruleId > 0 &&
    typeof v.sourceList === 'string' &&
    v.sourceList.length > 0 &&
    typeof v.sourceTextHash === 'string' &&
    v.sourceTextHash.length > 0 &&
    typeof v.originalFilter === 'string' &&
    v.originalFilter.length > 0 &&
    typeof v.compiledAction === 'string' &&
    v.compiledAction.length > 0 &&
    (v.sourceLine === null || typeof v.sourceLine === 'number')
    );
}
