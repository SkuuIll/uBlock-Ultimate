import type { SmartCosmeticRule, SmartRuleCollection, RuleState } from './smart-rule-schema'
import { isValidStateTransition, normalizeRuleState } from './smart-rule-schema'
import { triggerFingerprintGC } from './matcher'
import type { ValidationResult } from './smart-rule-validator'
import { validateRule } from './smart-rule-validator'

const STORAGE_KEY_RULES = 'smartCosmeticRules'
const STORAGE_KEY_COLLECTIONS = 'smartCosmeticCollections'
const STORAGE_KEY_INDEX = 'smartCosmeticIndex'
const STORAGE_KEY_MIGRATION = 'cosmeticMigrationDone'
const USER_FILTERS_KEY = 'user-filters'

async function migrateUserCosmeticFilters(storageApi: typeof chrome.storage.local): Promise<void> {
    const bin = await storageApi.get([STORAGE_KEY_MIGRATION, USER_FILTERS_KEY, STORAGE_KEY_RULES])
    if (bin[STORAGE_KEY_MIGRATION] === true) return
    const userFilters: string = (bin[USER_FILTERS_KEY] as string) || ''
    const lines = userFilters.split('\n')
    const cosmeticLines: string[] = []
    const networkLines: string[] = []
    for (const line of lines) {
        if (line.includes('##')) {
      cosmeticLines.push(line)
        } else {
      networkLines.push(line)
        }
    }
    if (cosmeticLines.length > 0) {
        const existingRules: Record<string, any> = bin[STORAGE_KEY_RULES] || {}
        for (const line of cosmeticLines) {
            const hashIdx = line.indexOf('##')
            const domainPart = hashIdx > 0 ? line.slice(0, hashIdx) : '*'
            const selector = line.slice(hashIdx + 2)
            if (!selector) continue
            const id = `migrated:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            if (existingRules[id]) continue
            const targets = domainPart === '*'
                ? [{ form: 'host' as const, value: '*' }]
                : domainPart.split(',').filter(Boolean).map(d => ({ form: 'host' as const, value: d }))
            existingRules[id] = {
        type: 'hide-exact',
        id,
        syntaxVersion: 1,
        state: 'active',
        targets,
        selector,
        action: { action: 'hide' },
        metadata: { createdAt: new Date().toISOString(), source: 'migration' },
        collectionId: 'migrated-cosmetic',
            }
        }
        await storageApi.set({ [STORAGE_KEY_RULES]: existingRules, [USER_FILTERS_KEY]: networkLines.join('\n') })
    }
    await storageApi.set({ [STORAGE_KEY_MIGRATION]: true })
}

function migrateRule(raw: any): void {
    if (!raw) return

    // Flatten nested performance.metrics (old format: { metrics: { metrics: 'collect', sampleRate: 0.5 } })
    if (raw.performance && typeof raw.performance.metrics === 'object' && raw.performance.metrics !== null) {
        const nested = raw.performance.metrics
        raw.performance.metrics = typeof nested.metrics === 'string' ? nested.metrics : 'collect'
        if (typeof nested.sampleRate === 'number' && raw.performance.sampleRate === undefined) {
            raw.performance.sampleRate = nested.sampleRate
        }
    }
    if (raw.performance?.metrics === 'debug') {
        raw.performance.metrics = 'collect'
    }

    // Remove non-spec fields from performance
    if (raw.performance) {
        delete raw.performance.cacheFeatureVectors
    }

    // Remove non-spec fields from action options
    if (raw.action?.options) {
        delete raw.action.options.styleWhitelist
        delete raw.action.options.markOutlineMerge
    }

    // Remove non-spec fields from boundary
    if (raw.boundary) {
        delete raw.boundary.ancestorDepth
        // Normalize: allowCrossScope implies stopAtScope=false (matching parseBoundary)
        if (raw.boundary.allowCrossScope === true) {
            raw.boundary.stopAtScope = false
        }
    }

    // Remove non-spec fields from shadow
    if (raw.shadow) {
        delete raw.shadow.observeSubtree
    }

    // Remove non-spec fields from runtime
    if (raw.runtime) {
        delete raw.runtime.observeAttributesTree
    }
}

interface RuleIndex {
  byTarget: Record<string, string[]>
  byHost: Record<string, string[]>
  byType: Record<string, string[]>
  byCollection: Record<string, string[]>
}

export class Store {
    private rules: Map<string, SmartCosmeticRule> = new Map()
    private collections: Map<string, SmartRuleCollection> = new Map()
    private index: RuleIndex = { byTarget: {}, byHost: {}, byType: {}, byCollection: {} }
    private loaded = false

    storageApi: typeof chrome.storage.local = (typeof chrome !== 'undefined' && chrome.storage?.local)
        ? chrome.storage.local
        : { get: async () => ({}), set: async () => {}, remove: async () => {}, clear: async () => {} } as any

    async load(): Promise<void> {
        if (this.loaded) return
        const { storageApi } = this
        await migrateUserCosmeticFilters(storageApi)
        const bin = await storageApi.get([STORAGE_KEY_RULES, STORAGE_KEY_COLLECTIONS, STORAGE_KEY_INDEX])

        const rawRules: Record<string, any> = bin[STORAGE_KEY_RULES] || {}
        for (const [id, raw] of Object.entries(rawRules)) {
            if (raw.state) raw.state = normalizeRuleState(raw.state)
            migrateRule(raw)
      this.rules.set(id, raw as SmartCosmeticRule)
        }

        const rawCollections: Record<string, any> = bin[STORAGE_KEY_COLLECTIONS] || {}
        for (const [id, raw] of Object.entries(rawCollections)) {
      this.collections.set(id, raw as SmartRuleCollection)
        }

        this.index = (bin[STORAGE_KEY_INDEX] as RuleIndex) || { byTarget: {}, byHost: {}, byType: {}, byCollection: {} }
        this.loaded = true
    }

    private assertLoaded(): void {
        if (!this.loaded) throw new Error('SmartRuleStore not loaded. Call load() first.')
    }

    async save(): Promise<void> {
        return this.persist()
    }

    private async persist(): Promise<void> {
        const rules: Record<string, SmartCosmeticRule> = {}
    this.rules.forEach((v, k) => { rules[k] = v })
    const collections: Record<string, SmartRuleCollection> = {}
    this.collections.forEach((v, k) => { collections[k] = v })
    await this.storageApi.set({
      [STORAGE_KEY_RULES]: rules,
      [STORAGE_KEY_COLLECTIONS]: collections,
      [STORAGE_KEY_INDEX]: this.index,
    })
    }

    // --- Rule CRUD ---

    async addRule(rule: SmartCosmeticRule): Promise<{ ok: boolean; validation?: ValidationResult }> {
    this.assertLoaded()
    rule.state = normalizeRuleState(rule.state)
    const vr = validateRule(rule)
    if (!vr.valid) return { ok: false, validation: vr }

    if (this.rules.has(rule.id)) {
        return { ok: false, validation: { valid: false, diagnostics: [{ code: 'rule-id-conflict', message: `Rule ${rule.id} already exists`, severity: 'error' }] } }
    }

    this.rules.set(rule.id, rule)
    this.indexRule(rule)
    await this.persist()
    return { ok: true }
    }

    async updateRule(id: string, updates: Partial<SmartCosmeticRule>): Promise<{ ok: boolean; validation?: ValidationResult }> {
    this.assertLoaded()
    const existing = this.rules.get(id)
    if (!existing) return { ok: false, validation: { valid: false, diagnostics: [{ code: 'rule-not-found', message: `Rule ${id} not found`, severity: 'error' }] } }

    const merged = { ...existing, ...updates, id } as SmartCosmeticRule
    merged.state = normalizeRuleState(merged.state)
    const vr = validateRule(merged)
    if (!vr.valid) return { ok: false, validation: vr }

    this.unindexRule(existing)
    this.rules.set(id, merged)
    this.indexRule(merged)
    await this.persist()
    return { ok: true }
    }

    private collectActiveSelectors(): string[] {
        const selectors: string[] = []
        for (const rule of this.rules.values()) {
            if (rule.state !== 'active') continue
            const s = 'selector' in rule ? (rule as any).selector : undefined
            if (s && typeof s === 'string') selectors.push(s)
            const c = 'candidates' in rule ? (rule as any).candidates : undefined
            if (Array.isArray(c)) selectors.push(...c)
        }
        return selectors
    }

    async removeRule(id: string): Promise<boolean> {
    this.assertLoaded()
    const existing = this.rules.get(id)
    if (!existing) return false
    this.unindexRule(existing)
    this.rules.delete(id)
    await this.persist()
    triggerFingerprintGC(this.collectActiveSelectors())
    return true
    }

    async setRuleState(id: string, state: RuleState): Promise<boolean> {
    this.assertLoaded()
    const rule = this.rules.get(id)
    if (!rule) return false
    const fromState = normalizeRuleState(rule.state)
    const toState = normalizeRuleState(state)
    if (!isValidStateTransition(fromState, toState, rule)) return false
    rule.state = toState
    await this.persist()
    return true
    }

    getRule(id: string): SmartCosmeticRule | undefined {
    this.assertLoaded()
    return this.rules.get(id)
    }

    getAllRules(): SmartCosmeticRule[] {
    this.assertLoaded()
    return Array.from(this.rules.values())
    }

    getRulesByType(type: string): SmartCosmeticRule[] {
    this.assertLoaded()
    return (this.index.byType[type] || [])
      .map(id => this.rules.get(id))
      .filter((r): r is SmartCosmeticRule => r !== undefined)
    }

    getRulesByHost(hostname: string): SmartCosmeticRule[] {
    this.assertLoaded()
    const keys = new Set<string>()
    for (const h of [hostname, hostname.split('.').slice(-2).join('.'), '*']) {
        const ids = this.index.byHost[h] || []
        for (const id of ids) keys.add(id)
    }
    return Array.from(keys).map(id => this.rules.get(id)).filter((r): r is SmartCosmeticRule => r !== undefined)
    }

    getRulesByCollection(collectionId: string): SmartCosmeticRule[] {
    this.assertLoaded()
    return (this.index.byCollection[collectionId] || [])
      .map(id => this.rules.get(id))
      .filter((r): r is SmartCosmeticRule => r !== undefined)
    }

    // --- Collection CRUD ---

    async addCollection(collection: SmartRuleCollection): Promise<boolean> {
    this.assertLoaded()
    if (this.collections.has(collection.id)) return false
    this.collections.set(collection.id, collection)
    await this.persist()
    return true
    }

    async removeCollection(id: string): Promise<boolean> {
    this.assertLoaded()
    if (!this.collections.has(id)) return false
    const ruleIds = this.index.byCollection[id] || []
    for (const ruleId of ruleIds) {
        const rule = this.rules.get(ruleId)
        if (rule) {
        this.unindexRule(rule)
        this.rules.delete(ruleId)
        }
    }
    this.collections.delete(id)
    await this.persist()
    triggerFingerprintGC(this.collectActiveSelectors())
    return true
    }

    async updateCollection(id: string, updates: Partial<SmartRuleCollection>): Promise<boolean> {
    this.assertLoaded()
    const existing = this.collections.get(id)
    if (!existing) return false
    this.collections.set(id, { ...existing, ...updates })
    await this.persist()
    return true
    }

    getCollection(id: string): SmartRuleCollection | undefined {
    this.assertLoaded()
    return this.collections.get(id)
    }

    getAllCollections(): SmartRuleCollection[] {
    this.assertLoaded()
    return Array.from(this.collections.values())
    }

    // --- Bulk operations ---

    async replaceCollectionRules(collectionId: string, rules: SmartCosmeticRule[], collection: SmartRuleCollection): Promise<void> {
    this.assertLoaded()
    const oldIds = [...(this.index.byCollection[collectionId] || [])]
    for (const id of oldIds) {
        const old = this.rules.get(id)
        if (old) this.unindexRule(old)
      this.rules.delete(id)
    }
    for (const rule of rules) {
      this.rules.set(rule.id, rule)
      this.indexRule(rule)
    }
    this.collections.set(collectionId, collection)
    await this.persist()
    triggerFingerprintGC(this.collectActiveSelectors())
    }

    async clearAll(): Promise<void> {
    this.rules.clear()
    this.collections.clear()
    this.index = { byTarget: {}, byHost: {}, byType: {}, byCollection: {} }
    await this.persist()
    triggerFingerprintGC(this.collectActiveSelectors())
    }

    getStats(): { ruleCount: number; collectionCount: number; byType: Record<string, number>; byState: Record<string, number> } {
    this.assertLoaded()
    const byType: Record<string, number> = {}
    const byState: Record<string, number> = {}
    for (const rule of this.rules.values()) {
        byType[rule.type] = (byType[rule.type] || 0) + 1
        byState[rule.state] = (byState[rule.state] || 0) + 1
    }
    return { ruleCount: this.rules.size, collectionCount: this.collections.size, byType, byState }
    }

    // --- Indexing (internal) ---

    private indexRule(rule: SmartCosmeticRule): void {
        for (const target of rule.targets) {
            const key = `${target.form}:${target.value}`
      this.addToIndex(this.index.byTarget, key, rule.id)
      if (target.form === 'host' || target.form === 'domain') {
        this.addToIndex(this.index.byHost, target.value, rule.id)
      }
        }
    this.addToIndex(this.index.byType, rule.type, rule.id)
    if (rule.collectionId) {
      this.addToIndex(this.index.byCollection, rule.collectionId, rule.id)
    }
    }

    private unindexRule(rule: SmartCosmeticRule): void {
        for (const target of rule.targets) {
            const key = `${target.form}:${target.value}`
      this.removeFromIndex(this.index.byTarget, key, rule.id)
      if (target.form === 'host' || target.form === 'domain') {
        this.removeFromIndex(this.index.byHost, target.value, rule.id)
      }
        }
    this.removeFromIndex(this.index.byType, rule.type, rule.id)
    if (rule.collectionId) {
      this.removeFromIndex(this.index.byCollection, rule.collectionId, rule.id)
    }
    }

    private addToIndex(idx: Record<string, string[]>, key: string, id: string): void {
        if (!idx[key]) idx[key] = []
        if (!idx[key].includes(id)) idx[key].push(id)
    }

    private removeFromIndex(idx: Record<string, string[]>, key: string, id: string): void {
        if (!idx[key]) return
        const i = idx[key].indexOf(id)
        if (i !== -1) idx[key].splice(i, 1)
        if (idx[key].length === 0) delete idx[key]
    }
}

export const smartRuleStore = new Store()

export * as SmartRuleStore from './smart-rule-store'
