// YouTube Optional Rule Partial-Failure Policy — V17 Packet 4 (§13)
// Defines behavior when optional DNR rules fail to install.
// Does not panic; degrades gracefully by tier.

import { type RiskLevel } from "./youtube-risk"

export type PartialFailureAction =
  | "RETRY_ONE"
  | "SKIP_TIER"
  | "HALT_TIERED_INSTALL"
  | "FALLBACK_TO_SAFE_CONSERVATIVE"

export interface OptionalRuleFailurePolicy {
  maxRetriesPerRule: number
  maxTierFailuresBeforeHalt: number
  retryDelayMs: number
  fallbackOnPersistentFailure: boolean
}

export const DEFAULT_FAILURE_POLICY: OptionalRuleFailurePolicy = {
  maxRetriesPerRule: 2,
  maxTierFailuresBeforeHalt: 3,
  retryDelayMs: 100,
  fallbackOnPersistentFailure: true,
}

export interface TieredFailureState {
  tierLabel: string
  failures: number
  lastFailureRuleId: number | null
  lastFailureTime: number
  actionTaken: PartialFailureAction | null
}

export function createTieredFailureState(tierLabel: string): TieredFailureState {
    return {
    tierLabel,
    failures: 0,
    lastFailureRuleId: null,
    lastFailureTime: 0,
    actionTaken: null,
    }
}

export interface PartialFailureInput {
  tierLabel: string
  failedRuleId: number
  currentRiskLevel: RiskLevel
  policy: OptionalRuleFailurePolicy
  state: TieredFailureState
  consecutiveTierFailures: number
}

export interface PartialFailureOutput {
  action: PartialFailureAction
  updatedState: TieredFailureState
  requiresPanic: boolean
}

export function handlePartialFailure(input: PartialFailureInput): PartialFailureOutput {
    const updatedState = { ...input.state }
    updatedState.failures += 1
    updatedState.lastFailureRuleId = input.failedRuleId
    updatedState.lastFailureTime = Date.now()

    let action: PartialFailureAction
    let requiresPanic = false

    if (input.currentRiskLevel === "PANIC" || input.currentRiskLevel === "HIGH") {
        action = "FALLBACK_TO_SAFE_CONSERVATIVE"
        requiresPanic = input.currentRiskLevel === "PANIC"
    } else if (updatedState.failures > input.policy.maxRetriesPerRule) {
        action = "SKIP_TIER"
    } else if (input.consecutiveTierFailures >= input.policy.maxTierFailuresBeforeHalt) {
        action = "HALT_TIERED_INSTALL"
        if (input.policy.fallbackOnPersistentFailure) {
            action = "FALLBACK_TO_SAFE_CONSERVATIVE"
        }
    } else {
        action = "RETRY_ONE"
    }

    updatedState.actionTaken = action

    return { action, updatedState, requiresPanic }
}
