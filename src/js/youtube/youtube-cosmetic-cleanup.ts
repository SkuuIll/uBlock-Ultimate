// YouTube Cosmetic Cleanup and Transient Ad UI — V17 Packet 6 (§23, §50.2, §50.3)
// Forbidden selectors, allowed selector requirements, transient ad UI handling,
// interstitial cleanup, Shorts ad handling, Shadow DOM cosmetic cleanup,
// dynamic script insertion, module script handling, document stream handling.

import { type RiskLevel } from "./youtube-risk"
import type { PageType } from "./youtube-types"

export const FORBIDDEN_SELECTORS = [
  ".style-scope",
  '[class*="ad"]',
  '[id*="ad"]',
  "ytd-masthead",
  "ytd-topbar",
  "#container",
  "#center",
  "#start",
  "#end",
  "#guide-button",
  "#logo",
] as const

export type RiskClass =
  | "SHADOW_DOM_COSMETIC_CLEANUP"
  | "LIGHT_DOM_COSMETIC_CLEANUP"
  | "FEED_COSMETIC_CLEANUP"
  | "INTERSTITIAL_CLEANUP"
  | "SHORTS_CLEANUP"
  | "DOCUMENT_WRITE_WRAPPER"
  | "DOCUMENT_STREAM_WRAPPER"
  | "DYNAMIC_SCRIPT_INSERTION_WRAPPER"

export const RISK_CLASS_PRIORITY: Record<RiskClass, number> = {
  SHADOW_DOM_COSMETIC_CLEANUP: 8,
  LIGHT_DOM_COSMETIC_CLEANUP: 7,
  FEED_COSMETIC_CLEANUP: 6,
  INTERSTITIAL_CLEANUP: 5,
  SHORTS_CLEANUP: 4,
  DOCUMENT_WRITE_WRAPPER: 3,
  DOCUMENT_STREAM_WRAPPER: 2,
  DYNAMIC_SCRIPT_INSERTION_WRAPPER: 1,
}

export const DEFAULT_RISK_CLASS_ENABLED: Record<RiskClass, boolean> = {
  SHADOW_DOM_COSMETIC_CLEANUP: false,
  LIGHT_DOM_COSMETIC_CLEANUP: false,
  FEED_COSMETIC_CLEANUP: false,
  INTERSTITIAL_CLEANUP: false,
  SHORTS_CLEANUP: false,
  DOCUMENT_WRITE_WRAPPER: false,
  DOCUMENT_STREAM_WRAPPER: false,
  DYNAMIC_SCRIPT_INSERTION_WRAPPER: false,
}

export interface AllowedSelector {
  selector: string
  pageType: PageType[]
  riskLevelAllowed: RiskLevel[]
  fixtureEvidence: boolean
  protectedAncestorCheck: string
  rollbackTag: string
}

export interface TransientUIElement {
  kind: "SKIP_BUTTON" | "COUNTDOWN_OVERLAY" | "AD_PROGRESS_MARKER" | "SPONSORED_COMPANION" | "PROMOTED_FEED_CARD" | "PLAYER_OVERLAY_AD_BADGE"
  fixtureCovered: boolean
  selector: string
}

export function isForbiddenSelector(selector: string): boolean {
    return FORBIDDEN_SELECTORS.some(f => selector === f || selector.startsWith(f))
}

export function validateSelector(sel: AllowedSelector): boolean {
    if (isForbiddenSelector(sel.selector)) return false
    if (!sel.selector) return false
    if (!sel.pageType || sel.pageType.length === 0) return false
    if (!sel.riskLevelAllowed || sel.riskLevelAllowed.length === 0) return false
    if (!sel.fixtureEvidence) return false
    if (!sel.protectedAncestorCheck) return false
    if (!sel.rollbackTag) return false
    return true
}

export function shouldCleanTransientUI(
    element: TransientUIElement,
    riskLevel: RiskLevel,
    shapeConfidence: number,
    hasPrompt: boolean,
): boolean {
    if (hasPrompt) return false
    if (!element.fixtureCovered) return false
    if (shapeConfidence < 70) return false
    if (riskLevel === "PANIC") return false
    if (riskLevel === "HIGH") return false
    return true
}

