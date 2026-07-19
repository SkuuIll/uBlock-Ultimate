// YouTube Content-Script Reconnection — V17 Packet 2
// §39.9 Content-script reconnection contract, §60.5 Reconnection race handling

import { type PageContext, rebuildPageContext, type PageType } from "./youtube-page-context"
import { type RiskLevel, maxRiskLevel } from "./youtube-risk"
import { type ShadowMode } from "./youtube-shadow-mode"
import { type VersionVector } from "./youtube-rule-reconciler"

export interface YouTubeContentState {
  tabId: number
  frameId: number
  url: string
  frameContext: string
  pageType: PageType
  mainWorldAvailable: boolean | "unknown"
  shadowMode: ShadowMode
  activeWrappers: string[]
  activeSanitizerClasses: string[]
  lastHealth: string
  antiBlockPromptScore: number
  hookRaceTelemetrySummary: Record<string, unknown>
  shapeConfidenceSummary: Record<string, unknown>
}

export interface ContentScriptRegistration {
  tabId: number
  frameId: number
  documentId?: string
  frameContext: string
  urlClass: string
  contentScriptGenerationId: string
  engineVersion: string
  registryVersion: string
  mainWorldAvailable: boolean | "unknown"
  currentShadowMode: ShadowMode
  lastHealthState: string
  lastRiskLevel: RiskLevel
  lastAckedResetSequence: number
}

export interface ReconnectResponse {
  state: YouTubeContentState | null
  conservativeMode: boolean
  duplicateMergeKey: string
}

// §60.5 — Idempotent state exchange
export const REGISTER_CONTEXT = "REGISTER_CONTEXT"
export const CURRENT_ENGINE_STATE = "CURRENT_ENGINE_STATE"
export const RECONNECT_REQUEST = "RECONNECT_REQUEST"
export const YOUTUBE_ENGINE_RECONNECT = "YOUTUBE_ENGINE_RECONNECT"
export const ACK_ENGINE_STATE = "ACK_ENGINE_STATE"

export interface ReconnectMessage {
  type: typeof YOUTUBE_ENGINE_RECONNECT
  swGenerationId: string
  engineVersion: string
  registryVersion: string
  resetSequence: number
}

export function computeConservativeState(contentState: YouTubeContentState | null, swState: { riskLevel: RiskLevel; shadowMode: ShadowMode }): { riskLevel: RiskLevel; shadowMode: ShadowMode } {
    if (!contentState) {
        return { riskLevel: "HIGH", shadowMode: "PASSIVE_DOM_SHADOW" }
    }
    const riskLevel = maxRiskLevel(swState.riskLevel, contentState.lastHealth === "BROKEN" ? "PANIC" : contentState.lastHealth === "PROMPT_DETECTED" ? "HIGH" : "LOW")
    const shadowMode: ShadowMode = riskLevel === "PANIC" || riskLevel === "HIGH" ? "PASSIVE_DOM_SHADOW" : swState.shadowMode
    return { riskLevel, shadowMode }
}

export function mergeRegistration(existing: ContentScriptRegistration | undefined, incoming: ContentScriptRegistration): ContentScriptRegistration {
    if (!existing) return incoming
    return incoming.contentScriptGenerationId > existing.contentScriptGenerationId ? incoming : existing
}

// §39.9 — Reconnection contract
export function createReconnectResponse(contentState: YouTubeContentState | null, swRisk: RiskLevel): ReconnectResponse {
    if (!contentState) {
        return { state: null, conservativeMode: true, duplicateMergeKey: "" }
    }
    const conservativeState = computeConservativeState(contentState, { riskLevel: swRisk, shadowMode: "PASSIVE_DOM_SHADOW" })
    return {
    state: contentState,
    conservativeMode: conservativeState.riskLevel !== swRisk,
    duplicateMergeKey: `${contentState.tabId}:${contentState.frameId}`,
    }
}
