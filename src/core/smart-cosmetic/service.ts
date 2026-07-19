import { smartEngine } from './engine'
import type { ApplyResult } from './engine'

export type EventType = 'tab-update' | 'tab-remove' | 'style-apply' | 'style-clear' | 'engine-stats'

export interface SmartCosmeticEvent {
  type: EventType
  tabId?: number
  url?: string
  payload?: any
}

type EventHandler = (_event: SmartCosmeticEvent) => void

export class Service {
    private handlers: Map<EventType, Set<EventHandler>> = new Map()
    private currentTabId: number = 0
    private applyResults: Map<number, ApplyResult> = new Map()
    private broadcastChannel: BroadcastChannel | null = null

    async init(): Promise<void> {
        await smartEngine.init()
    this.setupTabListeners()
    this.broadcastChannel = new BroadcastChannel('ubr-smart-cosmetic')
    }

    private setupTabListeners(): void {
        if (typeof chrome === 'undefined' || !chrome.tabs?.onUpdated) return

    chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
        if (changeInfo.status === 'loading' && tab.url) {
        this.handleTabUpdate(tabId, tab.url)
        }
    })

    chrome.tabs.onRemoved.addListener((tabId: number) => {
      this.handleTabRemove(tabId)
    })

    chrome.tabs.onActivated.addListener((activeInfo: chrome.tabs.TabActiveInfo) => {
        this.currentTabId = activeInfo.tabId
      this.emit('tab-update', { tabId: activeInfo.tabId })
    })
    }

    handleTabUpdate(tabId: number, url: string): void {
        const result = smartEngine.applyRulesToTab(tabId, url)
    this.applyResults.set(tabId, result)

    this.emit('style-apply', { tabId, url, selectors: result.selectors })
    this.emit('tab-update', { tabId, url })

    smartEngine.triggerUpdate(url)
    }

    handleTabRemove(tabId: number): void {
    smartEngine.removeTab(tabId)
    this.applyResults.delete(tabId)
    this.emit('tab-remove', { tabId })
    this.emit('style-clear', { tabId })
    }

    getSelectors(tabId?: number): string[] {
        const id = tabId ?? this.currentTabId
        return smartEngine.getTabSelectors(id)
    }

    getApplyResult(tabId?: number): ApplyResult | undefined {
        const id = tabId ?? this.currentTabId
        return this.applyResults.get(id)
    }

    async refreshTab(tabId: number): Promise<void> {
        if (typeof chrome === 'undefined' || !chrome.tabs) return
        let tab: chrome.tabs.Tab | undefined
        try { tab = await chrome.tabs.get(tabId) } catch {}
        if (tab?.url) {
      this.handleTabUpdate(tabId, tab.url)
        }
    }

    on(eventType: EventType, handler: EventHandler): void {
        if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set())
        }
    this.handlers.get(eventType)!.add(handler)
    }

    off(eventType: EventType, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler)
    }

    private emit(type: EventType, payload?: any): void {
        const event: SmartCosmeticEvent = { type, ...payload }
    this.handlers.get(type)?.forEach(h => h(event))
    }

    notifyRulesChanged(): void {
    this.broadcastChannel?.postMessage({ type: 'rules-changed' })
    }

    notifyPlanInvalidated(tabId: number): void {
    this.broadcastChannel?.postMessage({ type: 'plan-invalidated', tabId })
    }

    getStats() {
        return smartEngine.getStats()
    }
}

export const cosmeticsService = new Service()

export * as CosmeticsService from './service'
