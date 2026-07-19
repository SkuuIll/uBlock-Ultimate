// YouTube Tab Tracker — V17 Packet 2
// §39.6 Tab tracking and state updates

import { type PageContext, rebuildPageContext, classifyPageType, type PageType } from "./youtube-page-context"
import { type RiskLevel } from "./youtube-risk"

export interface RegisteredEmbed {
  tabId: number
  frameId: number
  url: string
  parentOriginKnown: boolean
  pageType: PageType
  mainWorldAvailable: boolean | "unknown"
  health?: string
  firstSeenAt: number
  lastHeartbeatAt: number
}

export interface TabState {
  tabId: number
  url: string
  pageType: PageType
  riskLevel: RiskLevel
  pageContext: PageContext | null
  mainWorldAvailable: boolean | "unknown"
  lastSeenAt: number
}

export const HEARTBEAT_TIMEOUT_MS = 30_000

export function createTabTracker() {
    const tabs = new Map<number, TabState>()
    const embeds = new Map<string, RegisteredEmbed>() // key: `${tabId}:${frameId}`

    function upsertTab(tabId: number, url: string, riskLevel?: RiskLevel): TabState {
        const existing = tabs.get(tabId)
        const pageType = classifyPageType(url)
        const state: TabState = {
      tabId,
      url,
      pageType,
      riskLevel: riskLevel ?? existing?.riskLevel ?? "LOW",
      pageContext: existing?.pageContext ?? rebuildPageContext(tabId, url),
      mainWorldAvailable: existing?.mainWorldAvailable ?? "unknown",
      lastSeenAt: Date.now(),
        }
    tabs.set(tabId, state)
    return state
    }

    function removeTab(tabId: number): void {
    tabs.delete(tabId)
    for (const [key, embed] of embeds) {
        if (embed.tabId === tabId) embeds.delete(key)
    }
    }

    function getTab(tabId: number): TabState | undefined {
        return tabs.get(tabId)
    }

    function getAllTabs(): TabState[] {
        return Array.from(tabs.values())
    }

    function getYouTubeTabs(): TabState[] {
        return getAllTabs().filter(t => t.pageType !== "UNSUPPORTED")
    }

    function registerEmbed(embed: RegisteredEmbed): void {
        const key = `${embed.tabId}:${embed.frameId}`
    embeds.set(key, embed)
    }

    function unregisterEmbed(tabId: number, frameId: number): void {
    embeds.delete(`${tabId}:${frameId}`)
    }

    function getEmbeds(): RegisteredEmbed[] {
        return Array.from(embeds.values())
    }

    function getEmbedsForTab(tabId: number): RegisteredEmbed[] {
        return getEmbeds().filter(e => e.tabId === tabId)
    }

    function heartbeatEmbed(tabId: number, frameId: number): boolean {
        const key = `${tabId}:${frameId}`
        const embed = embeds.get(key)
        if (!embed) return false
        embed.lastHeartbeatAt = Date.now()
        return true
    }

    function expireStaleEmbeds(timeoutMs: number = HEARTBEAT_TIMEOUT_MS): number {
        const now = Date.now()
        let expired = 0
        for (const [key, embed] of embeds) {
            if (now - embed.lastHeartbeatAt > timeoutMs) {
        embeds.delete(key)
        expired++
            }
        }
        return expired
    }

    function heartbeatTab(tabId: number): boolean {
        const tab = tabs.get(tabId)
        if (!tab) return false
        tab.lastSeenAt = Date.now()
        return true
    }

    return {
    upsertTab, removeTab, getTab, getAllTabs, getYouTubeTabs,
    registerEmbed, unregisterEmbed, getEmbeds, getEmbedsForTab,
    heartbeatEmbed, expireStaleEmbeds, heartbeatTab,
    }
}

export type TabTracker = ReturnType<typeof createTabTracker>
