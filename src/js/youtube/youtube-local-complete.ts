// YouTube LOCAL_COMPLETE Mode — V17 Packet 4 (§18)
// Off-by-default, readiness-gated, shadow-guarded, fail-open mode
// that allows all YouTube engine features including active suppression.

import { type RiskLevel } from "./youtube-risk"

export interface LocalCompleteConfig {
  enabled: boolean
  readinessGated: boolean
  shadowGuardActive: boolean
  failOpenOnError: boolean
  extendedBudget: number
  allowedRiskLevels: RiskLevel[]
}

export const DEFAULT_LOCAL_COMPLETE_CONFIG: LocalCompleteConfig = {
  enabled: false,
  readinessGated: true,
  shadowGuardActive: true,
  failOpenOnError: true,
  extendedBudget: 500,
  allowedRiskLevels: ["LOW", "MEDIUM"],
}

export function isLocalCompleteAllowed(
    config: LocalCompleteConfig,
    readinessProbePassed: boolean,
    shadowGuardActive: boolean,
    currentRisk: RiskLevel,
): boolean {
    if (!config.enabled) return false
    if (config.readinessGated && !readinessProbePassed) return false
    if (config.shadowGuardActive && !shadowGuardActive) return false
    if (!config.allowedRiskLevels.includes(currentRisk)) return false
    return true
}

export function getLocalCompleteBudgetExtension(config: LocalCompleteConfig, isActive: boolean): number {
    if (!isActive) return 0
    return config.extendedBudget
}

export function handleLocalCompleteError(error: Error, config: LocalCompleteConfig): boolean {
    if (config.failOpenOnError) return false
    return true
}
