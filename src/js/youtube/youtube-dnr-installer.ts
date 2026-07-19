// YouTube DNR Rule Installer — V17 Phase 0-1 bridge (§13.1, §13.2)
// Connects the DNR aggregator's rule plans to chrome.declarativeNetRequest API.
// Follows the established pattern from sw-firewall.ts (get → filter → remove → add).

import { type DnrRulePlan } from "./youtube-dnr-aggregator"
import { type PanicState, panicOnCriticalFailure } from "./youtube-dnr-budget"
import { type GlobalRulePlanMode, type YouTubeSessionStateV1 } from "./youtube-session-state"
import { handlePartialFailure, createTieredFailureState, DEFAULT_FAILURE_POLICY, type PartialFailureInput, type TieredFailureState } from "./youtube-optional-rule-failure"
import { CRITICAL_ENDPOINTS } from "./youtube-critical-endpoints"
import { YOUTUBE_PRIORITY, YOUTUBE_RULE_ID_MIN, YOUTUBE_RULE_ID_MAX } from "./youtube-rule-priorities"

export const YOUTUBE_DNR_RANGE_MIN = YOUTUBE_RULE_ID_MIN
export const YOUTUBE_DNR_RANGE_MAX = YOUTUBE_RULE_ID_MAX

export type InstallResult =
  | { kind: "SUCCESS"; addedCount: number; removedCount: number; planHash: string }
  | { kind: "PARTIAL_FAILURE"; addedCount: number; failedRuleId: number; tier: string }
  | { kind: "PANIC"; panicState: PanicState }
  | { kind: "ERROR"; message: string }

export interface InstallInput {
  plan: DnrRulePlan
  sessionState: YouTubeSessionStateV1
  tabIds: number[]
  policy?: typeof DEFAULT_FAILURE_POLICY
}

export function buildCriticalAllowRules(): chrome.declarativeNetRequest.Rule[] {
    const rules: chrome.declarativeNetRequest.Rule[] = []
    let nextId = YOUTUBE_DNR_RANGE_MIN

    for (const endpoint of CRITICAL_ENDPOINTS) {
        if (endpoint.classification !== "CRITICAL_ALLOW") continue
        if (nextId > YOUTUBE_DNR_RANGE_MIN + 200) break

        const isThirdParty = endpoint.pattern.includes("googlevideo.com") || endpoint.pattern.includes("accounts.google.com")

    rules.push({
      id: nextId++,
      priority: YOUTUBE_PRIORITY.CRITICAL_ALLOW,
      action: { type: "allow" },
      condition: {
        urlFilter: endpoint.pattern.replace(/^\|\|/, "").replace(/\|\|/, ""),
        resourceTypes: ["script", "xmlhttprequest", "other", "sub_frame"],
        ...(isThirdParty ? { domainType: "thirdParty" } : {}),
      },
    })
    }

    return rules
}

export function buildSafeBlockRules(plan: DnrRulePlan): chrome.declarativeNetRequest.Rule[] {
    return plan.safeBlockRuleIDs.map((id, i) => ({
    id,
    priority: YOUTUBE_PRIORITY.SAFE_BLOCK,
    action: { type: "block" },
    condition: {
      urlFilter: `||www.youtube.com/youtubei/v1/${id % 2 === 0 ? "player" : "next"}`,
      resourceTypes: ["xmlhttprequest"],
    },
    }))
}

export function buildSurrogateRules(plan: DnrRulePlan): chrome.declarativeNetRequest.Rule[] {
    return plan.surrogateRuleIDs.map((id) => ({
    id,
    priority: YOUTUBE_PRIORITY.SAFE_SURROGATE,
    action: { type: "allow" },
    condition: {
      urlFilter: `||*.googlevideo.com/videoplayback`,
      resourceTypes: ["media"],
      domainType: "thirdParty",
    },
    }))
}

