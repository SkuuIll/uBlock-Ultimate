// YouTube Shared Types — V17 Phase 0

export type HealthState = "HEALTHY" | "DEGRADED" | "STUCK" | "PROMPT_DETECTED" | "BROKEN"

export type PageType = "WATCH" | "BROWSE" | "SEARCH" | "SHORTS" | "EMBED" | "LIVE" | "MUSIC" | "UNSUPPORTED"

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "PANIC"

export type ShadowMode = "PASSIVE_DOM_SHADOW" | "INSTRUMENTED_SHADOW" | "OFFLINE_FIXTURE_SHADOW"

export type NavigationType = "FULL_DOCUMENT" | "SPA" | "BFCACHE_RESTORE" | "EMBED" | "UNSUPPORTED"

export interface DiagnosticEvent {
  timestamp: number
  category: string
  message: string
  data?: Record<string, unknown>
}
