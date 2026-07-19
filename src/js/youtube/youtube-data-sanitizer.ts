// YouTube Browse/Search/Sidebar/Shorts Data Sanitizer — V17 Packet 5 (§17)
// Removes ad renderers from ytInitialData and API responses.
// Preserves non-ad fields, arrays remain arrays, objects remain objects.

import { type PageType } from "./youtube-types"

export const AD_RENDERER_PATTERNS = [
  "adSlotRenderer",
  "promotedContentRenderer",
  "promotedSparklesWebRenderer",
  "playerLegacyDesktopWatchAdsRenderer",
  "companionAdRenderer",
  "carouselAdRenderer",
  "searchPyvRenderer",
  "statementBannerRenderer",
] as const

export const SHELF_CONTAINING_PROMOTED_TYPES = [
  "shelfRenderer",
  "reelShelfRenderer",
  "richShelfRenderer",
] as const

export type AdRendererPattern = (typeof AD_RENDERER_PATTERNS)[number]
export type ShelfType = (typeof SHELF_CONTAINING_PROMOTED_TYPES)[number]

export interface DataSanitizerInput {
  data: unknown
  pageType: PageType
  fixtureValidated: boolean
  confidence: number
  traversalDepth: number
}

export interface DataSanitizerOutput {
  sanitized: unknown
  adRenderersRemoved: number
  shelvesChecked: number
  shelvesCleared: number
  skipReason: string | null
}

export function getAdRendererPatterns(): string[] {
    return [...AD_RENDERER_PATTERNS]
}

function isAdRenderer(obj: Record<string, unknown>): boolean {
    for (const key of Object.keys(obj)) {
        if ((AD_RENDERER_PATTERNS as readonly string[]).includes(key)) return true
    }
    return false
}

function hasPromotedContent(obj: Record<string, unknown>): boolean {
    const str = JSON.stringify(obj)
    for (const pattern of AD_RENDERER_PATTERNS) {
        if (str.includes(pattern)) return true
    }
    return false
}

function sanitizeArray(arr: unknown[], depth: number): { result: unknown[]; removed: number; shelvesChecked: number; shelvesCleared: number } {
    let removed = 0
    let shelvesChecked = 0
    let shelvesCleared = 0

    if (depth <= 0) return { result: arr, removed: 0, shelvesChecked: 0, shelvesCleared: 0 }

    const result = arr.filter((item) => {
        if (typeof item !== "object" || item === null) return true
        const obj = item as Record<string, unknown>

        for (const shelfType of SHELF_CONTAINING_PROMOTED_TYPES) {
            if (shelfType in obj) {
                shelvesChecked++
                const shelf = obj[shelfType] as Record<string, unknown> | undefined
                if (shelf && hasPromotedContent(shelf)) {
                    shelvesCleared++
                    return false
                }
            }
        }

        if (isAdRenderer(obj)) {
            removed++
            return false
        }

        for (const key of Object.keys(obj)) {
            if (Array.isArray(obj[key])) {
                const nested = sanitizeArray(obj[key] as unknown[], depth - 1)
                obj[key] = nested.result
                removed += nested.removed
                shelvesChecked += nested.shelvesChecked
                shelvesCleared += nested.shelvesCleared
            } else if (typeof obj[key] === "object" && obj[key] !== null) {
                const nestedResult = sanitizeNode(obj[key] as Record<string, unknown>, depth - 1)
                obj[key] = nestedResult.result
                removed += nestedResult.removed
                shelvesChecked += nestedResult.shelvesChecked
                shelvesCleared += nestedResult.shelvesCleared
            }
        }

        return true
    })

    return { result, removed, shelvesChecked, shelvesCleared }
}

function sanitizeNode(obj: Record<string, unknown>, depth: number): { result: Record<string, unknown>; removed: number; shelvesChecked: number; shelvesCleared: number } {
    let removed = 0
    let shelvesChecked = 0
    let shelvesCleared = 0

    if (depth <= 0) return { result: obj, removed: 0, shelvesChecked: 0, shelvesCleared: 0 }

    for (const key of Object.keys(obj)) {
        if (Array.isArray(obj[key])) {
            const nested = sanitizeArray(obj[key] as unknown[], depth - 1)
            obj[key] = nested.result
            removed += nested.removed
            shelvesChecked += nested.shelvesChecked
            shelvesCleared += nested.shelvesCleared
        } else if (typeof obj[key] === "object" && obj[key] !== null) {
            const nestedResult = sanitizeNode(obj[key] as Record<string, unknown>, depth - 1)
            obj[key] = nestedResult.result
            removed += nestedResult.removed
            shelvesChecked += nestedResult.shelvesChecked
            shelvesCleared += nestedResult.shelvesCleared
        }
    }

    return { result: obj, removed, shelvesChecked, shelvesCleared }
}

export function sanitizeData(input: DataSanitizerInput): DataSanitizerOutput {
    const output: DataSanitizerOutput = {
    sanitized: input.data,
    adRenderersRemoved: 0,
    shelvesChecked: 0,
    shelvesCleared: 0,
    skipReason: null,
    }

    if (input.confidence < 50 && !input.fixtureValidated) {
        output.skipReason = "CONFIDENCE_TOO_LOW"
        return output
    }

    if (input.traversalDepth > 5) {
        output.skipReason = "PERFORMANCE_SKIP"
        return output
    }

    const depth = Math.min(input.traversalDepth, 3)

    if (Array.isArray(input.data)) {
        const result = sanitizeArray(input.data, depth)
        output.sanitized = result.result
        output.adRenderersRemoved = result.removed
        output.shelvesChecked = result.shelvesChecked
        output.shelvesCleared = result.shelvesCleared
    } else if (typeof input.data === "object" && input.data !== null) {
        const result = sanitizeNode(input.data as Record<string, unknown>, depth)
        output.sanitized = result.result
        output.adRenderersRemoved = result.removed
        output.shelvesChecked = result.shelvesChecked
        output.shelvesCleared = result.shelvesCleared
    }

    return output
}

export function containsAdRenderer(data: unknown): boolean {
    const str = typeof data === "string" ? data : JSON.stringify(data)
    return AD_RENDERER_PATTERNS.some(p => str.includes(p))
}
