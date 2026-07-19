// YouTube Page Context — V17 Packet 2
// §9 Frame-context model, §10 PageContext and page types

import type { HealthState, RiskLevel } from "./youtube-risk"

export type PageType = "WATCH" | "BROWSE" | "SEARCH" | "SHORTS" | "EMBED" | "LIVE" | "MUSIC" | "UNSUPPORTED"

export type PageTypeCategory =
  | "TOP_LEVEL_WATCH"
  | "TOP_LEVEL_BROWSE"
  | "TOP_LEVEL_SEARCH"
  | "SHORTS"
  | "EMBED"
  | "NESTED_EMBED"
  | "LIVE"
  | "MUSIC"
  | "UNSUPPORTED"

export function isYouTubeHost(url: string): boolean {
    try {
        const h = new URL(url).hostname.replace(/^www\./, "")
        return h === "youtube.com" || h === "m.youtube.com" || h === "youtube-nocookie.com" || h === "music.youtube.com"
    } catch (e) {
    console.warn('[uBR] youtube-page-context: isYouTubeHost URL parse failed', url, e)
    return false
    }
}

export function classifyPageType(url: string): PageType {
    if (!url) return "UNSUPPORTED"
    try {
        const u = new URL(url)
        const host = u.hostname.replace(/^www\./, "")
        if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtube-nocookie.com" && host !== "music.youtube.com") {
            return "UNSUPPORTED"
        }
        if (host === "music.youtube.com") return "MUSIC"
        const p = u.pathname
        if (p.startsWith("/embed/")) return "EMBED"
        if (p.startsWith("/watch")) return "WATCH"
        if (p.startsWith("/shorts/")) return "SHORTS"
        if (p.startsWith("/results")) return "SEARCH"
        if (p.startsWith("/feed/") || p.startsWith("/channel/") || p.startsWith("/@")) return "BROWSE"
        if (p.startsWith("/live")) return "LIVE"
        if (p.startsWith("/music")) return "MUSIC"
        return "BROWSE"
    } catch (e) {
    console.warn('[uBR] youtube-page-context: classifyPageType URL parse failed', url, e)
    return "UNSUPPORTED"
    }
}

export function classifyPageTypeCategory(pageType: PageType, isTopFrame: boolean, parentOriginKnown: boolean): PageTypeCategory {
    if (!isTopFrame) return parentOriginKnown ? "NESTED_EMBED" : "EMBED"
    switch (pageType) {
    case "WATCH": return "TOP_LEVEL_WATCH"
    case "BROWSE": return "TOP_LEVEL_BROWSE"
    case "SEARCH": return "TOP_LEVEL_SEARCH"
    case "SHORTS": return "SHORTS"
    case "EMBED": return "EMBED"
    case "LIVE": return "LIVE"
    case "MUSIC": return "MUSIC"
    default: return "UNSUPPORTED"
    }
}

export interface FrameContext {
  tabId: number
  frameId: number
  url: string
  host: string
  pageType: PageType
  pageTypeCategory: PageTypeCategory
  isTopFrame: boolean
  isYouTubeTopFrame: boolean
  isYouTubeEmbed: boolean
  parentOriginKnown: boolean
  allowedModules: string[]
}

export interface PageContext {
  tabId: number
  frameId: number
  url: string
  host: string
  pageType: PageType
  pageTypeCategory: PageTypeCategory
  frameContext: FrameContext
  hasPlayer: boolean
  hasFeed: boolean
  hasSearchResults: boolean
  hasShortsShell: boolean
  hasLiveStream: boolean
  hasDvrWindow: boolean
  hasAntiBlockPrompt: boolean
  playerHealth: HealthState
  sanitizerShapeConfidence: number
  riskLevel: RiskLevel
}

export function createFrameContext(tabId: number, frameId: number, url: string, isTopFrame: boolean, parentOriginKnown: boolean): FrameContext {
    const pageType = classifyPageType(url)
    const host = isYouTubeHost(url) ? new URL(url).hostname : ""
    return {
    tabId, frameId, url, host, pageType,
    pageTypeCategory: classifyPageTypeCategory(pageType, isTopFrame, parentOriginKnown),
    isTopFrame, isYouTubeTopFrame: isTopFrame && isYouTubeHost(url),
    isYouTubeEmbed: !isTopFrame && isYouTubeHost(url),
    parentOriginKnown, allowedModules: [],
    }
}

export function rebuildPageContext(tabId: number, url: string, frameContext?: FrameContext): PageContext {
    const fc = frameContext ?? createFrameContext(tabId, 0, url, true, false)
    return {
    tabId, frameId: fc.frameId, url, host: fc.host,
    pageType: fc.pageType, pageTypeCategory: fc.pageTypeCategory,
    frameContext: fc,
    hasPlayer: fc.pageType === "WATCH" || fc.pageType === "EMBED" || fc.pageType === "LIVE",
    hasFeed: fc.pageType === "BROWSE",
    hasSearchResults: fc.pageType === "SEARCH",
    hasShortsShell: fc.pageType === "SHORTS",
    hasLiveStream: fc.pageType === "LIVE",
    hasDvrWindow: false,
    hasAntiBlockPrompt: false,
    playerHealth: "HEALTHY",
    sanitizerShapeConfidence: 0,
    riskLevel: "LOW",
    }
}
