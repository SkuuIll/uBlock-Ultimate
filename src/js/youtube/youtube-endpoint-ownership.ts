// YouTube Endpoint Ownership Registry — V17 Phase 0 / Packet 7
// Maps endpoints to owning module/authority for conflict detection.
// Enhanced with performanceTimingRisk and domain variant awareness.

import { type PerformanceTimingRisk } from "./youtube-performance-timeline"

export interface EndpointOwnershipEntry {
  domain: string
  pathPattern: string
  owner: "YOUTUBE_ENGINE" | "GENERIC_STEALTH" | "THIRD_PARTY" | "UNKNOWN"
  purpose: string
  conflictRisk: "NONE" | "LOW" | "MEDIUM" | "HIGH"
  performanceTimingRisk?: PerformanceTimingRisk
  redirectChain?: boolean
  corsPreflight?: boolean
  redirectFinalUrlPatterns?: string[]
}

export const ENDPOINT_OWNERSHIP: EndpointOwnershipEntry[] = [
  // YouTube Engine — core
  { domain: "www.youtube.com", pathPattern: "/youtubei/v1/player*", owner: "YOUTUBE_ENGINE", purpose: "Player API", conflictRisk: "HIGH", performanceTimingRisk: "MONITORED_BY_DEFAULT" },
  { domain: "www.youtube.com", pathPattern: "/youtubei/v1/next*", owner: "YOUTUBE_ENGINE", purpose: "Watch next API", conflictRisk: "HIGH", performanceTimingRisk: "MONITORED_BY_DEFAULT" },
  { domain: "www.youtube.com", pathPattern: "/youtubei/v1/browse*", owner: "YOUTUBE_ENGINE", purpose: "Browse API", conflictRisk: "HIGH", performanceTimingRisk: "MONITORED_BY_DEFAULT" },
  { domain: "www.youtube.com", pathPattern: "/youtubei/v1/search*", owner: "YOUTUBE_ENGINE", purpose: "Search API", conflictRisk: "MEDIUM", performanceTimingRisk: "MONITORED_BY_DEFAULT" },
  { domain: "www.youtube.com", pathPattern: "/s/player/*", owner: "YOUTUBE_ENGINE", purpose: "Player scripts", conflictRisk: "HIGH", performanceTimingRisk: "MONITORED_BY_DEFAULT" },
  { domain: "www.youtube.com", pathPattern: "/s/desktop/*", owner: "YOUTUBE_ENGINE", purpose: "Desktop assets", conflictRisk: "HIGH", performanceTimingRisk: "MONITORED_BY_DEFAULT" },
  { domain: "*.googlevideo.com", pathPattern: "/videoplayback*", owner: "YOUTUBE_ENGINE", purpose: "Video playback", conflictRisk: "HIGH", performanceTimingRisk: "MONITORED_BY_DEFAULT" },
  { domain: "*.googlevideo.com", pathPattern: "/videomanifest*", owner: "YOUTUBE_ENGINE", purpose: "Video manifest", conflictRisk: "HIGH", performanceTimingRisk: "MONITORED_BY_DEFAULT" },
  { domain: "www.youtube.com", pathPattern: "/youtubei/v1/reel/*", owner: "YOUTUBE_ENGINE", purpose: "Shorts API", conflictRisk: "MEDIUM", performanceTimingRisk: "MONITORED_BY_DEFAULT" },
  { domain: "www.youtube.com", pathPattern: "/player_adu*", owner: "YOUTUBE_ENGINE", purpose: "Player ADU", conflictRisk: "HIGH", performanceTimingRisk: "MONITORED_BY_DEFAULT" },

  // YouTube domain variants
  { domain: "m.youtube.com", pathPattern: "*", owner: "YOUTUBE_ENGINE", purpose: "Mobile YouTube", conflictRisk: "LOW", performanceTimingRisk: "LIKELY_MONITORED" },
  { domain: "youtube-nocookie.com", pathPattern: "*", owner: "YOUTUBE_ENGINE", purpose: "No-cookie embed", conflictRisk: "LOW", performanceTimingRisk: "LIKELY_MONITORED" },
  { domain: "music.youtube.com", pathPattern: "*", owner: "YOUTUBE_ENGINE", purpose: "YouTube Music", conflictRisk: "LOW" },

  // Generic stealth — known conflict risk
  { domain: "doubleclick.net", pathPattern: "*", owner: "GENERIC_STEALTH", purpose: "Ad serving", conflictRisk: "HIGH", performanceTimingRisk: "MONITORED_BY_DEFAULT" },
  { domain: "googlesyndication.com", pathPattern: "*", owner: "GENERIC_STEALTH", purpose: "Ad serving", conflictRisk: "HIGH", performanceTimingRisk: "MONITORED_BY_DEFAULT" },
  { domain: "googleadservices.com", pathPattern: "*", owner: "GENERIC_STEALTH", purpose: "Ad serving", conflictRisk: "HIGH", performanceTimingRisk: "MONITORED_BY_DEFAULT" },
  { domain: "google-analytics.com", pathPattern: "*", owner: "GENERIC_STEALTH", purpose: "Analytics", conflictRisk: "MEDIUM" },
  { domain: "googletagmanager.com", pathPattern: "*", owner: "GENERIC_STEALTH", purpose: "Tag manager", conflictRisk: "MEDIUM" },
  { domain: "googletagservices.com", pathPattern: "*", owner: "GENERIC_STEALTH", purpose: "Ad services", conflictRisk: "HIGH" },
  { domain: "ytimg.com", pathPattern: "*", owner: "GENERIC_STEALTH", purpose: "YouTube image CDN", conflictRisk: "LOW" },

  // Unknown — default allow
  { domain: "*", pathPattern: "*", owner: "UNKNOWN", purpose: "Catch-all", conflictRisk: "NONE" },
]

