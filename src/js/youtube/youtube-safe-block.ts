// YouTube Safe-Block Rules Registry — V17 Packet 4 (§13.1)
// High-confidence endpoints where blocking is safe with fixture evidence.
// All safe-block rules require fixture validation before activation.

import { type EndpointClass } from "./youtube-critical-endpoints"

export interface SafeBlockEntry {
  pattern: string
  reason: string
  fixtureRequired: boolean
  priorityOverride?: number
}

export const SAFE_BLOCK_ENDPOINTS: SafeBlockEntry[] = [
  { pattern: "doubleclick.net/instream/*", reason: "Video overlay ad", fixtureRequired: true },
  { pattern: "googleads.g.doubleclick.net/pagead/ads*", reason: "Page-level ad serving", fixtureRequired: true },
  { pattern: "securepubads.g.doubleclick.net/gampad/ads*", reason: "GPT ad serving", fixtureRequired: true },
  { pattern: "tpc.googlesyndication.com/safeframe/*", reason: "SafeFrame container", fixtureRequired: true },
  { pattern: "pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", reason: "Adsbygoogle script", fixtureRequired: true },
  { pattern: "pagead2.googlesyndication.com/getconfig/sodar*", reason: "Sodar config", fixtureRequired: true },
  { pattern: "www.youtube.com/pagead/*", reason: "YouTube page-level ad", fixtureRequired: true },
  { pattern: "www.youtube.com/api/stats/ads*", reason: "YouTube ad stats beacon", fixtureRequired: true },
  { pattern: "www.youtube.com/youtubei/v1/ads*", reason: "YouTube Ads API", fixtureRequired: true },
  { pattern: "www.youtube.com/youtubei/v1/ad_break*", reason: "Ad break API", fixtureRequired: true },
  { pattern: "www.youtube.com/pagead/ads*", reason: "YouTube pagead ads", fixtureRequired: true },
]

const FIXTURE_PATTERNS = SAFE_BLOCK_ENDPOINTS
  .filter(e => e.fixtureRequired)
  .map(e => e.pattern)

export function getFixtureSafeBlockPatterns(): string[] {
    return [...FIXTURE_PATTERNS]
}

export function classifySafeBlockEndpoint(url: string): SafeBlockEntry | null {
    for (const entry of SAFE_BLOCK_ENDPOINTS) {
        const escaped = entry.pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
        const regex = new RegExp(escaped)
        if (regex.test(url)) return entry
    }
    return null
}

export function isSafeBlockEndpoint(url: string): boolean {
    return classifySafeBlockEndpoint(url) !== null
}

export function hasFixturesForSafeBlock(
    entry: SafeBlockEntry,
    availableFixtures: string[],
): boolean {
    if (!entry.fixtureRequired) return true
    const fixtureName = entry.pattern
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    return availableFixtures.some(f => f.includes(fixtureName) || f.includes(entry.reason.replace(/\s+/g, "_")))
}
