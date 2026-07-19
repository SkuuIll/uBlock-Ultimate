/**
 * src/attribution/attribution-message-handler.ts
 *
 * The thin glue between the SW message router and the pure
 * attribution/diagnostic modules. Three handlers:
 *   - `handleGetMatchedRuleInfo`  (popup click → "Why blocked?")
 *   - `handleDisableMatchedRule`  (popup click → "Disable matched rule")
 *   - `handleGetSanitizedExport`  (popup click → "Sanitized export")
 *
 * Pure handlers. The SW message-router wrapper composes the
 * `chrome.tabs.query({active:true, currentWindow:true})` call
 * to resolve the tabId, but the handlers themselves take a
 * tabId directly so they can be unit-tested without a chrome
 * surface.
 *
 * §7.2 enforcement: each handler does at most one
 * `chrome.dnr.getMatchedRules()` call per invocation and
 * never reads caches.
 */

import {
    getMatchedRuleInfoForTab,
    ATTRIBUTION_LIMITS,
    type GetMatchedRuleInfoResult,
} from './getMatchedRuleInfo';
import type { SourceMapStore } from './source-map-store';
import type { ChromeDnrSurface } from '../js/mv3/get-matched-rules-attribution';
import {
    buildSanitizedExport,
    type SanitizedExport,
    type SanitizedExportEnv,
    type SanitizedExportMatch,
    type RedactionMode,
} from '../diagnostics/sanitized-export';
import type { StaticRuleDisableManager } from '../mv3/static-rule-disable-manager';

export interface AttributionMessageDeps {
  chrome: ChromeDnrSurface;
  sourceMapStore: SourceMapStore;
  runtimeKeySet?: ReadonlySet<string>;
  staticRuleDisableManager: Pick<StaticRuleDisableManager, 'disable'>;
  env: SanitizedExportEnv;
  now?: () => number;
}

export interface DisableMatchedRuleRequest {
  rulesetId: string;
  ruleId: number;
}

export interface DisableMatchedRuleResult {
  ok: boolean;
  reason?: string;
  rulesetId: string;
  ruleId: number;
  disabledRuleIds: number[];
}

export interface GetSanitizedExportRequest {
  urls?: string[];
  redactionMode?: RedactionMode;
  userConfirmed?: boolean;
  matches?: SanitizedExportMatch[];
  now?: () => Date;
}

export async function handleGetMatchedRuleInfo(
    opts: { tabId: number; sinceMs?: number },
    deps: AttributionMessageDeps,
): Promise<GetMatchedRuleInfoResult> {
    return getMatchedRuleInfoForTab({
    tabId: opts.tabId,
    sinceMs: opts.sinceMs ?? ATTRIBUTION_LIMITS.DEFAULT_SINCE_MS,
    chrome: deps.chrome,
    sourceMapStore: deps.sourceMapStore,
    runtimeKeySet: deps.runtimeKeySet,
    now: deps.now,
    });
}

export async function handleDisableMatchedRule(
    req: DisableMatchedRuleRequest,
    deps: AttributionMessageDeps,
): Promise<DisableMatchedRuleResult> {
    if (!req || typeof req.rulesetId !== 'string' || req.rulesetId.length === 0) {
        return {
      ok: false,
      reason: 'rulesetId is empty',
      rulesetId: req?.rulesetId ?? '',
      ruleId: req?.ruleId ?? -1,
      disabledRuleIds: [],
        };
    }
    if (!Number.isInteger(req.ruleId) || req.ruleId <= 0) {
        return {
      ok: false,
      reason: 'ruleId must be a positive integer',
      rulesetId: req.rulesetId,
      ruleId: req.ruleId,
      disabledRuleIds: [],
        };
    }
    const result = await deps.staticRuleDisableManager.disable({
    rulesetId: req.rulesetId,
    ruleId: req.ruleId,
    reason: 'user-disabled-via-attribution',
    });
    if (!result.ok) {
        return {
      ok: false,
      reason: result.reason,
      rulesetId: req.rulesetId,
      ruleId: req.ruleId,
      disabledRuleIds: [],
        };
    }
    return {
    ok: true,
    rulesetId: req.rulesetId,
    ruleId: req.ruleId,
    disabledRuleIds: result.disabledRuleIds ?? [],
    };
}

export function handleGetSanitizedExport(
    req: GetSanitizedExportRequest,
    deps: AttributionMessageDeps,
): SanitizedExport {
    return buildSanitizedExport({
    env: deps.env,
    matches: req.matches ?? [],
    urls: req.urls ?? [],
    redactionMode: req.redactionMode,
    userConfirmed: req.userConfirmed,
    now: req.now,
    });
}
