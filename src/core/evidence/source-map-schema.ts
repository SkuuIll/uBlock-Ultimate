/**
 * src/core/evidence/source-map-schema.ts
 *
 * Lightweight types and validators for the DNR source-map entries
 * that link a compiled DNR rule back to the original filter-list
 * source line. Used for telemetry and for diagnostics when a rule
 * misbehaves.
 */

export interface DnrSourceMapEntry {
  rulesetId: string;
  ruleId: number;
  sourceList: string;
  sourceLine: number | null;
  sourceTextHash: string;
  originalFilter: string;
  compiledAction: string;
  lane: string;
  generatedBy: string;

  /**
   * Display-only regex used by the logger to emphasize the portion
   * of the request URL matched by this rule.
   */
  loggerRegex?: string;
}

export type DnrSourceMapKey = `${string}:${number}`;

export function makeDnrSourceMapKey(
    rulesetId: string,
    ruleId: number,
): DnrSourceMapKey {
    return `${rulesetId}:${ruleId}`;
}

export interface DnrSourceMapValidation {
  ok: boolean;
  errors: string[];
}

export function validateDnrSourceMapEntry(
    entry: DnrSourceMapEntry,
): DnrSourceMapValidation {
    const errors: string[] = [];

    if (typeof entry.rulesetId !== 'string' || entry.rulesetId.length === 0) {
    errors.push('rulesetId is empty');
    }

    if (!Number.isInteger(entry.ruleId) || entry.ruleId <= 0) {
    errors.push('ruleId is not a positive integer');
    }

    if (typeof entry.sourceList !== 'string' || entry.sourceList.length === 0) {
    errors.push('sourceList is empty');
    }

    if (
        typeof entry.sourceTextHash !== 'string' ||
    entry.sourceTextHash.length === 0
    ) {
    errors.push('sourceTextHash is empty');
    }

    if (
        typeof entry.originalFilter !== 'string' ||
    entry.originalFilter.length === 0
    ) {
    errors.push('originalFilter is empty');
    }

    if (
        typeof entry.compiledAction !== 'string' ||
    entry.compiledAction.length === 0
    ) {
    errors.push('compiledAction is empty');
    }

    if (entry.sourceLine !== null) {
        if (!Number.isInteger(entry.sourceLine) || entry.sourceLine < 1) {
      errors.push('sourceLine is not a positive integer or null');
        }
    }

    if (typeof entry.lane !== 'string' || entry.lane.length === 0) {
    errors.push('lane is empty');
    }

    if (typeof entry.generatedBy !== 'string' || entry.generatedBy.length === 0) {
    errors.push('generatedBy is empty');
    }

    if (
        entry.loggerRegex !== undefined &&
        typeof entry.loggerRegex !== 'string'
    ) {
    errors.push('loggerRegex is not a string');
    }

    return { ok: errors.length === 0, errors };
}
