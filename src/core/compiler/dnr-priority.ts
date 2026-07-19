/**
 * src/core/compiler/dnr-priority.ts
 *
 * Centralised DNR priority assignment. Every rule produced by the
 * compiler must get its priority through one of these functions.
 *
 * Chrome's DNR uses higher numeric priority = wins.  The band
 * ranges are defined in src/js/mv3/dnr-priority-policy.ts; this
 * module picks a specific midpoint or offset within those bands.
 *
 * Usage:
 *   import { priorityFor } from '@/core/compiler/dnr-priority'
 *   const p = priorityFor({ type: 'block', important: true })
 */

import {
    assertPriorityInBand,
    type DnrPriorityBandName,
} from '../../js/mv3/dnr-priority-policy';

export type CompiledRuleKind =
  | 'block'
  | 'block-important'
  | 'allow'
  | 'allow-important'
  | 'allow-all-requests'
  | 'redirect'
  | 'removeparam'
  | 'modify-headers'
  | 'session-block'
  | 'session-allow'
  | 'user-block'
  | 'user-allow'
  | 'trusted-site';

export interface PriorityInput {
  /** The kind of rule being compiled. */
  kind: CompiledRuleKind;
  /**
   * Optional override band name. When unset, the default band for
   * `kind` is used (see `DEFAULT_BAND`).
   */
  band?: DnrPriorityBandName;
  /**
   * Optional offset from the band midpoint. Negative = lower
   * priority within the band. Default 0.
   */
  offset?: number;
}

/**
 * Priority ranges per rule kind. Each entry selects a band and an
 * optional offset from the band midpoint.
 */
const DEFAULT_BAND: Record<CompiledRuleKind, DnrPriorityBandName> = {
  block: 'packagedHighConfidenceBlock',
  'block-important': 'packagedImportantBlock',
  allow: 'packagedAllow',
  'allow-important': 'packagedImportantAllow',
  'allow-all-requests': 'packagedAllow',
  redirect: 'packagedHighConfidenceBlock',
  removeparam: 'packagedHighConfidenceBlock',
  'modify-headers': 'packagedHighConfidenceBlock',
  'session-block': 'sessionTemporary',
  'session-allow': 'sessionTemporary',
  'user-block': 'userPersistentSafeDynamic',
  'user-allow': 'userPersistentSafeDynamic',
  'trusted-site': 'userEmergencyOverride',
};

/**
 * Default priority for core static policy levels. These values
 * intentionally leave space inside each band for future list-
 * specific tuning while preserving DNR's priority-first ordering.
 */
const DEFAULT_PRIORITY: Partial<Record<CompiledRuleKind, number>> = {
  block: 420000,
  'block-important': 560000,
  allow: 520000,
  'allow-important': 590000,
  'allow-all-requests': 520000,
  redirect: 420000,
  removeparam: 420000,
  'modify-headers': 420000,
  'trusted-site': 2_450_000,
};

const BAND_RANGES: Record<DnrPriorityBandName, readonly [number, number]> = {
  codeViewerDiagnostic: [2_500_000, 2_599_999],
  userEmergencyOverride: [2_400_000, 2_499_999],
  sessionTemporary: [2_300_001, 2_399_999],
  userPersistentSafeDynamic: [2_200_001, 2_300_000],
  userManagedReserved: [700000, 799999],
  userDisabledStaticReplacement: [600000, 699999],
  packagedImportantAllow: [580000, 599999],
  packagedImportantBlock: [550000, 579999],
  packagedAllow: [500000, 539999],
  packagedHighConfidenceBlock: [400000, 449999],
  packagedTrackerPrivacy: [300000, 399999],
  packagedAnnoyance: [200000, 299999],
  upgradeScheme: [100000, 199999],
  experimentalPackaged: [1, 99999],
};

/**
 * Return the absolute priority value for a compiled rule.
 * Throws if the resulting priority falls outside the band.
 */
export function priorityFor(input: PriorityInput): number {
    const bandName = input.band ?? DEFAULT_BAND[input.kind];
    const range = BAND_RANGES[bandName];
    if (!range) {
        throw new Error(`dnr-priority: unknown band "${bandName}"`);
    }
    const [lo, hi] = range;
    const midpoint = Math.floor((lo + hi) / 2);
    const priority = input.offset !== undefined || input.band !== undefined
        ? midpoint + (input.offset ?? 0)
        : DEFAULT_PRIORITY[input.kind] ?? midpoint;

    // Clamp to band range.
    const clamped = Math.max(lo, Math.min(hi, priority));

    const assertion = assertPriorityInBand(clamped, bandName);
    if (!assertion.ok) {
        throw new Error(`dnr-priority: ${assertion.reason}`);
    }
    return clamped;
}

/**
 * Convenience: semantic comparison — returns true if a rule with
 * `kindA` should win over `kindB` under the defined priority
 * policy.
 */
export function priorityWins(
    kindA: CompiledRuleKind,
    kindB: CompiledRuleKind,
): boolean {
    return priorityFor({ kind: kindA }) > priorityFor({ kind: kindB });
}
