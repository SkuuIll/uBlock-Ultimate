import type {
    SmartCosmeticRule, HideExactRule, HideSimilarRule,
    SmartHideRule, SmartAllowRule,
} from './smart-rule-schema'
import { smartRuleStore } from './smart-rule-store'
import { fetchGateway } from './fetch-gateway'
import { compileCosmeticPlan } from './cosmetic-plan'
import {
    ConflictClass, getActionStrength, hasHideLikeAction, sortByConflictOrder,
} from './conflict'

const MAX_SELECTORS_PER_BATCH = 50

export interface ApplyResult {
  matched: number
  hidden: number
  removed: number
  selectors: string[]
}

export interface CosmeticPlanResult {
  matched: number
  hidden: number
  removed: number
  plan: ReturnType<typeof compileCosmeticPlan>
}

export interface EngineStats {
  totalRules: number
  enabledRules: number
  loadedCollections: number
  pendingFetches: number
  tabsActive: number
}

export type TabState = {
  url: string
  hostname: string
  appliedSelectors: Set<string>
  lastApply: number
}

export { ConflictClass, getActionStrength, hasHideLikeAction }
export { smartRuleStore } from './smart-rule-store'
export { exportAllRules } from './export'
export { parseSmartRules } from './smart-rule-parser'
export type { SmartCosmeticRule, SmartRuleCollection } from './smart-rule-schema'

export class Engine {
    private tabs: Map<number, TabState> = new Map()
    private activeDownloads: Set<string> = new Set()
    private initialized = false
    private trustedHostnames: Set<string> = new Set()

    async init(): Promise<void> {
        if (this.initialized) return
        await smartRuleStore.load()
        this.initialized = true
    }

    async refresh(): Promise<void> {
        await smartRuleStore.load()
    }

    getRulesForTab(tabId: number): SmartCosmeticRule[] {
        const tab = this.tabs.get(tabId)
        if (!tab) return []

        const allRules = smartRuleStore.getAllRules()
        const matching = allRules.filter(r => {
            if (r.state !== 'active') return false
            return this.ruleMatchesHost(r, tab.hostname)
        })

        return sortByConflictOrder(matching)
    }

    getCosmeticPlanForTab(tabId: number, url: string): CosmeticPlanResult {
        const hostname = this.extractHostname(url)
        if (this.isSiteTrusted(url)) {
            return { matched: 0, hidden: 0, removed: 0, plan: compileCosmeticPlan([], url, hostname) }
        }
        let tab = this.tabs.get(tabId)
        if (!tab) {
            tab = { url, hostname, appliedSelectors: new Set(), lastApply: 0 }
      this.tabs.set(tabId, tab)
        }
        tab.url = url
        tab.hostname = hostname
        tab.lastApply = Date.now()

        const rules = this.getRulesForTab(tabId)
        const plan = compileCosmeticPlan(rules, url, hostname)

        return {
      matched: plan.cssSelectors.length + plan.smartRules.length,
      hidden: plan.cssSelectors.length,
      removed: 0,
      plan,
        }
    }

    applyRulesToTab(tabId: number, url: string): ApplyResult {
        const hostname = this.extractHostname(url)
        if (this.isSiteTrusted(url)) {
            return { matched: 0, hidden: 0, removed: 0, selectors: [] }
        }
        let tab = this.tabs.get(tabId)
        if (!tab) {
            tab = { url, hostname, appliedSelectors: new Set(), lastApply: 0 }
      this.tabs.set(tabId, tab)
        }
        tab.url = url
        tab.hostname = hostname
        tab.lastApply = Date.now()

        const rules = this.getRulesForTab(tabId)
        const selectorSet = new Set<string>()
        const removedSelectors = new Set<string>()

        const hideRules = rules.filter(r => r.type !== 'smart-allow')
        const allowRules = rules.filter(r => r.type === 'smart-allow')

        for (const rule of hideRules) {
            if (!hasHideLikeAction(rule)) continue

            const result = this.processRule(rule, tab)
            if (rule.action.action === 'remove') {
                for (const sel of result.selectors) {
          removedSelectors.add(sel)
                }
            }
            for (const sel of result.selectors) {
        selectorSet.add(sel)
            }
        }

        for (const rule of allowRules) {
            const removed = this.processSmartAllowAgainst(rule, selectorSet)
            for (const sel of removed) {
        selectorSet.delete(sel)
        removedSelectors.add(sel)
            }
        }

        tab.appliedSelectors = new Set([...selectorSet])
        const selectors = Array.from(selectorSet)

        return {
      matched: selectors.length,
      hidden: selectors.length,
      removed: removedSelectors.size,
      selectors,
        }
    }

    private processSmartAllowAgainst(rule: SmartAllowRule, currentSelectors: Set<string>): string[] {
        if (currentSelectors.size === 0) return []
        const removed: string[] = []
        if (rule.candidates) {
            for (const sel of rule.candidates) {
                if (currentSelectors.has(sel)) {
          removed.push(sel)
                }
            }
        }
        if (rule.scope) {
            for (const sel of rule.scope) {
                if (currentSelectors.has(sel)) {
          removed.push(sel)
                }
            }
        }
        return removed
    }

    private processRule(rule: SmartCosmeticRule, tab: TabState): { selectors: string[] } {
        switch (rule.type) {
        case 'hide-exact':
            return this.processHideExact(rule)
        case 'hide-similar':
            return this.processHideSimilar(rule, tab)
        case 'smart-hide':
            return this.processSmartHide(rule, tab)
        default:
            return { selectors: [] }
        }
    }

    private processHideExact(rule: HideExactRule): { selectors: string[] } {
        if (!rule.selector) return { selectors: [] }
        return { selectors: [rule.selector] }
    }

