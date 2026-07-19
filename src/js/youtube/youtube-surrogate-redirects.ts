// YouTube Surrogate Redirect Rules Registry — V17 Packet 4 (§3)
// Surrogate redirect rules for endpoints that can be safely replaced
// with neutered scripts. All require fixture validation before activation.

import { type SurrogateEligibility } from "./youtube-surrogate-eligibility"

export interface SurrogateRedirectEntry {
  pattern: string
  surrogatePath: string
  resourceType: "script" | "image" | "xmlhttprequest" | "sub_frame"
  fixtureRequired: boolean
  description: string
}

export const SURROGATE_REDIRECT_REGISTRY: SurrogateRedirectEntry[] = [
  { pattern: "pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", surrogatePath: "/js/youtube-surrogates/adsbygoogle.js", resourceType: "script", fixtureRequired: true, description: "Adsbygoogle replacement" },
  { pattern: "pagead2.googlesyndication.com/pagead/js/r20250605/r20110914/abg*", surrogatePath: "/js/youtube-surrogates/abg.js", resourceType: "script", fixtureRequired: true, description: "Abg script replacement" },
  { pattern: "googleads.g.doubleclick.net/pagead/ads?*", surrogatePath: "", resourceType: "xmlhttprequest", fixtureRequired: true, description: "Ad request redirect (empty)" },
  { pattern: "securepubads.g.doubleclick.net/gampad/ads?*", surrogatePath: "", resourceType: "xmlhttprequest", fixtureRequired: true, description: "GPT ad request redirect (empty)" },
  { pattern: "tpc.googlesyndication.com/safeframe/*", surrogatePath: "/js/youtube-surrogates/safeframe.js", resourceType: "sub_frame", fixtureRequired: true, description: "SafeFrame replacement" },
  { pattern: "www.youtube.com/pagead/*", surrogatePath: "", resourceType: "xmlhttprequest", fixtureRequired: true, description: "YouTube pagead redirect (empty)" },
  { pattern: "www.youtube.com/api/stats/ads*", surrogatePath: "", resourceType: "xmlhttprequest", fixtureRequired: true, description: "YouTube ad stats beacon (empty)" },
  { pattern: "doubleclick.net/instream/*", surrogatePath: "", resourceType: "xmlhttprequest", fixtureRequired: true, description: "Instream ad redirect (empty)" },
]

export function getSurrogateForEndpoint(url: string): SurrogateRedirectEntry | null {
    for (const entry of SURROGATE_REDIRECT_REGISTRY) {
        const escaped = entry.pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
        const regex = new RegExp(escaped)
        if (regex.test(url)) return entry
    }
    return null
}

export function isSurrogateEligible(
    entry: SurrogateRedirectEntry,
    eligibility: SurrogateEligibility,
): boolean {
    if (!entry.fixtureRequired) return eligibility === "ELIGIBLE"
    return eligibility === "ELIGIBLE" || eligibility === "NEEDS_FIXTURE"
}

export function getSurrogatePatternsForResourceType(resourceType: SurrogateRedirectEntry["resourceType"]): string[] {
    return SURROGATE_REDIRECT_REGISTRY
    .filter(e => e.resourceType === resourceType)
    .map(e => e.pattern)
}

export function getSurrogatePaths(): string[] {
    return SURROGATE_REDIRECT_REGISTRY
    .filter(e => e.surrogatePath.length > 0)
    .map(e => e.surrogatePath)
}
