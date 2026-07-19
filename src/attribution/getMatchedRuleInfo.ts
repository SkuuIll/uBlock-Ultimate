/**
 * src/attribution/getMatchedRuleInfo.ts
 *
 * User-facing attribution (§7.1, §7.2 of the Rev15 plan).
 *
 * Joins the low-level `getMatchedRulesAttribution` primitive
 * (chrome.dnr.getMatchedRules + permission gating) with the
 * `SourceMapStore` so the popup can render
 * "Rules recently matched on this tab" with source-list,
 * source-line, and original-filter info.
 *
 * §7.2 enforcement:
 *   - only invoked in direct response to a user gesture
 *     (the caller guarantees this; the module does not poll)
 *   - no caching (fresh chrome.dnr.getMatchedRules() every call)
 *   - `sinceMs` clamped to [1000, 300000] ms (1s..5min)
 *   - result hard-capped at 100 matches (UI table size)
   *   - graceful fallback: when Chrome denies matched-rule access
   *     for the tab, returns no matches so the popup can degrade to
   *     "rule ID unknown"
 *   - never the blocking path (no caller passes through to
 *     DNR here)
 */

import {
    getMatchedRulesAttribution,
    type ChromeDnrSurface,
    type MatchedRulesInfo,
} from '../js/mv3/get-matched-rules-attribution';
import type { SourceMapStore } from './source-map-store';
import { makeDnrSourceMapKey } from '../core/evidence/source-map-schema';

export type SourceProvenance = 'static' | 'dynamic' | 'unknown';

export interface MatchedRuleInfoView {
  tabId: number;
  timeStamp: number;
  rulesetId: string;
  ruleId: number;
  sourceList: string;
  sourceLine: number | null;
  sourceTextHash: string;
  originalFilter: string;
  compiledAction: string;
  source: SourceProvenance;
}

export interface GetMatchedRuleInfoResult {
  ok: boolean;
  reason?: string;
  matches: MatchedRuleInfoView[];
}

export interface GetMatchedRuleInfoOptions {
  tabId: number;
  sinceMs?: number;
  chrome: ChromeDnrSurface;
  sourceMapStore: SourceMapStore;
  runtimeKeySet?: ReadonlySet<string>;
  now?: () => number;
}

const DEFAULT_SINCE_MS = 10_000;
const MIN_SINCE_MS = 1_000;
const MAX_SINCE_MS = 300_000;
const MAX_MATCHES = 100;

export class AttributionConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AttributionConfigError';
    }
}

export async function getMatchedRuleInfoForTab(
    opts: GetMatchedRuleInfoOptions,
): Promise<GetMatchedRuleInfoResult> {
    const { tabId, chrome, sourceMapStore, runtimeKeySet, now } = opts;
    const sinceMs = opts.sinceMs ?? DEFAULT_SINCE_MS;

    if (!Number.isInteger(tabId) || tabId < 0) {
        throw new AttributionConfigError(`Invalid tabId: ${tabId}`);
    }
    if (!Number.isFinite(sinceMs) || sinceMs < MIN_SINCE_MS || sinceMs > MAX_SINCE_MS) {
        throw new AttributionConfigError(
            `sinceMs must be in [${MIN_SINCE_MS}, ${MAX_SINCE_MS}], got ${sinceMs}`,
        );
    }

    const timeFloor = (now ?? Date.now)() - sinceMs;

    const minTimeStamp = timeFloor;
    const attr = await getMatchedRulesAttribution({ tabId, chrome, minTimeStamp });
    if (!attr.ok) {
    // The primitive already reports the reason. We keep the
    // `ok` flag here too so the popup can branch, but we DO
    // NOT return the matches — they're stale or unauthenticated.
        return { ok: false, reason: attr.reason, matches: [] };
    }

    const out: MatchedRuleInfoView[] = [];
    for (const m of attr.matches) {
        if (typeof m.ruleId !== 'number') continue;
        if (typeof m.timeStamp === 'number' && m.timeStamp < minTimeStamp) continue;
        if (out.length >= MAX_MATCHES) break;
        const entry = resolveSourceMap(sourceMapStore, runtimeKeySet, m);
        const view: MatchedRuleInfoView = {
      tabId,
      timeStamp: typeof m.timeStamp === 'number' ? m.timeStamp : timeFloor,
      rulesetId: m.rulesetId ?? entry.rulesetId,
      ruleId: m.ruleId,
      sourceList: entry.sourceList,
      sourceLine: entry.sourceLine,
      sourceTextHash: entry.sourceTextHash,
      originalFilter: entry.originalFilter,
      compiledAction: entry.compiledAction,
      source: entry.source,
        };
    out.push(view);
    }
    return { ok: true, matches: out };
}

function resolveSourceMap(
    store: SourceMapStore,
    runtimeKeySet: ReadonlySet<string> | undefined,
    m: MatchedRulesInfo,
): {
  sourceList: string;
  sourceLine: number | null;
  sourceTextHash: string;
  originalFilter: string;
  compiledAction: string;
  source: SourceProvenance;
  rulesetId: string;
  ruleId: number;
} {
    const rulesetId = m.rulesetId ?? 'unknown';
    const ruleId = m.ruleId ?? -1;
    if (ruleId <= 0) {
        return {
      sourceList: 'unknown',
      sourceLine: null,
      sourceTextHash: '',
      originalFilter: '',
      compiledAction: 'unknown',
      source: 'unknown',
      rulesetId,
      ruleId,
        };
    }
    const key = makeDnrSourceMapKey(rulesetId, ruleId);
    if (store.has(rulesetId, ruleId)) {
        const e = store.get(rulesetId, ruleId)!;
        return {
      sourceList: e.sourceList,
      sourceLine: e.sourceLine,
      sourceTextHash: e.sourceTextHash,
      originalFilter: e.originalFilter,
      compiledAction: e.compiledAction,
      source: 'static',
      rulesetId: e.rulesetId,
      ruleId: e.ruleId,
        };
    }
    if (runtimeKeySet?.has(key)) {
        return {
      sourceList: 'runtime-dynamic',
      sourceLine: null,
      sourceTextHash: '',
      originalFilter: '',
      compiledAction: 'dynamic',
      source: 'dynamic',
      rulesetId,
      ruleId,
        };
    }
    return {
    sourceList: 'unknown',
    sourceLine: null,
    sourceTextHash: '',
    originalFilter: '',
    compiledAction: 'unknown',
    source: 'unknown',
    rulesetId,
    ruleId,
    };
}

export const ATTRIBUTION_LIMITS = Object.freeze({
  DEFAULT_SINCE_MS,
  MIN_SINCE_MS,
  MAX_SINCE_MS,
  MAX_MATCHES,
});
