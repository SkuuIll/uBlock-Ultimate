// YouTube Player Response Sanitizer — V17 Packet 5 (§18)
// Removes ad metadata from ytInitialPlayerResponse and player API responses
// before YouTube consumes them. Never mutates streamingData, videoDetails,
// captions, microformat, playabilityStatus, or storyboards.

import { type PageType } from "./youtube-types"
import { type ConfidenceEvidence } from "./youtube-shape-confidence"

export const PLAYER_AD_FIELDS = [
  "adPlacements",
  "playerAds",
  "adSlots",
  "adBreakHeartbeatParams",
  "adSafetyReason",
  "adParams",
  "companionAdConfig",
  "instreamVideoAdRenderer",
  "playerLegacyDesktopWatchAdsRenderer",
] as const

export const PLAYER_PROTECTED_FIELDS = [
  "streamingData",
  "videoDetails",
  "captions",
  "microformat",
  "playabilityStatus",
  "storyboards",
  "endscreen",
  "cards",
  "annotations",
  "playlist",
] as const

export type PlayerAdField = (typeof PLAYER_AD_FIELDS)[number]
export type PlayerProtectedField = (typeof PLAYER_PROTECTED_FIELDS)[number]

export interface PlayerSanitizerInput {
  data: Record<string, unknown>
  pageType: PageType
  confidence: number
  fixtureValidated: boolean
  traversalDepth: number
}

export interface PlayerSanitizerOutput {
  sanitized: Record<string, unknown>
  adFieldsRemoved: string[]
  protectedFieldsTouched: string[]
  skipReason: string | null
}

export function getPlayerAdFieldNames(): string[] {
    return [...PLAYER_AD_FIELDS]
}

export function getPlayerProtectedFieldNames(): string[] {
    return [...PLAYER_PROTECTED_FIELDS]
}

export function sanitizePlayerResponse(input: PlayerSanitizerInput): PlayerSanitizerOutput {
    const result: PlayerSanitizerOutput = {
    sanitized: { ...input.data },
    adFieldsRemoved: [],
    protectedFieldsTouched: [],
    skipReason: null,
    }

    if (input.confidence < 50 && !input.fixtureValidated) {
        result.skipReason = "CONFIDENCE_TOO_LOW"
        return result
    }

    if (input.traversalDepth > 5) {
        result.skipReason = "PERFORMANCE_SKIP"
        return result
    }

    for (const field of PLAYER_AD_FIELDS) {
        if (field in result.sanitized) {
      result.adFieldsRemoved.push(field)
      delete result.sanitized[field]
        }
    }

    for (const field of PLAYER_PROTECTED_FIELDS) {
        const original = input.data[field]
        const after = result.sanitized[field]
        if (original !== after) {
      result.protectedFieldsTouched.push(field)
      result.sanitized[field] = original
        }
    }

    return result
}

export function isPlayerAdField(key: string): boolean {
    return (PLAYER_AD_FIELDS as readonly string[]).includes(key)
}

export function isPlayerProtectedField(key: string): boolean {
    return (PLAYER_PROTECTED_FIELDS as readonly string[]).includes(key)
}

export function sanitizePlayerResponseIdempotent(input: PlayerSanitizerInput): PlayerSanitizerOutput {
    const first = sanitizePlayerResponse(input)
    const second = sanitizePlayerResponse({ ...input, data: first.sanitized })
    return {
        ...second,
        protectedFieldsTouched: [...new Set([...first.protectedFieldsTouched, ...second.protectedFieldsTouched])],
    }
}