    private processHideSimilar(rule: HideSimilarRule, _tab: TabState): { selectors: string[] } {
        void _tab;
        const selectors = rule.candidates ? [...rule.candidates] : []
        const safety = rule.safety
        const cap = safety?.maxMatches ?? MAX_SELECTORS_PER_BATCH
        return { selectors: selectors.slice(0, cap) }
    }

    private processSmartHide(rule: SmartHideRule, _tab: TabState): { selectors: string[] } {
        const selectors = rule.candidates ? [...rule.candidates] : []
        const safety = rule.safety
        const cap = safety?.maxMatches ?? MAX_SELECTORS_PER_BATCH
        return { selectors: selectors.slice(0, cap) }
    }

    private ruleMatchesHost(rule: SmartCosmeticRule, hostname: string): boolean {
        for (const target of rule.targets) {
            if (target.form === 'host' && target.value === hostname) return true
            if (target.form === 'domain') {
                const parts = hostname.split('.')
                const registered = parts.slice(-2).join('.')
                if (registered === target.value) return true
                if (hostname === target.value) return true
            }
            if (target.form === 'regex') {
                try {
                    if (new RegExp(target.value).test(hostname)) return true
                } catch (e) {
          console.warn('[uBR] engine: ruleMatchesHost regex test failed', target.value, e)
          continue
                }
            }
            if (target.form === 'entity') {
                const entityName = target.value.replace(/\.\*$/, '')
                if (hostname === entityName) return true
                if (hostname.startsWith(`${entityName}.`)) return true
                if (hostname.endsWith(`.${entityName}`)) return true
                if (hostname.includes(`.${entityName}.`)) return true
            }
            if (target.value === '*') {
                // P1.6: Wildcard targets are test-only or explicitly confirmed.
                // In production, require safety metadata.
                if (rule?.metadata?.scope === 'test-only' || rule?.safety?.allowGlobal === true) {
                    return true;
                }
                return false;
            }
        }
        return false
    }

    async triggerUpdate(url: string): Promise<void> {
        const hostname = this.extractHostname(url)
        const rules = smartRuleStore.getRulesByHost(hostname)
        const collectionsToUpdate = new Set<string>()

        for (const rule of rules) {
            if (rule.collectionId && rule.state === 'active') {
                const col = smartRuleStore.getCollection(rule.collectionId)
                if (col?.sourceUrl) {
          collectionsToUpdate.add(rule.collectionId)
                }
            }
        }

        for (const colId of collectionsToUpdate) {
            if (!this.activeDownloads.has(colId)) {
        this.activeDownloads.add(colId)
        fetchGateway.fetchNow(colId).finally(() => {
          this.activeDownloads.delete(colId)
        })
            }
        }
    }

    subscribeToCollection(url: string, collectionId: string): Promise<boolean> {
        return fetchGateway.subscribe(url, collectionId)
    }

    unsubscribeFromCollection(collectionId: string): Promise<boolean> {
        return fetchGateway.unsubscribe(collectionId)
    }

    removeTab(tabId: number): void {
    this.tabs.delete(tabId)
    }

    getTabSelectors(tabId: number): string[] {
        const tab = this.tabs.get(tabId)
        return tab ? Array.from(tab.appliedSelectors) : []
    }

    getAllRules(): SmartCosmeticRule[] {
        return smartRuleStore.getAllRules()
    }

    getStats(): EngineStats {
        const allRules = smartRuleStore.getAllRules()
        return {
      totalRules: allRules.length,
      enabledRules: allRules.filter(r => r.state === 'active').length,
      loadedCollections: smartRuleStore.getAllCollections().length,
      pendingFetches: this.activeDownloads.size,
      tabsActive: this.tabs.size,
        }
    }

    private extractHostname(url: string): string {
        try {
            return new URL(url).hostname
        } catch (e) {
      console.warn('[uBR] engine: extractHostname URL parse failed', url, e)
      return url
        }
    }

    setTrustedHostnames(hostnames: string[]): void {
        this.trustedHostnames = new Set(hostnames)
    }

    addTrustedHostname(hostname: string): void {
    this.trustedHostnames.add(hostname)
    }

    private isSiteTrusted(url: string): boolean {
        const hostname = this.extractHostname(url)
        if (this.trustedHostnames.has(hostname)) return true
        if (this.trustedHostnames.has(`*.${hostname.split('.').slice(-2).join('.')}`)) return true
        return false
    }
}

export const smartEngine = new Engine()

export async function seedDemoRules(): Promise<void> {
    const now = new Date().toISOString()
    const rules: SmartCosmeticRule[] = [
    {
      type: 'hide-exact',
      id: 'demo:simple-ad',
      syntaxVersion: 1,
      state: 'active',
      priority: 50,
      metadata: { createdAt: now, source: 'migration' },
      preview: { status: 'confirmed' },
      targets: [{ form: 'host', value: 'example.com' }],
      selector: '.ad, .ads, .advertisement',
      action: { action: 'hide' },
    },
    {
      type: 'smart-hide',
      id: 'demo:smart-card',
      syntaxVersion: 1,
      state: 'active',
      priority: 50,
      metadata: { createdAt: now, source: 'migration' },
      preview: { status: 'confirmed' },
      targets: [{ form: 'host', value: 'example.com' }],
      candidates: ['.card', '.item', 'article'],
      boundary: { mode: 'repeated-card', maxDepth: 6 },
      match: { mode: 'none' },
      where: { condition: { field: 'text', operator: 'contains', value: 'sponsored' } },
      action: { action: 'hide' },
    },
    ]

    for (const rule of rules) {
        await smartRuleStore.addRule(rule as SmartCosmeticRule)
    }
}
