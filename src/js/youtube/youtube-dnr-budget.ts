// YouTube DNR Rule Budget Allocator — V17 Packet 4 (§13.1)
// Critical rules guaranteed first; optional rules evicted under pressure.
// Adaptive budget tiers with strict allocation priority.

export interface DNRBudgetState {
  criticalCount: number
  optionalCount: number
  maxCritical: number
  maxOptional: number
}

export const DEFAULT_BUDGET: DNRBudgetState = {
  criticalCount: 0,
  optionalCount: 0,
  maxCritical: 200,
  maxOptional: 800,
}

export function canInstallCritical(budget: DNRBudgetState): boolean {
    return budget.criticalCount < budget.maxCritical
}

export function canInstallOptional(budget: DNRBudgetState): boolean {
    return budget.criticalCount + budget.optionalCount < budget.maxCritical + budget.maxOptional
}

export function selectRulesForEviction(budget: DNRBudgetState, ruleClasses: string[]): string[] {
    const order = ["SHADOW", "EXPERIMENTAL", "INSTRUMENTED_SHADOW", "SURROGATE", "SAFE_BLOCK"]
    const evicted: string[] = []
    for (const cls of order) {
        if (ruleClasses.includes(cls)) {
      evicted.push(cls)
        }
    }
    return evicted
}

export interface PanicState {
  panicSessionActive: true
  panicReason: string
  panicTabIds: number[]
  globalRulePlanMode: "PANIC"
  evictedClasses: string[]
}

export function panicOnCriticalFailure(reason: string, tabIds: number[], allClasses: string[]): PanicState {
    const evicted = selectRulesForEviction({ criticalCount: 0, optionalCount: 0, maxCritical: 200, maxOptional: 800 }, allClasses)
    return {
    panicSessionActive: true,
    panicReason: reason,
    panicTabIds: tabIds,
    globalRulePlanMode: "PANIC",
    evictedClasses: evicted,
    }
}

export const ADAPTIVE_BUDGET_TIERS = {
  CRITICAL_ALLOW_RESERVE: 200,
  GENERIC_STEALTH_EXCLUSION_SOFT_LIMIT: 100,
  SURROGATE_SOFT_LIMIT: 300,
  SAFE_BLOCK_SOFT_LIMIT: 300,
  BEACON_SOFT_LIMIT: 100,
  SHADOW_SOFT_LIMIT: 100,
  EXPERIMENTAL_SOFT_LIMIT: 100,
} as const

export const ALLOCATION_PRIORITY_ORDER: AllocationTier[] = [
  "CRITICAL_ALLOW",
  "GENERIC_STEALTH_EXCLUSION",
  "SURROGATE",
  "SAFE_BLOCK",
  "BEACON",
  "SHADOW_DIAGNOSTIC",
  "EXPERIMENTAL",
]

export type AllocationTier =
  | "CRITICAL_ALLOW"
  | "GENERIC_STEALTH_EXCLUSION"
  | "SURROGATE"
  | "SAFE_BLOCK"
  | "BEACON"
  | "SHADOW_DIAGNOSTIC"
  | "EXPERIMENTAL"

export interface AllocationRequest {
  tier: AllocationTier
  id: number
  priority: number
  size: number
}

export interface AllocationResult {
  allocated: AllocationRequest[]
  rejected: AllocationRequest[]
  remainingCritical: number
  remainingOptional: number
}

export function allocateBudget(
    requests: AllocationRequest[],
    criticalBudget: number,
    optionalBudget: number,
    isLocalComplete: boolean,
): AllocationResult {
    const sorted = [...requests].sort((a, b) => {
        const ai = ALLOCATION_PRIORITY_ORDER.indexOf(a.tier)
        const bi = ALLOCATION_PRIORITY_ORDER.indexOf(b.tier)
        if (ai !== bi) return ai - bi
        return b.priority - a.priority
    })

    const allocated: AllocationRequest[] = []
    const rejected: AllocationRequest[] = []
    let remaining = criticalBudget + optionalBudget + (isLocalComplete ? 500 : 0)

    for (const req of sorted) {
        if (req.tier === "CRITICAL_ALLOW") {
            if (req.size <= criticalBudget) {
                allocated.push(req)
                criticalBudget -= req.size
                remaining -= req.size
            } else {
                rejected.push(req)
            }
        } else if (remaining >= req.size) {
      allocated.push(req)
      remaining -= req.size
        } else {
      rejected.push(req)
        }
    }

    return {
    allocated,
    rejected,
    remainingCritical: criticalBudget,
    remainingOptional: remaining - criticalBudget,
    }
}
