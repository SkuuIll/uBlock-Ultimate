// YouTube Fetch/XHR Response Guard — V17 Packet 5 (§20, §48)
// Intercepts same-origin YouTube API responses to sanitize ad content.
// Supports fetch (fresh Response construction) and XHR (header wrappers).

import { type RiskLevel, type PageType } from "./youtube-types"

export const GUARDED_ENDPOINTS = [
  "/youtubei/v1/player",
  "/youtubei/v1/next",
  "/youtubei/v1/browse",
  "/youtubei/v1/search",
  "/youtubei/v1/reel",
] as const

export type GuardedEndpoint = (typeof GUARDED_ENDPOINTS)[number]

export const YOUTUBE_API_ORIGINS = [
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com",
  "https://m.youtube.com",
] as const

export const AD_HEADERS = [
  "x-ads-event",
  "x-adset",
  "x-ad-signals",
] as const

export interface FetchGuardInput {
  url: string
  pageType: PageType
  riskLevel: RiskLevel
  confidence: number
  responseSize: number
  contentType: string
}

export interface FetchGuardOutput {
  intercepted: boolean
  skipReason: string | null
  requiresSanitizer: boolean
  requiresHeaderSanitization: boolean
}

export interface XhrHeaderInput {
  headerName: string
  headerValue: string | null
  riskLevel: RiskLevel
}

export interface XhrHeaderOutput {
  sanitizedValue: string | null
  modified: boolean
  skipReason: string | null
}

export function getGuardedEndpoints(): string[] {
    return [...GUARDED_ENDPOINTS]
}

export function getApiOrigins(): string[] {
    return [...YOUTUBE_API_ORIGINS]
}

export function getAdHeaders(): string[] {
    return [...AD_HEADERS]
}

export function classifyEndpoint(url: string): GuardedEndpoint | null {
    for (const endpoint of GUARDED_ENDPOINTS) {
        if (url.includes(endpoint)) return endpoint
    }
    return null
}

export function isGuardedUrl(url: string): boolean {
    return YOUTUBE_API_ORIGINS.some(origin => url.startsWith(origin)) && classifyEndpoint(url) !== null
}

export function evaluateFetchInterception(input: FetchGuardInput): FetchGuardOutput {
    if (!isGuardedUrl(input.url)) {
        return { intercepted: false, skipReason: "NOT_GUARDED_ENDPOINT", requiresSanitizer: false, requiresHeaderSanitization: false }
    }

    if (input.riskLevel === "PANIC") {
        return { intercepted: false, skipReason: "PANIC_RISK", requiresSanitizer: false, requiresHeaderSanitization: false }
    }

    if (input.riskLevel === "HIGH") {
        return { intercepted: true, skipReason: null, requiresSanitizer: true, requiresHeaderSanitization: false }
    }

    if (input.responseSize > 1_000_000) {
        return { intercepted: false, skipReason: "RESPONSE_TOO_LARGE", requiresSanitizer: false, requiresHeaderSanitization: false }
    }

    if (!input.contentType.includes("json") && !input.contentType.includes("javascript")) {
        return { intercepted: false, skipReason: "NOT_JSON_RESPONSE", requiresSanitizer: false, requiresHeaderSanitization: false }
    }

    const requiresSanitizer = input.confidence >= 50
    const requiresHeaderSanitization = input.confidence >= 70 && input.riskLevel === "LOW"

    return {
    intercepted: requiresSanitizer || requiresHeaderSanitization,
    skipReason: null,
    requiresSanitizer,
    requiresHeaderSanitization,
    }
}

export function sanitizeResponseHeader(input: XhrHeaderInput): XhrHeaderOutput {
    if (input.riskLevel === "PANIC") {
        return { sanitizedValue: input.headerValue, modified: false, skipReason: "PANIC_RISK" }
    }

    const headerLower = input.headerName.toLowerCase()

    if ((AD_HEADERS as readonly string[]).some(h => h.toLowerCase() === headerLower)) {
        return { sanitizedValue: null, modified: true, skipReason: null }
    }

    return { sanitizedValue: input.headerValue, modified: false, skipReason: "NOT_AD_HEADER" }
}

export function sanitizeAllResponseHeaders(
    headers: Record<string, string>,
    riskLevel: RiskLevel,
): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
        const output = sanitizeResponseHeader({ headerName: key, headerValue: value, riskLevel })
        if (output.modified && output.sanitizedValue === null) {
            continue
        }
        result[key] = output.sanitizedValue ?? value
    }
    return result
}
