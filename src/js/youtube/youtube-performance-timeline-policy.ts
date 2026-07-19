// YouTube Performance Resource Timing Policy — V17 Packet 7 (§49.1, §49.2)
// Full MONITORED_BY_DEFAULT heuristic, surrogate timing requirements.

export type TimelineVisibility = "MONITORED_BY_DEFAULT" | "LIKELY_MONITORED" | "UNLIKELY_MONITORED" | "UNKNOWN"

export interface MonitoredEndpoint {
  pattern: string
  visibility: TimelineVisibility
  riskClass: "ALLOW" | "SURROGATE_WITH_VALIDATION" | "BLOCK_ONLY_WITH_FIXTURE" | "SHADOW_OBSERVE"
}

// Registry-listed ad/beacon/bootstrap/critical resources are assumed monitored
// by default unless shadow telemetry and fixtures justify a lower risk.
export const MONITORED_ENDPOINTS: MonitoredEndpoint[] = [
  // Ad-serving endpoints — monitored by default
  { pattern: "doubleclick.net", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },
  { pattern: "googlesyndication.com", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },
  { pattern: "googleadservices.com", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },
  { pattern: "*.googlevideo.com/videoplayback", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },
  { pattern: "*.googlevideo.com/videomanifest", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },

  // YouTube critical APIs — monitored by default
  { pattern: "www.youtube.com/youtubei/v1/player", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },
  { pattern: "www.youtube.com/youtubei/v1/next", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },
  { pattern: "www.youtube.com/youtubei/v1/browse", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },
  { pattern: "www.youtube.com/youtubei/v1/search", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },
  { pattern: "www.youtube.com/youtubei/v1/reel", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },

  // Player bootstrap and assets
  { pattern: "www.youtube.com/s/player/*", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },
  { pattern: "www.youtube.com/s/desktop/*", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },
  { pattern: "www.youtube.com/player_adu*", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },

  // Beacon/measurement endpoints
  { pattern: "*/beacon", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },
  { pattern: "*/collect", visibility: "MONITORED_BY_DEFAULT", riskClass: "ALLOW" },
  { pattern: "*/ping", visibility: "LIKELY_MONITORED", riskClass: "SHADOW_OBSERVE" },

  // Domain variants — lower monitoring confidence
  { pattern: "m.youtube.com/*", visibility: "LIKELY_MONITORED", riskClass: "SHADOW_OBSERVE" },
  { pattern: "youtube-nocookie.com/*", visibility: "LIKELY_MONITORED", riskClass: "SHADOW_OBSERVE" },
  { pattern: "music.youtube.com/*", visibility: "UNLIKELY_MONITORED", riskClass: "BLOCK_ONLY_WITH_FIXTURE" },
]

export function getTimelinePolicy(endpoint: string): TimelineVisibility {
    for (const entry of MONITORED_ENDPOINTS) {
        const pattern = entry.pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*")
      .replace(/\//g, "\\/")
        if (new RegExp(pattern, "i").test(endpoint)) {
            return entry.visibility
        }
    }
    return "UNKNOWN"
}

export function getMonitoredEndpointEntry(endpoint: string): MonitoredEndpoint | null {
    for (const entry of MONITORED_ENDPOINTS) {
        const pattern = entry.pattern
      .replace(/\./g, "\\.")
      .replace(/\*/g, ".*")
      .replace(/\//g, "\\/")
        if (new RegExp(pattern, "i").test(endpoint)) {
            return entry
        }
    }
    return null
}

export function isMonitored(endpoint: string): boolean {
    const policy = getTimelinePolicy(endpoint)
    return policy === "MONITORED_BY_DEFAULT" || policy === "LIKELY_MONITORED"
}

export function downgradeToUnlikely(endpoint: string, fixtureEvidence: boolean, shadowTelemetryClean: boolean): boolean {
    if (!fixtureEvidence) return false
    if (!shadowTelemetryClean) return false
    return true
}

export function selectEndpointAction(riskClass: MonitoredEndpoint["riskClass"], shapeConfidence: number, fixtureProven: boolean): "ALLOW" | "SURROGATE" | "BLOCK" {
    if (riskClass === "BLOCK_ONLY_WITH_FIXTURE" && fixtureProven) return "BLOCK"
    if (riskClass === "SURROGATE_WITH_VALIDATION" && shapeConfidence >= 85) return "SURROGATE"
    return "ALLOW"
}
