// YouTube DNR Rule Reconciler — V17 Packet 2
// §39.5 DNR reconciliation after restart, §39.5.1 Extension update reconciliation

import { type RiskLevel } from "./youtube-risk"
import { type GlobalRulePlanMode } from "./youtube-session-state"

export interface RuleReconciliationInput {
  installedRuleIDs: number[]
  criticalRuleIDs: number[]
  optionalRuleIDs: number[]
  globalRulePlanMode: GlobalRulePlanMode
  lastAggregateRiskLevel: RiskLevel
  lastRulePlanHash: string
  expectedRulePlanHash: string
  registryVersion: string
  manifestVersion: string
  youtubeRuleIDRangeMin: number
  youtubeRuleIDRangeMax: number
  youtubeBudgetReserve: number
  userRuleInterference: Set<number | string>
}

/** Stable representation shared with the DNR plan aggregator. */
export function computeRulePlanHash(ruleIDs: readonly number[]): string {
    return [...ruleIDs].sort((a, b) => a - b).join(",")
}

export interface RuleReconciliationOutput {
  criticalRulesPresent: boolean
  staleOptionalRules: number[]
  missingCriticalRules: number[]
  userInterferenceDetected: { ruleId: number | string; rank: number }[]
  budgetRemaining: number
  planHashMatch: boolean
  requiresPanic: boolean
  requiresConservativeReset: boolean
}

export function reconcileRules(input: RuleReconciliationInput): RuleReconciliationOutput {
    const criticalRulesPresent = input.criticalRuleIDs.every(id => input.installedRuleIDs.includes(id))
    const missingCriticalRules = input.criticalRuleIDs.filter(id => !input.installedRuleIDs.includes(id))

    const staleOptionalRules = input.installedRuleIDs.filter(id => !input.criticalRuleIDs.includes(id) && !input.optionalRuleIDs.includes(id))
    const userInterferenceDetected: { ruleId: number | string; rank: number }[] = []
    for (const id of input.userRuleInterference) {
        if (typeof id === "number" && input.criticalRuleIDs.includes(id)) {
      userInterferenceDetected.push({ ruleId: id, rank: 100 })
        }
    }

    const totalRules = input.installedRuleIDs.length
    const budgetRemaining = input.youtubeBudgetReserve - totalRules

    const planHashMatch = input.lastRulePlanHash === input.expectedRulePlanHash

    const requiresPanic = !criticalRulesPresent || userInterferenceDetected.length > 0

    const requiresConservativeReset =
    input.globalRulePlanMode !== "SAFE_CONSERVATIVE" &&
    (input.lastAggregateRiskLevel === "PANIC" || input.lastAggregateRiskLevel === "HIGH" || staleOptionalRules.length > 0)

    return {
    criticalRulesPresent,
    staleOptionalRules,
    missingCriticalRules,
    userInterferenceDetected,
    budgetRemaining,
    planHashMatch,
    requiresPanic,
    requiresConservativeReset,
    }
}

// §39.5.1 Extension update reconciliation
export interface VersionVector {
  manifestVersion: string
  criticalEndpointRegistryVersion: string
  rulePrioritySchemaVersion: string
  youtubeRuleIdRangeVersion: string
  surrogateSchemaVersion: string
  sanitizerSchemaVersion: string
  bootstrapVersion: string
  wrapperRiskSchemaVersion: string
  cosmeticSelectorRegistryVersion: string
}

export function checkExtensionUpdate(current: VersionVector, persisted: Partial<VersionVector>): string[] {
    const changed: string[] = []
    const keys: (keyof VersionVector)[] = [
    "manifestVersion", "criticalEndpointRegistryVersion", "rulePrioritySchemaVersion",
    "youtubeRuleIdRangeVersion", "surrogateSchemaVersion", "sanitizerSchemaVersion",
    "bootstrapVersion", "wrapperRiskSchemaVersion", "cosmeticSelectorRegistryVersion",
    ]
    for (const key of keys) {
        if (persisted[key] !== undefined && persisted[key] !== current[key]) {
      changed.push(key)
        }
    }
    return changed
}

export const ENGINE_UPDATE_RESET = "ENGINE_UPDATE_RESET"
export const ENGINE_UPDATE_RESET_ACK = "ENGINE_UPDATE_RESET_ACK"
export const UBR_DISABLE_MAINWORLD_WRAPPERS = "UBR_DISABLE_MAINWORLD_WRAPPERS"
export const UBR_DISABLE_MAINWORLD_WRAPPERS_ACK = "UBR_DISABLE_MAINWORLD_WRAPPERS_ACK"

export interface EngineUpdateResetMessage {
  type: typeof ENGINE_UPDATE_RESET
  newVersionVector: VersionVector
  resetReason: string
  resetDeadline: number
  requiredAck: true
}

export interface EngineUpdateResetAck {
  type: typeof ENGINE_UPDATE_RESET_ACK
  versionVector: VersionVector
  activeModuleState: "passive-only" | string
}