export function getEndpointOwner(domain: string, path: string): EndpointOwnershipEntry {
    for (const entry of ENDPOINT_OWNERSHIP) {
        const domainPattern = entry.domain.replace(/\./g, "\\.").replace(/\*/g, ".*")
        const pathPattern = entry.pathPattern.replace(/\*/g, ".*")
        if (new RegExp(`^${domainPattern}$`).test(domain) && new RegExp(`^${pathPattern}$`).test(path)) {
            return entry
        }
    }
    return ENDPOINT_OWNERSHIP[ENDPOINT_OWNERSHIP.length - 1]
}

export function getPerformanceTimingRisk(domain: string, path: string): PerformanceTimingRisk | undefined {
    const entry = getEndpointOwner(domain, path)
    return entry.performanceTimingRisk
}

export function isEndpointMonitoredByDefault(domain: string, path: string): boolean {
    const risk = getPerformanceTimingRisk(domain, path)
    return risk === "MONITORED_BY_DEFAULT"
}

export function registerThirdPartyInitiator(domain: string): string[] {
    const known = ["doubleclick.net", "googleadservices.com", "googlesyndication.com", "googlevideo.com", "ytimg.com"]
    return known.filter(d => domain.includes(d))
}

export function getEntryWithRedirectChain(domain: string, path: string): EndpointOwnershipEntry & { redirectChain?: boolean } {
    const entry = getEndpointOwner(domain, path)
    return entry
}

export function hasRedirectChain(domain: string, path: string): boolean {
    const entry = getEndpointOwner(domain, path)
    return entry.redirectChain === true
}

export function getCorsPreflightInfo(domain: string, path: string): boolean {
    const entry = getEndpointOwner(domain, path)
    return entry.corsPreflight === true
}

export function resolveOwnerConflict(
    domain: string,
    path: string,
    genericStealthActive: boolean,
): "YOUTUBE_ENGINE" | "GENERIC_STEALTH" {
    const entry = getEndpointOwner(domain, path)
    if (entry.owner === "YOUTUBE_ENGINE") return "YOUTUBE_ENGINE"
    if (entry.owner === "GENERIC_STEALTH" && genericStealthActive) {
        return "GENERIC_STEALTH"
    }
    return "YOUTUBE_ENGINE"
}
