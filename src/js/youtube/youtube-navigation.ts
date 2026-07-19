// YouTube Navigation Lifecycle — V17 Packet 2
// §11 YouTube navigation lifecycle, §55.1 BFCache restoration

import { classifyPageType, type PageType, type PageContext, rebuildPageContext } from "./youtube-page-context"
import { type RiskLevel, recomputeRiskLevel } from "./youtube-risk"

export type NavigationType = "FULL_DOCUMENT" | "SPA" | "BFCACHE_RESTORE" | "EMBED" | "UNSUPPORTED"

export interface NavigationSignal {
  type: NavigationType
  url: string
  timestamp: number
  persisted?: boolean
}

export interface NavigationState {
  currentContext: PageContext | null
  previousContext: PageContext | null
  knownSPARoutes: Set<string>
  navigationCount: number
  lastNavigationType: NavigationType | null
}

const SPA_EVENT_NAMES = ["yt-navigate-start", "yt-navigate-finish", "yt-page-data-updated", "popstate", "historyPushState", "historyReplaceState"]

// §11 Navigation protocol

export function initializeNavigation(tabId: number, url: string): NavigationState {
    const ctx = rebuildPageContext(tabId, url)
    return {
    currentContext: ctx,
    previousContext: null,
    knownSPARoutes: new Set([new URL(url).pathname]),
    navigationCount: 0,
    lastNavigationType: "FULL_DOCUMENT",
    }
}

export function onFullDocumentStart(state: NavigationState, url: string): NavigationState {
    const newCtx = rebuildPageContext(state.currentContext!.tabId, url)
    return {
    ...state,
    previousContext: state.currentContext,
    currentContext: newCtx,
    navigationCount: state.navigationCount + 1,
    lastNavigationType: "FULL_DOCUMENT",
    }
}

export function onYouTubeNavigationStart(state: NavigationState, url: string): NavigationState {
    return {
    ...state,
    previousContext: state.currentContext,
    lastNavigationType: "SPA",
    }
}

export function onYouTubeNavigationFinish(state: NavigationState, url: string, health?: string): NavigationState {
    const old = state.currentContext!
    const newCtx: PageContext = {
    ...old,
    url,
    pageType: classifyPageType(url),
    riskLevel: health
        ? recomputeRiskLevel(old.riskLevel, health as any, old.sanitizerShapeConfidence, old.hasAntiBlockPrompt, classifyPageType(url), false)
        : old.riskLevel,
    }
    const routes = new Set(state.knownSPARoutes)
    try { routes.add(new URL(url).pathname) } catch (e) { console.warn('[uBR] youtube-navigation: URL parsing failed', e); }
    return {
    ...state,
    previousContext: state.currentContext,
    currentContext: newCtx,
    knownSPARoutes: routes,
    navigationCount: state.navigationCount + 1,
    lastNavigationType: "SPA",
    }
}

export function onBFCacheRestore(state: NavigationState, url: string): NavigationState {
    const ctx = state.currentContext
    const newCtx = ctx ? { ...ctx, url, pageType: classifyPageType(url) } : ctx
    return {
    ...state,
    currentContext: newCtx,
    previousContext: state.currentContext,
    lastNavigationType: "BFCACHE_RESTORE",
    navigationCount: state.navigationCount + 1,
    }
}

// §55.1 BFCache restoration protocol
export function handleBFCacheRestore(state: NavigationState, probesPass: boolean): { state: NavigationState; newRisk: RiskLevel; shadowMode: string } {
    const ctx = state.currentContext
    if (!ctx) {
        return { state, newRisk: "HIGH" as RiskLevel, shadowMode: "PASSIVE_DOM_SHADOW" }
    }
    let risk: RiskLevel = ctx.riskLevel
    let shadowMode = "PASSIVE_DOM_SHADOW"

    if (probesPass) {
        shadowMode = "INSTRUMENTED_SHADOW"
    } else {
        risk = "HIGH"
        shadowMode = "PASSIVE_DOM_SHADOW"
    }

    return {
    state: { ...state, currentContext: { ...ctx, riskLevel: risk }, lastNavigationType: "BFCACHE_RESTORE" },
    newRisk: risk,
    shadowMode,
    }
}

export function isSPAEvent(eventName: string): boolean {
    return SPA_EVENT_NAMES.includes(eventName)
}

export function shouldTreatAsFullNavigation(signal: NavigationSignal): boolean {
    if (signal.type === "FULL_DOCUMENT") return true
    if (signal.type === "BFCACHE_RESTORE") return true
    if (signal.type === "EMBED") return true
    return false
}
