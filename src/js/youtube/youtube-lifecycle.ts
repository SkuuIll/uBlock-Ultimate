// YouTube Navigation Lifecycle Skeleton — V17 Phase 0
// Full-load, SPA, back/forward, embed, and unsupported contexts.

export type NavigationType =
  | "FULL_DOCUMENT"
  | "SPA"
  | "BFCACHE_RESTORE"
  | "EMBED"
  | "UNSUPPORTED"

export interface PageContext {
  tabId: number
  frameId: number
  url: string
  pageType: string
  riskLevel: string
  navigationType: NavigationType
  mainWorldAvailable: boolean
  shadowMode: string
  shapeConfidence: number
  promptDetected: boolean
}

export function createInitialPageContext(tabId: number, url: string): PageContext {
    return {
    tabId,
    frameId: 0,
    url,
    pageType: classifyPageType(url),
    riskLevel: "LOW",
    navigationType: "FULL_DOCUMENT",
    mainWorldAvailable: false,
    shadowMode: "PASSIVE_DOM_SHADOW",
    shapeConfidence: 0,
    promptDetected: false,
    }
}

export function classifyPageType(url: string): string {
    if (!url) return "UNSUPPORTED"
    try {
        const u = new URL(url)
        const host = u.hostname.replace(/^www\./, "")
        if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtube-nocookie.com") {
            return "UNSUPPORTED"
        }
        const path = u.pathname
        if (path.startsWith("/embed/")) return "EMBED"
        if (path.startsWith("/watch")) return "WATCH"
        if (path.startsWith("/shorts/")) return "SHORTS"
        if (path.startsWith("/results")) return "SEARCH"
        if (path.startsWith("/feed/")) return "BROWSE"
        if (path.startsWith("/channel/")) return "BROWSE"
        if (path.startsWith("/live")) return "LIVE"
        if (path.startsWith("/music")) return "MUSIC"
        return "BROWSE"
    } catch {
        return "UNSUPPORTED"
    }
}

export function createLifecycle(): { getContext: () => PageContext | null; updateNavigation: (url: string, type: NavigationType) => void } {
    let context: PageContext | null = null
    return {
    getContext: () => context,
    updateNavigation: (url, type) => {
        if (context) {
            context.url = url
            context.pageType = classifyPageType(url)
            context.navigationType = type
        } else {
            context = createInitialPageContext(0, url)
            context.navigationType = type
        }
    },
    }
}
