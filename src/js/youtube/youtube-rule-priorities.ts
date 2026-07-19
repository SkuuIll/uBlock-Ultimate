// YouTube Rule Priority Constants — V17 Packet 4 (§14)
// Must outrank generic stealth and non-engine rules.
// Relative ordering within YouTube engine space.

export const YOUTUBE_PRIORITY = {
  CRITICAL_ALLOW: 2_000_000_000,
  SAFE_SURROGATE: 1_500_000_000,
  SAFE_BLOCK: 1_000_000_000,
  NON_ENGINE_PRIORITY_CEILING: 999_999_999,
  GENERIC_STEALTH_EXCLUSION_REPLACEMENT: 600_000_000,
  GENERIC_STEALTH_CEILING: 500_000_000,
  GENERIC_AD_TRACKER_CEILING: 549_999,
  BEACON: 200_000_000,
  OBSERVE_ONLY: 100_000_000,
  SHADOW: 50_000_000,
  EMBED_SAFE_BONUS: 10_000,
} as const

export const YOUTUBE_ADAPTIVE_RULE_BUDGET_MAX = 1000
export const YOUTUBE_STATIC_RULE_BUDGET_MAX = 5000
export const YOUTUBE_RULE_ID_MIN = 1_000_000
export const YOUTUBE_RULE_ID_MAX = 2_000_000

export type YouTubePriorityLevel = keyof typeof YOUTUBE_PRIORITY

export function getPriorityForLevel(level: YouTubePriorityLevel): number {
    return YOUTUBE_PRIORITY[level]
}

export function comparePriority(a: number, b: number): number {
    if (a > b) return 1
    if (a < b) return -1
    return 0
}

export function isYouTubeEnginePriority(priority: number): boolean {
    return priority > YOUTUBE_PRIORITY.NON_ENGINE_PRIORITY_CEILING
}
