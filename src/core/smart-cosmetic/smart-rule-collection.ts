// UBR_ALLOW_FETCH_NON_RULE_DATA — smart-cosmetic fetches cosmetic data (not filter rules) at runtime.
// This is a documented limitation: the extension does not fetch blocking rules at runtime, but smart-cosmetic
// does fetch YAML-formatted cosmetic collection data from remote URLs on a schedule.

import type { SmartRuleCollection, SmartRuleListMetadata, SmartCosmeticRule } from './smart-rule-schema'
import { smartRuleStore } from './smart-rule-store'

export const SMART_RULE_COLLECTION_DEFAULTS = {
  updateIntervalMs: 24 * 60 * 60 * 1000,
  retryDelayMs: 30 * 60 * 1000,
  maxRetries: 3,
} as const

export class CollectionManager {
    private updateTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
    private pendingUpdates: Map<string, Promise<boolean>> = new Map()

    async registerCollection(collection: SmartRuleCollection): Promise<boolean> {
        const exists = smartRuleStore.getCollection(collection.id)
        if (exists) return false
        await smartRuleStore.addCollection(collection)
        return true
    }

    async unregisterCollection(id: string): Promise<boolean> {
    this.clearUpdateTimer(id)
    this.pendingUpdates.delete(id)
    return smartRuleStore.removeCollection(id)
    }

    getCollection(id: string): SmartRuleCollection | undefined {
        return smartRuleStore.getCollection(id)
    }

    getAllCollections(): SmartRuleCollection[] {
        return smartRuleStore.getAllCollections()
    }

    scheduleUpdate(collectionId: string, intervalMs: number = SMART_RULE_COLLECTION_DEFAULTS.updateIntervalMs): void {
    this.clearUpdateTimer(collectionId)
    const timer = setTimeout(async () => {
        await this.updateCollection(collectionId)
    }, intervalMs)
    this.updateTimers.set(collectionId, timer)
    }

    clearUpdateTimer(collectionId: string): void {
        const existing = this.updateTimers.get(collectionId)
        if (existing) {
            clearTimeout(existing)
      this.updateTimers.delete(collectionId)
        }
    }

    async updateCollection(collectionId: string): Promise<boolean> {
        const inFlight = this.pendingUpdates.get(collectionId)
        if (inFlight) return inFlight.then(() => true)

        const promise = this.doUpdateCollection(collectionId)
    this.pendingUpdates.set(collectionId, promise)
    try {
        return await promise
    } finally {
      this.pendingUpdates.delete(collectionId)
    }
    }

    private async doUpdateCollection(collectionId: string): Promise<boolean> {
        const collection = smartRuleStore.getCollection(collectionId)
        if (!collection) return false
        if (!collection.sourceUrl) return false

        const metadata = collection.metadata || { listId: collectionId, syntaxVersion: 1 }
        const { parseYaml, extractRulesFromParsed } = await import('./smart-rule-parser')

        let lastError: string | undefined
        for (let attempt = 0; attempt <= SMART_RULE_COLLECTION_DEFAULTS.maxRetries; attempt++) {
            try {
                const response = await fetch(collection.sourceUrl)
                if (!response.ok) {
                    lastError = `HTTP ${response.status}`
                    if (attempt < SMART_RULE_COLLECTION_DEFAULTS.maxRetries) {
                        await delay(SMART_RULE_COLLECTION_DEFAULTS.retryDelayMs * Math.pow(2, attempt))
                    }
                    continue
                }
                const text = await response.text()
                const parsed = parseYaml(text)
                if (parsed.errors.length > 0) {
                    lastError = `Parse errors: ${parsed.errors.join(', ')}`
                    break
                }
                const { rules: rawRules } = extractRulesFromParsed(parsed.value)
                const convertedRules: SmartCosmeticRule[] = rawRules.map(r => ({
          ...(r.data as any),
          id: (r.data as any).id || `${collectionId}:${r.type}:${Math.random().toString(36).slice(2, 9)}`,
          type: r.type,
          syntaxVersion: collection.metadata?.syntaxVersion || 1,
          state: 'active',
          metadata: { createdAt: new Date().toISOString() },
          targets: (r.data as any).targets || [],
          action: (r.data as any).action || { action: 'hide' },
          collectionId,
                })) as SmartCosmeticRule[]
                const updatedMeta: SmartRuleListMetadata = {
          ...metadata,
          updatedAt: new Date().toISOString(),
          sourceEtag: response.headers.get('ETag') || undefined,
                }
                const updatedCollection: SmartRuleCollection = {
          ...collection,
          metadata: updatedMeta,
          lastUpdateCheck: Date.now(),
          lastUpdateSuccess: Date.now(),
          updateError: undefined,
                }
                await smartRuleStore.replaceCollectionRules(collectionId, convertedRules, updatedCollection)
        this.scheduleUpdate(collectionId)
        return true
            } catch (err) {
                lastError = String(err)
                if (attempt < SMART_RULE_COLLECTION_DEFAULTS.maxRetries) {
                    await delay(SMART_RULE_COLLECTION_DEFAULTS.retryDelayMs * Math.pow(2, attempt))
                }
            }
        }

        await smartRuleStore.updateCollection(collectionId, {
      lastUpdateCheck: Date.now(),
      updateError: lastError,
        })
    this.scheduleUpdate(collectionId, SMART_RULE_COLLECTION_DEFAULTS.retryDelayMs)
    return false
    }

    getRulesByCollection(collectionId: string): SmartCosmeticRule[] {
        return smartRuleStore.getRulesByCollection(collectionId)
    }

    getStats() {
        const collections = this.getAllCollections()
        const total = collections.length
        const withErrors = collections.filter(c => c.updateError).length
        return { total, withErrors }
    }
}

export const collectionManager = new CollectionManager()

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export * as SmartRuleCollectionManager from './smart-rule-collection'
