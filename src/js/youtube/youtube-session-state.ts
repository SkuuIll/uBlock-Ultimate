// YouTube Session State Persistence — V17 Packet 2
// §39.2-39.3 Session-persisted state schema, write policy, §52 storage quota

import { type RiskLevel } from "./youtube-risk"

export type GlobalRulePlanMode = "SAFE_CONSERVATIVE" | "EMBED_CONSERVATIVE" | "BALANCED" | "BACKOFF" | "PANIC"

export const SESSION_STATE_KEY = "ubrYouTubeSessionStateV1"
export const SCHEMA_VERSION = 1
export const TAB_SNAPSHOT_MAX = 30
export const INTERFERENCE_RECORDS_MAX = 100
export const FALLBACK_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours default
export const MAX_FALLBACK_TTL_MS = 24 * 60 * 60 * 1000 // max 24 hours

export interface UserRuleInterference {
  ruleId: number | string
  source: "user" | "imported" | "generic" | "unknown"
  affectedEndpointClass: string
  actionTaken: "capped" | "disabled_for_youtube" | "manual_review_required"
}

export interface TabSnapshot {
  tabId: number
  url: string
  pageType: string
  riskLevel: RiskLevel
  mode: string
  mainWorldAvailable: boolean | "unknown"
  lastSeenAt: number
}

export interface YouTubeSessionStateV1 {
  schemaVersion: number
  sessionEpoch: string
  updatedAt: number
  globalRulePlanMode: GlobalRulePlanMode
  lastAggregateRiskLevel: RiskLevel
  suspectModuleClasses: string[]
  disabledSurrogateEndpoints: string[]
  disabledSanitizerClasses: string[]
  disabledWrapperClasses: string[]
  disabledBeaconModes: string[]
  installedYouTubeRuleIDs: number[]
  criticalRuleInstallVerified: boolean
  lastRulePlanHash: string
  panicSessionActive: boolean
  panicReason?: string
  panicTabIds: number[]
  userRuleInterference: UserRuleInterference[]
  tabSnapshots: TabSnapshot[]
}

export function createEmptySessionState(sessionEpoch: string): YouTubeSessionStateV1 {
    return {
    schemaVersion: SCHEMA_VERSION,
    sessionEpoch,
    updatedAt: Date.now(),
    globalRulePlanMode: "SAFE_CONSERVATIVE",
    lastAggregateRiskLevel: "LOW",
    suspectModuleClasses: [],
    disabledSurrogateEndpoints: [],
    disabledSanitizerClasses: [],
    disabledWrapperClasses: [],
    disabledBeaconModes: [],
    installedYouTubeRuleIDs: [],
    criticalRuleInstallVerified: false,
    lastRulePlanHash: "",
    panicSessionActive: false,
    panicTabIds: [],
    userRuleInterference: [],
    tabSnapshots: [],
    }
}

export function validateSessionState(raw: unknown): raw is YouTubeSessionStateV1 {
    if (!raw || typeof raw !== "object") return false
    const s = raw as Record<string, unknown>
    return (
        s.schemaVersion === SCHEMA_VERSION &&
    typeof s.sessionEpoch === "string" &&
    typeof s.updatedAt === "number" &&
    typeof s.globalRulePlanMode === "string" &&
    typeof s.lastAggregateRiskLevel === "string" &&
    Array.isArray(s.installedYouTubeRuleIDs) &&
    Array.isArray(s.tabSnapshots) &&
    typeof s.panicSessionActive === "boolean" &&
    Array.isArray(s.panicTabIds) &&
    Array.isArray(s.userRuleInterference) &&
    typeof s.criticalRuleInstallVerified === "boolean"
    )
}

export function shouldWriteImmediately(state: YouTubeSessionStateV1, change: Partial<YouTubeSessionStateV1>): boolean {
    if (change.panicSessionActive === true) return true
    if (change.globalRulePlanMode === "PANIC") return true
    if (change.criticalRuleInstallVerified === false && state.criticalRuleInstallVerified === true) return true
    return false
}

// §52 — Quota management
export function pruneTabSnapshots(snapshots: TabSnapshot[], max: number = TAB_SNAPSHOT_MAX): TabSnapshot[] {
    if (snapshots.length <= max) return snapshots
    const sorted = [...snapshots].sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    return sorted.slice(0, max)
}

export function pruneInterferenceRecords(records: UserRuleInterference[], max: number = INTERFERENCE_RECORDS_MAX): UserRuleInterference[] {
    if (records.length <= max) return records
    return records.slice(-max)
}

export function evictCriticalOnly(state: YouTubeSessionStateV1): YouTubeSessionStateV1 {
    return {
    ...state,
    tabSnapshots: state.tabSnapshots.slice(0, 5),
    userRuleInterference: state.userRuleInterference.slice(-20),
    updatedAt: Date.now(),
    }
}

// §39.8 Session bans and expiry
export interface SessionBan {
  moduleClass: string
  reason: string
  sessionEpoch: string
  createdAt: number
  expiresAt: number
}

export function createSessionBan(moduleClass: string, reason: string, sessionEpoch: string, ttlMs: number = FALLBACK_TTL_MS): SessionBan {
    return { moduleClass, reason, sessionEpoch, createdAt: Date.now(), expiresAt: Date.now() + ttlMs }
}

export function isBanExpired(ban: SessionBan, currentEpoch: string): boolean {
    if (ban.sessionEpoch !== currentEpoch) return true
    if (Date.now() > ban.expiresAt) return true
    return false
}

// §60.8 Session epoch and local-storage fallback
export interface FallbackRecord {
  sessionEpoch: string
  createdAt: number
  lastSeenAt: number
  engineVersion: string
  registryVersion: string
  browserSessionMarker: string
  stateKind: "SESSION_FALLBACK_ONLY"
}

export function createFallbackRecord(sessionEpoch: string, engineVersion: string, registryVersion: string, browserSessionMarker: string): FallbackRecord {
    return { sessionEpoch, createdAt: Date.now(), lastSeenAt: Date.now(), engineVersion, registryVersion, browserSessionMarker, stateKind: "SESSION_FALLBACK_ONLY" }
}

export function isFallbackExpired(record: FallbackRecord, ttlMs: number = FALLBACK_TTL_MS): boolean {
    return Date.now() > record.lastSeenAt + ttlMs
}
