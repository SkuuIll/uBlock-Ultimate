// YouTube User-Rule Interference Static Simulation — V17 Packet 4 (§7)
// Simulates which user/imported rules would interfere with YouTube engine
// critical rules. Detects conflicting priorities and produces diagnostics.

import { type RuleMetadata } from "./youtube-rule-authority"
import { priorityCanOverrideYouTube } from "./youtube-rule-authority"

export interface UserRuleInterferenceInput {
  userRules: RuleMetadata[]
  importedRules: RuleMetadata[]
  engineCriticalRules: RuleMetadata[]
  engineSafeBlockRules: RuleMetadata[]
  engineSurrogateRules: RuleMetadata[]
}

export interface InterferenceRecord {
  ruleId: number
  ruleSource: string
  conflictTarget: string
  conflictPriority: number
  severity: "HIGH" | "MEDIUM" | "LOW"
  description: string
  compromisedCategory: "CRITICAL" | "SAFE_BLOCK" | "SURROGATE"
}

export interface UserRuleInterferenceOutput {
  interferences: InterferenceRecord[]
  criticalRulesCompromised: number
  safeBlockRulesCompromised: number
  surrogateRulesCompromised: number
  totalCompromised: number
  requiresPanic: boolean
  requiresConservativeReset: boolean
}

export function detectConflictingPriorities(
    rule: RuleMetadata,
    targets: RuleMetadata[],
    sourceLabel: string,
    category: "CRITICAL" | "SAFE_BLOCK" | "SURROGATE",
): InterferenceRecord[] {
    const results: InterferenceRecord[] = []
    for (const target of targets) {
        if (priorityCanOverrideYouTube(rule.priority) && rule.priority > target.priority) {
            const priorityDiff = rule.priority - target.priority
      results.push({
        ruleId: rule.id,
        ruleSource: sourceLabel,
        conflictTarget: `${target.source}|${target.authority}|${target.endpointClass}`,
        conflictPriority: target.priority,
        severity: target.authority === "CRITICAL" ? "HIGH" : "MEDIUM",
        description: `${sourceLabel} rule ${rule.id} (priority ${rule.priority}) overrides ${target.source} ${target.endpointClass} (priority ${target.priority}), diff=${priorityDiff}`,
        compromisedCategory: category,
      })
        }
    }
    return results
}

export function simulateUserRuleInterference(input: UserRuleInterferenceInput): UserRuleInterferenceOutput {
    const interferences: InterferenceRecord[] = []

    for (const rule of input.userRules) {
    interferences.push(...detectConflictingPriorities(rule, input.engineCriticalRules, "USER", "CRITICAL"))
    interferences.push(...detectConflictingPriorities(rule, input.engineSafeBlockRules, "USER", "SAFE_BLOCK"))
    interferences.push(...detectConflictingPriorities(rule, input.engineSurrogateRules, "USER", "SURROGATE"))
    }

    for (const rule of input.importedRules) {
    interferences.push(...detectConflictingPriorities(rule, input.engineCriticalRules, "IMPORTED", "CRITICAL"))
    interferences.push(...detectConflictingPriorities(rule, input.engineSafeBlockRules, "IMPORTED", "SAFE_BLOCK"))
    interferences.push(...detectConflictingPriorities(rule, input.engineSurrogateRules, "IMPORTED", "SURROGATE"))
    }

    const criticalCompromised = interferences.filter(i => i.compromisedCategory === "CRITICAL").length
    const safeBlockCompromised = interferences.filter(i => i.compromisedCategory === "SAFE_BLOCK").length
    const surrogateCompromised = interferences.filter(i => i.compromisedCategory === "SURROGATE").length
    const hasHighSeverity = interferences.some(i => i.severity === "HIGH")

    return {
    interferences,
    criticalRulesCompromised: criticalCompromised,
    safeBlockRulesCompromised: safeBlockCompromised,
    surrogateRulesCompromised: surrogateCompromised,
    totalCompromised: interferences.length,
    requiresPanic: criticalCompromised > 0,
    requiresConservativeReset: hasHighSeverity,
    }
}