export function buildBeaconRules(plan: DnrRulePlan): chrome.declarativeNetRequest.Rule[] {
    if (plan.beaconRuleIDs.length === 0) return [];
    return [{
        id: plan.beaconRuleIDs[0],
        priority: YOUTUBE_PRIORITY.BEACON,
        action: { type: "allow" },
        condition: {
            urlFilter: `||www.google-analytics.com/g/collect`,
            resourceTypes: ["xmlhttprequest"],
            domainType: "thirdParty",
        },
    }];
}

export function buildShadowRules(plan: DnrRulePlan): chrome.declarativeNetRequest.Rule[] {
    if (plan.shadowRuleIDs.length === 0) return [];
    return [{
        id: plan.shadowRuleIDs[0],
        priority: YOUTUBE_PRIORITY.SHADOW,
        action: { type: "allow" },
        condition: {
            urlFilter: `||www.youtube.com/youtubei/v1/browse`,
            resourceTypes: ["xmlhttprequest"],
        },
    }];
}

export async function getInstalledYouTubeRules(): Promise<chrome.declarativeNetRequest.Rule[]> {
    const existing = await chrome.declarativeNetRequest.getDynamicRules()
    return existing.filter((r) => r.id >= YOUTUBE_DNR_RANGE_MIN && r.id <= YOUTUBE_DNR_RANGE_MAX)
}

export function compileRulesFromPlan(plan: DnrRulePlan): chrome.declarativeNetRequest.Rule[] {
    const rules: chrome.declarativeNetRequest.Rule[] = []

  rules.push(...buildCriticalAllowRules())
  rules.push(...buildSafeBlockRules(plan))
  rules.push(...buildSurrogateRules(plan))
  rules.push(...buildBeaconRules(plan))
  rules.push(...buildShadowRules(plan))

  return rules
}

export async function removeAllYouTubeRules(): Promise<void> {
    const existing = await chrome.declarativeNetRequest.getDynamicRules()
    const toRemove = existing
    .map((r) => r.id)
    .filter((id) => id >= YOUTUBE_DNR_RANGE_MIN && id <= YOUTUBE_DNR_RANGE_MAX)

    if (toRemove.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: toRemove })
    }
}

export async function installCriticalRulesOnly(): Promise<InstallResult> {
    const criticalRules = buildCriticalAllowRules()
    const existing = await getInstalledYouTubeRules()
    const toRemove = existing.map((r) => r.id)

    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: toRemove,
      addRules: criticalRules,
        })
        return {
      kind: "SUCCESS",
      addedCount: criticalRules.length,
      removedCount: toRemove.length,
      planHash: criticalRules.map((r) => r.id).sort((a, b) => a - b).join(","),
        }
    } catch (e) {
        return { kind: "ERROR", message: (e as Error).message }
    }
}

export async function installRulePlan(plan: DnrRulePlan): Promise<InstallResult> {
    const existing = await getInstalledYouTubeRules()
    const existingIds = existing.map((r) => r.id)
    const newRules = compileRulesFromPlan(plan)
    const newIds = newRules.map((r) => r.id)
    const toRemove = existingIds.filter((id) => !newIds.includes(id))
    const toAdd = newRules.filter((r) => !existingIds.includes(r.id))

    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: toRemove,
      addRules: toAdd,
        })
        return {
      kind: "SUCCESS",
      addedCount: toAdd.length,
      removedCount: toRemove.length,
      planHash: plan.planHash,
        }
    } catch (e) {
        return { kind: "ERROR", message: (e as Error).message }
    }
}

