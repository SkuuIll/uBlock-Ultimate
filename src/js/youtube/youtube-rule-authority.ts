// YouTube Rule-Authority Compiler — V17 Packet 4 (§14)
// Every YouTube-touching rule must have source, authority, risk, priority,
// and conflict disposition. Includes generic-stealth exclusion capping,
// user/imported rule priority capping, and third-party initiator ownership.

export const RULE_SOURCE = {
  YOUTUBE_ENGINE: "YOUTUBE_ENGINE",
  GENERIC_STEALTH: "GENERIC_STEALTH",
  GENERIC_STEALTH_EXCLUSION: "GENERIC_STEALTH_EXCLUSION",
  STATIC_LIST: "STATIC_LIST",
  USER_FILTER: "USER_FILTER",
  IMPORTED_LIST: "IMPORTED_LIST",
  UNKNOWN: "UNKNOWN",
} as const

export type RuleSource = (typeof RULE_SOURCE)[keyof typeof RULE_SOURCE]

export const RULE_AUTHORITY = {
  CRITICAL: "CRITICAL",
  ENGINE_POLICY: "ENGINE_POLICY",
  SAFE_FALLBACK: "SAFE_FALLBACK",
  GENERIC_STEALTH_EXCLUSION: "GENERIC_STEALTH_EXCLUSION",
  NON_ENGINE: "NON_ENGINE",
  UNKNOWN: "UNKNOWN",
} as const

export type RuleAuthority = (typeof RULE_AUTHORITY)[keyof typeof RULE_AUTHORITY]

export interface RuleMetadata {
  id: number
  source: RuleSource
  authority: RuleAuthority
  priority: number
  endpointClass: string
  riskLevel: "LOW" | "MEDIUM" | "HIGH"
  conflictDisposition?: string
  ruleOrigin?: string
}

export function getRuleAuthority(source: RuleSource, endpointClass: string): RuleAuthority {
    if (source === RULE_SOURCE.YOUTUBE_ENGINE) {
        return RULE_AUTHORITY.CRITICAL
    }
    if (source === RULE_SOURCE.GENERIC_STEALTH_EXCLUSION) {
        return RULE_AUTHORITY.GENERIC_STEALTH_EXCLUSION
    }
    if (source === RULE_SOURCE.GENERIC_STEALTH) {
        return RULE_AUTHORITY.NON_ENGINE
    }
    if (source === RULE_SOURCE.USER_FILTER || source === RULE_SOURCE.IMPORTED_LIST) {
        return RULE_AUTHORITY.NON_ENGINE
    }
    return RULE_AUTHORITY.UNKNOWN
}

export const NON_ENGINE_PRIORITY_CEILING = 999_999_999

export function priorityCanOverrideYouTube(priority: number): boolean {
    return priority > NON_ENGINE_PRIORITY_CEILING
}

export function isEngineCriticalAuthority(authority: RuleAuthority): boolean {
    return authority === RULE_AUTHORITY.CRITICAL
}

// User/imported rules with priority above the ceiling are capped to prevent
// override of YouTube engine critical allow rules.
export function capUserOrImportedRulePriority(
    source: RuleSource,
    priority: number,
): number {
    if (
        (source === RULE_SOURCE.USER_FILTER || source === RULE_SOURCE.IMPORTED_LIST) &&
    priority > NON_ENGINE_PRIORITY_CEILING
    ) {
        return NON_ENGINE_PRIORITY_CEILING
    }
    return priority
}

export function categorizeRuleBySourceAndPriority(
    source: RuleSource,
    priority: number,
): RuleAuthority {
    if (source === RULE_SOURCE.YOUTUBE_ENGINE) return RULE_AUTHORITY.CRITICAL
    if (source === RULE_SOURCE.GENERIC_STEALTH_EXCLUSION) return RULE_AUTHORITY.GENERIC_STEALTH_EXCLUSION
    if (priority > NON_ENGINE_PRIORITY_CEILING) return RULE_AUTHORITY.ENGINE_POLICY
    return RULE_AUTHORITY.NON_ENGINE
}
