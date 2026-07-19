// UBR_ALLOW_FETCH_NON_RULE_DATA — smart-cosmetic fetches cosmetic data (not filter rules) at runtime.
// This is a documented limitation: the extension does not fetch blocking rules at runtime, but smart-cosmetic
// does fetch YAML-formatted cosmetic collection data from remote URLs on a schedule.

import { collectionManager } from './smart-rule-collection'
import type { SmartRuleCollection, SmartRuleListMetadata, SmartCosmeticRule } from './smart-rule-schema'
import { smartRuleStore } from './smart-rule-store'

export interface FetchGatewayOptions {
  defaultUpdateIntervalMs: number
  retryDelayMs: number
  maxRetries: number
}

export const DEFAULT_FETCH_OPTIONS: FetchGatewayOptions = {
  defaultUpdateIntervalMs: 24 * 60 * 60 * 1000,
  retryDelayMs: 30 * 60 * 1000,
  maxRetries: 3,
}

export class Gateway {
    private etags: Map<string, string> = new Map()
    private cachedContents: Map<string, { content: string; fetchedAt: number }> = new Map()
    private updateTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
    private activeFetches: Map<string, Promise<FetchResult>> = new Map()

    constructor(private _options: FetchGatewayOptions = DEFAULT_FETCH_OPTIONS) {}

    async subscribe(url: string, collectionId: string): Promise<boolean> {
        await collectionManager.registerCollection({
      id: collectionId,
      sourceUrl: url,
      metadata: { listId: collectionId, syntaxVersion: 1 },
        })

    this.scheduleNextUpdate(collectionId, 0)
    return true
    }

    async unsubscribe(collectionId: string): Promise<boolean> {
    this.cancelTimer(collectionId)
    this.activeFetches.delete(collectionId)
    this.etags.delete(collectionId)
    this.cachedContents.delete(collectionId)
    return collectionManager.unregisterCollection(collectionId)
    }

    async fetchNow(collectionId: string): Promise<FetchResult> {
        const inFlight = this.activeFetches.get(collectionId)
        if (inFlight) return inFlight

        const promise = this.doFetch(collectionId)
    this.activeFetches.set(collectionId, promise)
    try {
        return await promise
    } finally {
      this.activeFetches.delete(collectionId)
    }
    }

    getCachedContent(collectionId: string): string | undefined {
        return this.cachedContents.get(collectionId)?.content
    }

    getEtag(collectionId: string): string | undefined {
        return this.etags.get(collectionId)
    }

    private async doFetch(collectionId: string): Promise<FetchResult> {
        const collection = smartRuleStore.getCollection(collectionId)
        if (!collection?.sourceUrl) {
            return { ok: false, error: 'No source URL configured', collectionId }
        }

        const headers: Record<string, string> = {}
        const etag = this.etags.get(collectionId)
        if (etag) headers['If-None-Match'] = etag

        let lastError: string | undefined
        for (let attempt = 0; attempt <= this._options.maxRetries; attempt++) {
            try {
                const controller = new AbortController()
                const timeout = setTimeout(() => controller.abort(), 30000)

                const response = await fetch(collection.sourceUrl, {
          headers,
          signal: controller.signal,
                })
                clearTimeout(timeout)

                if (response.status === 304) {
          this.scheduleNextUpdate(collectionId)
          return { ok: true, status: 304, cached: true, collectionId }
                }

                if (!response.ok) {
                    lastError = `HTTP ${response.status}`
                    if (attempt < this._options.maxRetries) {
                        await delay(this._options.retryDelayMs * Math.pow(2, attempt))
                    }
                    continue
                }

                const text = await response.text()
                const newEtag = response.headers.get('ETag')
                if (newEtag) this.etags.set(collectionId, newEtag)

        const { parseSmartRules } = await import('./smart-rule-parser')
        const parsed = parseSmartRules(text)
        if (parsed.errors.length > 0) {
            return { ok: false, error: `YAML parse errors: ${parsed.errors.join('; ')}`, collectionId }
        }

        this.cachedContents.set(collectionId, { content: text, fetchedAt: Date.now() })

        const rules: SmartCosmeticRule[] = parsed.rules.map(r => ({ ...r, collectionId }))
        const updatedMeta: SmartRuleListMetadata = {
          ...collection.metadata!,
          updatedAt: new Date().toISOString(),
          sourceEtag: newEtag || undefined,
        }
        const updatedCollection: SmartRuleCollection = {
          ...collection,
          metadata: updatedMeta,
          lastUpdateCheck: Date.now(),
          lastUpdateSuccess: Date.now(),
          updateError: undefined,
        }
        await smartRuleStore.replaceCollectionRules(collectionId, rules, updatedCollection)
        this.scheduleNextUpdate(collectionId)
        return { ok: true, content: text, etag: newEtag || undefined, ruleCount: rules.length, collectionId }
            } catch (err) {
        console.warn('[uBR] fetch-gateway: fetch failed for collection', collectionId, err)
        lastError = String(err)
        if (attempt < this._options.maxRetries) {
            await delay(this._options.retryDelayMs * Math.pow(2, attempt))
        }
            }
        }

        await smartRuleStore.updateCollection(collectionId, {
      lastUpdateCheck: Date.now(),
      updateError: lastError,
        })
    this.scheduleNextUpdate(collectionId, this._options.retryDelayMs)
    return { ok: false, error: lastError, collectionId }
    }

    private scheduleNextUpdate(collectionId: string, delayMs?: number): void {
    this.cancelTimer(collectionId)

    const interval = delayMs ?? this._options.defaultUpdateIntervalMs
    const timer = setTimeout(() => {
      this.fetchNow(collectionId)
    }, interval)
    this.updateTimers.set(collectionId, timer)
    }

    private cancelTimer(collectionId: string): void {
        const existing = this.updateTimers.get(collectionId)
        if (existing) {
            clearTimeout(existing)
      this.updateTimers.delete(collectionId)
        }
    }
}

export interface FetchResult {
  ok: boolean
  content?: string
  etag?: string
  status?: number
  cached?: boolean
  ruleCount?: number
  error?: string
  collectionId: string
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export const fetchGateway = new Gateway()

export * as FetchGateway from './fetch-gateway'