export async function applyPlanWithFailureHandling(input: InstallInput): Promise<InstallResult> {
    const { plan, sessionState, tabIds, policy } = input
    const tierState = createTieredFailureState(plan.globalMode)

    let installResult: InstallResult = { kind: "SUCCESS", addedCount: 0, removedCount: 0, planHash: plan.planHash }

    if (plan.criticalAllowRuleIDs.length === 0) {
        try {
            installResult = await installCriticalRulesOnly()
        } catch (e) {
            const panic = panicOnCriticalFailure(
                `Critical install error: ${(e as Error).message}`,
                tabIds,
                ["SHADOW", "EXPERIMENTAL", "INSTRUMENTED_SHADOW", "SURROGATE", "SAFE_BLOCK"],
            )
            return { kind: "PANIC", panicState: panic }
        }
    }

    try {
        const rules = compileRulesFromPlan(plan)
        const existing = await getInstalledYouTubeRules()
        const existingIds = existing.map((r) => r.id)
        const toRemove = existingIds.filter((id) => !rules.some((r) => r.id === id))
        const toAdd = rules.filter((r) => !existingIds.includes(r.id))

        if (toRemove.length > 0 || toAdd.length > 0) {
            try {
                await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: toRemove,
          addRules: toAdd,
                })
            } catch (installError) {
                const failureInput: PartialFailureInput = {
          tierLabel: plan.globalMode,
          failedRuleId: toAdd[0]?.id ?? 0,
          currentRiskLevel: "MEDIUM",
          policy: policy ?? DEFAULT_FAILURE_POLICY,
          state: tierState,
          consecutiveTierFailures: 0,
                }
                const failureResult = handlePartialFailure(failureInput)

                if (failureResult.requiresPanic || failureResult.action === "FALLBACK_TO_SAFE_CONSERVATIVE") {
                    if (failureResult.requiresPanic) {
                        const panic = panicOnCriticalFailure(
                            `Persistent install failure in ${plan.globalMode} mode: ${(installError as Error).message}`,
                            tabIds,
                            ["SHADOW", "EXPERIMENTAL", "INSTRUMENTED_SHADOW", "SURROGATE", "SAFE_BLOCK"],
                        )
                        return { kind: "PANIC", panicState: panic }
                    }

                    const safePlan = compileRulesFromPlan({
            ...plan,
            globalMode: "SAFE_CONSERVATIVE",
                    })
                    await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: toRemove,
            addRules: safePlan,
                    })
                }

                return {
          kind: "PARTIAL_FAILURE",
          addedCount: toAdd.length - 1,
          failedRuleId: failureInput.failedRuleId,
          tier: plan.globalMode,
                }
            }
        }

        const criticalIds = rules
      .filter((r) => r.priority >= YOUTUBE_PRIORITY.CRITICAL_ALLOW)
      .map((r) => r.id)

        if (criticalIds.length > 0) {
            const installed = await getInstalledYouTubeRules()
            const installedIds = new Set(installed.map((r) => r.id))
            const missingCritical = criticalIds.filter((id) => !installedIds.has(id))

            if (missingCritical.length > 0) {
                const panic = panicOnCriticalFailure(
                    `Critical rules missing after install: ${missingCritical.join(",")}`,
                    tabIds,
                    ["SHADOW", "EXPERIMENTAL", "INSTRUMENTED_SHADOW", "SURROGATE", "SAFE_BLOCK"],
                )
                return { kind: "PANIC", panicState: panic }
            }
        }

        return {
      kind: "SUCCESS",
      addedCount: toAdd.length,
      removedCount: toRemove.length,
      planHash: plan.planHash,
        }
    } catch (e) {
        const panic = panicOnCriticalFailure(
            `Fatal install error: ${(e as Error).message}`,
            tabIds,
            ["SHADOW", "EXPERIMENTAL", "INSTRUMENTED_SHADOW", "SURROGATE", "SAFE_BLOCK"],
        )
        return { kind: "PANIC", panicState: panic }
    }
}

export async function verifyCriticalRulesInstalled(criticalRuleIds: number[]): Promise<boolean> {
    const installed = await getInstalledYouTubeRules()
    const installedIds = new Set(installed.map((r) => r.id))
    return criticalRuleIds.every((id) => installedIds.has(id))
}
