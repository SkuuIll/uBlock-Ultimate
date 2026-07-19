// YouTube Critical Endpoint Registry — V17 Phase 0
// Every endpoint the engine must not break.

export const ENDPOINT_CLASS = {
  CRITICAL_ALLOW: "CRITICAL_ALLOW",
  SAFE_SURROGATE: "SAFE_SURROGATE",
  SAFE_BLOCK: "SAFE_BLOCK",
  OBSERVE_ONLY: "OBSERVE_ONLY",
  UNKNOWN_ALLOW: "UNKNOWN_ALLOW",
} as const

export type EndpointClass = (typeof ENDPOINT_CLASS)[keyof typeof ENDPOINT_CLASS]

export interface EndpointEntry {
  pattern: string
  classification: EndpointClass
  riskLevel: "LOW" | "MEDIUM" | "HIGH"
  description: string
}

export const CRITICAL_ENDPOINTS: EndpointEntry[] = [
  // Player bootstrap scripts
  { pattern: "||www.youtube.com/s/player/*/player_ias.vflset/*", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "Core player bootstrap" },
  { pattern: "||www.youtube.com/s/desktop/*/jsbin/*", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "Desktop JS bundles" },
  { pattern: "||www.youtube.com/s/desktop/*/cssbin/*", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "Desktop CSS bundles" },
  { pattern: "||www.youtube.com/s/service-worker.js", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "YouTube SW" },

  // Core player JSON endpoints
  { pattern: "||www.youtube.com/youtubei/v1/player*", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "Player API response" },
  { pattern: "||www.youtube.com/youtubei/v1/next*", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "Watch next API" },

  // Watch and data endpoints
  { pattern: "||www.youtube.com/watch*", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "Watch page navigation" },
  { pattern: "||www.youtube.com/results*", classification: "CRITICAL_ALLOW", riskLevel: "MEDIUM", description: "Search results" },
  { pattern: "||www.youtube.com/feed/*", classification: "CRITICAL_ALLOW", riskLevel: "MEDIUM", description: "Feed navigation" },

  // Identity / account
  { pattern: "||accounts.google.com/*", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "Google identity" },

  // Playback media
  { pattern: "||*.googlevideo.com/videoplayback*", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "Video playback" },
  { pattern: "||*.googlevideo.com/videomanifest*", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "Video manifest" },

  // Live / DVR
  { pattern: "||*.googlevideo.com/*live*", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "Live streaming" },

  // Embed player
  { pattern: "||www.youtube.com/embed/*", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "Embed player" },
  { pattern: "||www.youtube-nocookie.com/embed/*", classification: "CRITICAL_ALLOW", riskLevel: "HIGH", description: "No-cookie embed" },

  // Navigation essentials
  { pattern: "||www.youtube.com/*", classification: "CRITICAL_ALLOW", riskLevel: "MEDIUM", description: "General YouTube (fallback)" },
]

export function classifyEndpoint(url: string): EndpointClass {
    for (const entry of CRITICAL_ENDPOINTS) {
        const raw = entry.pattern
        if (raw.startsWith('||')) {
            const path = raw.slice(2)
                .replace(/\./g, '\\.')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '\\?')
            const regex = new RegExp('^https?://' + path)
            if (regex.test(url)) return entry.classification
        } else {
            const escaped = raw
                .replace(/\./g, '\\.')
                .replace(/\*/g, '.*')
                .replace(/\?/g, '\\?')
            const regex = new RegExp(escaped)
            if (regex.test(url)) return entry.classification
        }
    }
    return ENDPOINT_CLASS.UNKNOWN_ALLOW
}
