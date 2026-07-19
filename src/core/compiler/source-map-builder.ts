/**
 * src/core/compiler/source-map-builder.ts
 *
 * Static-source-map builder. Mirrors DynamicSourceMapBuilder but
 * operates on a whole compiled ruleset at build time. Every
 * emitted DNR rule gets exactly one source-map entry.
 *
 * Keys are `rulesetId:ruleId` per Rev15 §7.3.
 */

import {
    makeDnrSourceMapKey,
    validateDnrSourceMapEntry,
    type DnrSourceMapEntry,
    type DnrSourceMapKey,
} from '../evidence/source-map-schema';

export interface StaticSourceMapBuilderOptions {
  rulesetId: string;
  now?: () => Date;
}

export class StaticSourceMapBuilder {
    private readonly rulesetId: string;
    private readonly now: () => Date;
    private readonly entries: DnrSourceMapEntry[] = [];

    constructor(opts: StaticSourceMapBuilderOptions) {
        this.rulesetId = opts.rulesetId;
        this.now = opts.now ?? (() => new Date());
    }

    getRulesetId(): string {
        return this.rulesetId;
    }

    /**
   * Add a mapping from a compiled rule id to the original filter
   * line that produced it. `sourceTextHash` defaults to a stable
   * non-cryptographic hash of the original filter so deduplication
   * across runs is straightforward.
   */
    add(opts: {
    ruleId: number;
    sourceList: string;
    originalFilter: string;
    compiledAction: string;
    sourceLine?: number | null;
    sourceTextHash?: string;
    lane?: string;
    generatedBy?: string;
    loggerRegex?: string;
  }): DnrSourceMapEntry {
        if (!Number.isInteger(opts.ruleId) || opts.ruleId <= 0) {
            throw new Error(`Invalid ruleId ${opts.ruleId}; must be a positive integer.`);
        }
        const entry: DnrSourceMapEntry = {
      rulesetId: this.rulesetId,
      ruleId: opts.ruleId,
      sourceList: opts.sourceList,
      sourceLine: opts.sourceLine ?? null,
      sourceTextHash: opts.sourceTextHash ?? hashString(opts.originalFilter),
      originalFilter: opts.originalFilter,
      compiledAction: opts.compiledAction,
      lane: opts.lane ?? opts.compiledAction,
      generatedBy: opts.generatedBy ?? 'static-ruleset-compiler',
      loggerRegex: opts.loggerRegex,
        };
    this.entries.push(entry);
    return entry;
    }

    keyFor(ruleId: number): DnrSourceMapKey {
        return makeDnrSourceMapKey(this.rulesetId, ruleId);
    }

    size(): number {
        return this.entries.length;
    }

    entries_(): readonly DnrSourceMapEntry[] {
        return this.entries.slice();
    }

    validate(): { ok: boolean; errors: string[] } {
        const errors: string[] = [];
        for (const e of this.entries) {
            const r = validateDnrSourceMapEntry(e);
            if (!r.ok) {
                for (const err of r.errors) errors.push(`ruleId ${e.ruleId}: ${err}`);
            }
        }
        return { ok: errors.length === 0, errors };
    }
}

/**
 * Small non-cryptographic djb2-style hash. Sufficient for
 * source-line deduplication, not for security.
 */
export function hashString(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
