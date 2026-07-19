// YouTube Sanitizer Traversal, Clean Observation, and Retroactive Handling — V17 Packet 5 (§51)
// Enforces traversal-depth limits, consecutive clean observation gating,
// and retroactive sanitization for missed hooks.

import { type PageType, type HealthState } from "./youtube-types"

export const DEFAULT_MAX_DEPTH = 5
export const CONTENTS_ARRAY_MAX_DEPTH = 3
export const UNKNOWN_NESTED_MAX_DEPTH = 1

export const OBSERVATION_WINDOWS: Record<string, number> = {
  WATCH: 5000,
  BROWSE: 3000,
  SEARCH: 3000,
  SHORTS: 3000,
  EMBED: 5000,
  LIVE: 5000,
  MUSIC: 3000,
  UNSUPPORTED: 0,
}

export interface TraversalConfig {
  defaultMaxDepth: number
  contentsArrayMaxDepth: number
  unknownNestedMaxDepth: number
}

export const DEFAULT_TRAVERSAL_CONFIG: TraversalConfig = {
  defaultMaxDepth: DEFAULT_MAX_DEPTH,
  contentsArrayMaxDepth: CONTENTS_ARRAY_MAX_DEPTH,
  unknownNestedMaxDepth: UNKNOWN_NESTED_MAX_DEPTH,
}

export function getMaxDepthForPath(path: string[], config: TraversalConfig): number {
    if (path.includes("contents")) return config.contentsArrayMaxDepth
    if (path.length === 0) return config.defaultMaxDepth
    return config.defaultMaxDepth
}

export function shouldSkipTraversal(path: string[], depth: number, config: TraversalConfig): boolean {
    const maxDepth = getMaxDepthForPath(path, config)
    return depth > maxDepth
}

export interface CleanObservationInput {
  promptScore: number
  healthState: HealthState
  performanceBudgetOverrun: boolean
  sanitizerErrors: number
  pageType: PageType
  timeSinceLoad: number
  timeSinceNavigation: number
}

export interface CleanObservationOutput {
  isClean: boolean
  rejectionReasons: string[]
}

export function evaluateCleanObservation(input: CleanObservationInput): CleanObservationOutput {
    const rejectionReasons: string[] = []

    if (input.promptScore >= 50) rejectionReasons.push("PROMPT_SCORE_TOO_HIGH")
    if (input.healthState === "PROMPT_DETECTED" || input.healthState === "BROKEN") rejectionReasons.push("UNHEALTHY_STATE")
    if (input.performanceBudgetOverrun) rejectionReasons.push("PERFORMANCE_BUDGET_OVERRUN")
    if (input.sanitizerErrors > 0) rejectionReasons.push("SANITIZER_ERRORS")

    const window = OBSERVATION_WINDOWS[input.pageType] ?? 0
    if (input.timeSinceLoad < window) rejectionReasons.push("OBSERVATION_WINDOW_NOT_ELAPSED")

    return {
    isClean: rejectionReasons.length === 0,
    rejectionReasons,
    }
}

export interface RetroactiveSanitizationInput {
  missedHooks: string[]
  currentData: unknown
  sanitizerConfidence: number
  timeSincePageLoad: number
  maxRetroactiveWindow: number
}

export interface RetroactiveSanitizationOutput {
  shouldRetroact: boolean
  hooksToRetry: string[]
  skipReason: string | null
}

export function evaluateRetroactiveSanitization(input: RetroactiveSanitizationInput): RetroactiveSanitizationOutput {
    if (input.sanitizerConfidence < 50) {
        return { shouldRetroact: false, hooksToRetry: [], skipReason: "CONFIDENCE_TOO_LOW" }
    }

    if (input.timeSincePageLoad > input.maxRetroactiveWindow) {
        return { shouldRetroact: false, hooksToRetry: [], skipReason: "RETROACTIVE_WINDOW_EXPIRED" }
    }

    if (input.missedHooks.length === 0) {
        return { shouldRetroact: false, hooksToRetry: [], skipReason: "NO_MISSED_HOOKS" }
    }

    const retryableHooks = input.missedHooks.filter(hook => {
        const nonRetryable = ["fetch", "xhr", "DOMContentLoaded", "load"]
        return !nonRetryable.includes(hook)
    })

    if (retryableHooks.length === 0) {
        return { shouldRetroact: false, hooksToRetry: [], skipReason: "ALL_HOOKS_NON_RETRYABLE" }
    }

    return { shouldRetroact: true, hooksToRetry: retryableHooks, skipReason: null }
}

export function getMaxDepth(pageType: PageType): number {
    if (pageType === "SHORTS" || pageType === "EMBED") return CONTENTS_ARRAY_MAX_DEPTH
    return DEFAULT_MAX_DEPTH
}
