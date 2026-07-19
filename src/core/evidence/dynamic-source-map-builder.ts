/**
 * src/core/evidence/dynamic-source-map-builder.ts
 *
 * Maps compiled DNR rule IDs back to the user filter that produced
 * them. Uses the same `rulesetId:ruleId` key convention as
 * source-map-schema.ts.
 */

import {
    makeDnrSourceMapKey,
    validateDnrSourceMapEntry,
    type DnrSourceMapEntry,
    type DnrSourceMapKey,
} from './source-map-schema';

export interface DynamicSourceMapBuilderOptions {
  rulesetId: string;
  now?: () => Date;
}

export class DynamicSourceMapBuilder {
    private readonly rulesetId: string;
    private readonly now: () => Date;
    private readonly entries: DnrSourceMapEntry[] = [];

    constructor(opts: DynamicSourceMapBuilderOptions) {
        this.rulesetId = opts.rulesetId;
        this.now = opts.now ?? (() => new Date());
    }

    getRulesetId(): string {
        return this.rulesetId;
    }

    /**
   * Add a mapping from a compiled rule id to the user filter
   * that produced it.
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
  }): DnrSourceMapEntry {
        const entry: DnrSourceMapEntry = {
      rulesetId: this.rulesetId,
      ruleId: opts.ruleId,
      sourceList: opts.sourceList,
      sourceLine: opts.sourceLine ?? null,
      sourceTextHash: opts.sourceTextHash ?? hashString(opts.originalFilter),
      originalFilter: opts.originalFilter,
      compiledAction: opts.compiledAction,
      lane: opts.lane ?? opts.compiledAction,
      generatedBy: opts.generatedBy ?? 'dynamic-source-map-builder',
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
 * Small non-cryptographic hash. Sufficient for source-line
 * deduplication, not for security.
 */
export function hashString(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
