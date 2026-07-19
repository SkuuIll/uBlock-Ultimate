// YouTube Embed Registration — V17 Phase 0
// Hidden-frame registration and embed-aware DNR aggregation.

export type EmbedContext = "TOP_LEVEL" | "EMBED" | "NESTED_EMBED" | "SANDBOXED"

export interface EmbedRegistration {
  tabId: number
  frameId: number
  embedContext: EmbedContext
  registeredAt: number
}

const registrations = new Map<string, EmbedRegistration>()

function key(tabId: number, frameId: number): string {
    return `${tabId}:${frameId}`
}

export function registerEmbed(tabId: number, frameId: number, context: EmbedContext): void {
  registrations.set(key(tabId, frameId), {
    tabId,
    frameId,
    embedContext: context,
    registeredAt: Date.now(),
  })
}

export function unregisterEmbed(tabId: number, frameId: number): void {
  registrations.delete(key(tabId, frameId))
}

export function getEmbedsForTab(tabId: number): EmbedRegistration[] {
    const result: EmbedRegistration[] = []
    for (const [, reg] of registrations) {
        if (reg.tabId === tabId) result.push(reg)
    }
    return result
}

export function getAllEmbeds(): EmbedRegistration[] {
    return Array.from(registrations.values())
}

export function hasTopLevelYouTube(tabId: number): boolean {
    const embeds = getEmbedsForTab(tabId)
    return embeds.some(e => e.embedContext === "TOP_LEVEL")
}

export function getConservativeEmbedPolicy(): "SAFE_CONSERVATIVE" | "EMBED_ALLOW" {
    return "SAFE_CONSERVATIVE"
}
