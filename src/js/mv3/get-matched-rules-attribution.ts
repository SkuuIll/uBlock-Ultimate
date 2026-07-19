/**
 * src/js/mv3/get-matched-rules-attribution.ts
 *
 * Backend primitive for getting matched-rule attribution.
 *
 * Rules:
 *   - only callable from an explicit user-action path (no
 *     background polling, no telemetry)
 *   - no caching
 *   - graceful fallback if permission unavailable
 *   - returns recent tab-level matched-rule evidence, not exact
 *     per-request tracing
 *
 * The function is injected with the actual chrome API surface
 * for testability.
 */

export interface MatchedRulesInfo {
  rulesetId?: string;
  ruleId?: number;
  tabId?: number;
  timeStamp?: number;
  source?: string;
}

export interface MatchedRulesAttributionResult {
  ok: boolean;
  reason?: string;
  matches: MatchedRulesInfo[];
}

export interface ChromeDnrSurface {
  declarativeNetRequest?: {
    getMatchedRules?: (_options: { tabId: number; minTimeStamp?: number }) => Promise<{
      rulesMatchedInfo?: Array<{
        tabId?: number;
        timeStamp?: number;
        rule?: { rulesetId?: string; ruleId?: number };
      }>;
    }>;
  };
  permissions?: {
    contains?: (_perms: { permissions: string[] }) => Promise<boolean>;
  };
}

export interface AttributionOptions {
  tabId: number;
  minTimeStamp?: number;
  chrome: ChromeDnrSurface;
}

export async function getMatchedRulesAttribution(
    opts: AttributionOptions,
): Promise<MatchedRulesAttributionResult> {
    const { tabId, chrome } = opts;
    if (!Number.isInteger(tabId) || tabId < 0) {
        return { ok: false, reason: 'Invalid tabId.', matches: [] };
    }
    if (!chrome || !chrome.declarativeNetRequest || typeof chrome.declarativeNetRequest.getMatchedRules !== 'function') {
        return { ok: false, reason: 'DNR API not available.', matches: [] };
    }
    let response: Awaited<ReturnType<NonNullable<NonNullable<ChromeDnrSurface['declarativeNetRequest']>['getMatchedRules']>>>;
    try {
        response = await chrome.declarativeNetRequest.getMatchedRules({
      tabId,
      ...(typeof opts.minTimeStamp === 'number' ? { minTimeStamp: opts.minTimeStamp } : {}),
        });
    } catch (err) {
        return { ok: false, reason: `getMatchedRules unavailable for this tab: ${(err as Error).message}`, matches: [] };
    }

    const out: MatchedRulesInfo[] = [];
    const info = response && Array.isArray(response.rulesMatchedInfo) ? response.rulesMatchedInfo : [];
    for (const entry of info) {
        if (entry && entry.rule && typeof entry.rule.ruleId === 'number') {
      out.push({
        rulesetId: entry.rule.rulesetId,
        ruleId: entry.rule.ruleId,
        tabId: entry.tabId,
        timeStamp: entry.timeStamp,
        source: 'tab',
      });
        }
    }
    return { ok: true, matches: out };
}