export function selectRollbackOrder(enabledClasses: RiskClass[]): RiskClass[] {
    return [...enabledClasses].sort(
        (a, b) => RISK_CLASS_PRIORITY[b] - RISK_CLASS_PRIORITY[a]
    )
}

export interface InterstitialDetectionSignals {
  fullPageModalOverlay: boolean
  navigationDelay: boolean
  knownInterstitialRenderer: boolean
  playerUnavailableDueToAd: boolean
}

export function detectInterstitial(signals: InterstitialDetectionSignals): boolean {
    const signalCount = [signals.fullPageModalOverlay, signals.navigationDelay, signals.knownInterstitialRenderer, signals.playerUnavailableDueToAd].filter(Boolean).length
    return signalCount >= 2
}

export interface ShortsCleanupConfig {
  enabled: boolean
  minConsecutiveCleanObservations: number
  consecutiveCleanObservations: number
  preserveSwipe: boolean
  preserveFeedContinuity: boolean
}

export function createShortsCleanupConfig(): ShortsCleanupConfig {
    return {
    enabled: false,
    minConsecutiveCleanObservations: 5,
    consecutiveCleanObservations: 0,
    preserveSwipe: true,
    preserveFeedContinuity: true,
    }
}

export function updateShortsCleanupConfig(
    config: ShortsCleanupConfig,
    observationClean: boolean,
): ShortsCleanupConfig {
    const consecutive = observationClean
        ? config.consecutiveCleanObservations + 1
        : 0
    return {
    ...config,
    consecutiveCleanObservations: consecutive,
    enabled: consecutive >= config.minConsecutiveCleanObservations,
    }
}

export function computeRiskClassEnabled(
    promptDetected: boolean,
    backoffActive: boolean,
    riskLevel: RiskLevel,
    shapeConfidence: number,
): Record<RiskClass, boolean> {
    if (backoffActive || riskLevel === "PANIC") {
        return Object.fromEntries(
      Object.entries(DEFAULT_RISK_CLASS_ENABLED)
        ) as Record<RiskClass, boolean>
    }

    if (promptDetected) {
        return {
      ...DEFAULT_RISK_CLASS_ENABLED,
      INTERSTITIAL_CLEANUP: true,
      SHORTS_CLEANUP: true,
        }
    }

    const enabled = { ...DEFAULT_RISK_CLASS_ENABLED }

    if (shapeConfidence >= 85 && riskLevel !== "HIGH") {
        enabled.LIGHT_DOM_COSMETIC_CLEANUP = true
        enabled.FEED_COSMETIC_CLEANUP = true
        enabled.INTERSTITIAL_CLEANUP = true
    }

    if (shapeConfidence >= 90 && riskLevel === "LOW") {
        enabled.SHADOW_DOM_COSMETIC_CLEANUP = true
        enabled.SHORTS_CLEANUP = true
    }

    return enabled
}

export function isDocumentWriteWrapperAllowed(): boolean {
    return false
}

export function isDocumentStreamWrapperAllowed(): boolean {
    return false
}

export function isDynamicScriptInsertionWrapperAllowed(): boolean {
    return false
}

export const TRANSIENT_UI_ELEMENTS: TransientUIElement[] = [
  { kind: "SKIP_BUTTON", fixtureCovered: false, selector: ".ytp-ad-skip-button" },
  { kind: "COUNTDOWN_OVERLAY", fixtureCovered: false, selector: ".ytp-ad-countdown" },
  { kind: "AD_PROGRESS_MARKER", fixtureCovered: false, selector: ".ytp-ad-progress" },
  { kind: "SPONSORED_COMPANION", fixtureCovered: false, selector: "#sponsored-companion" },
  { kind: "PROMOTED_FEED_CARD", fixtureCovered: false, selector: "ytd-promoted-video-renderer" },
  { kind: "PLAYER_OVERLAY_AD_BADGE", fixtureCovered: false, selector: ".ytp-ad-badge" },
]
