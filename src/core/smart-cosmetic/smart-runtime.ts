import type { CosmeticPlan } from './cosmetic-plan'
import type { Boundary, MatchBlock, FramesBlock, ShadowBlock, WeightProfile } from './smart-rule-schema'
import { evaluateRuleLogic } from './logic-evaluator'
import { resolveBoundary, markDomGeneration } from './scoper'
import { CosmeticApplier } from './applier'
import { extractFeatureVector, computeSimilarity, minFeaturesAvailable, isGeneratedToken } from './matcher'

export interface RuntimeOptions {
  tabId: number
  url: string
  hostname: string
}

const SELF_MUTATION_MARKER = 'data-ubr-applied'

export class SmartRuntime {
    private plan: CosmeticPlan | null = null
    private applier: CosmeticApplier | null = null
    private tabId = 0
    private currentUrl = ''
    private hostname = ''
    private initialized = false
    private observer: MutationObserver | null = null
    private debounceTimer: ReturnType<typeof setTimeout> | null = null
    private currentCycle = 0
    private spaMode: boolean = false

    constructor(
        private authorizeSmart?: (action: string) => Promise<boolean>,
        private checkSmartLease?: () => boolean,
    ) {}
    private mutationCycleCount = 0
    private dependencyPrefilterCache = new WeakMap<Element, boolean>()
    private frameAppliedCount = 0
    private frameAppliedLimit = 500
    private frameAppliedTotal = 0
    private aggregateFrameLimit = 1500
    private partialCycleCounters = new Map<string, number>()
    private dependencyFallbackCounters = new Map<string, { count: number; firstTime: number }>()
    private ancestorIndex = new Map<string, Element[]>()
    private ancestorDependencySelectors = new Map<string, string[]>()
    private ancestorAttributeNames = new Map<string, Set<string>>()
    private ancestorIndexSize = 0
    private readonly MAX_ANCESTOR_LINKS = 5000
    public emitWarning?: (_msg: string) => void
    private skipRuleIds: Set<string> | null = null

    private originalPushState: typeof history.pushState | null = null
    private originalReplaceState: typeof history.replaceState | null = null
    private originalAttachShadow: typeof Element.prototype.attachShadow | null = null
    private iframeObserver: MutationObserver | null = null
    private shadowScanTimer: ReturnType<typeof setInterval> | null = null
    private frameCounters = new Map<string, { numerator: number; denominator: number }>()
    private perPageCaches = new Map<string, WeakMap<Element, boolean>>()

    async init(options: RuntimeOptions): Promise<void> {
        if (this.initialized) return
        this.tabId = options.tabId
        this.currentUrl = options.url
        this.hostname = options.hostname
        this.initialized = true

        this.applier = new CosmeticApplier(this.authorizeSmart, this.checkSmartLease)
    await this.applier.activate([])

    this.spaMode = !!(window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ || !!document.querySelector('[data-reactroot], [ng-version], #__next, [data-vue-root]')

    await this.startIframeObserver()
    const observeAuthorized = typeof this.authorizeSmart !== "undefined" && await this.authorizeSmart("smart-observe")
    if (observeAuthorized) {
        this.hookAttachShadow()
        this.startShadowScan()
        this.wrapHistoryAPI()
        window.addEventListener('popstate', this.onPathChange)
        window.addEventListener('hashchange', this.onPathChange)
    }
    }

    async loadPlan(plan: CosmeticPlan): Promise<void> {
        this.plan = plan
        // Conflict resolution is handled at the engine level via sortByConflictOrder
        await this.executePlan()

    await this.startMutationObserver()
    }

    private async executePlan(): Promise<void> {
        if (typeof this.authorizeSmart === "undefined" || !(await this.authorizeSmart("smart-selector-update"))) return;
        if (!this.plan || !this.applier) return

        const cssSelectors = this.plan.cssSelectors
    this.applier.updateSelectors(cssSelectors)

    let totalApplied = 0
    const globalCap = 300

    for (const smart of this.plan.smartRules) {
        if (this.skipRuleIds && smart.rule.id && this.skipRuleIds.has(smart.rule.id)) continue
        if (totalApplied >= globalCap) break
        const maxCandidates = smart.frames?.maxTotalMatches ?? 150
        const prevCount = this.frameAppliedCount
        await this.evaluateSmartRule(smart, maxCandidates, globalCap - totalApplied)
        totalApplied += this.frameAppliedCount - prevCount
    }
    }

    private shouldSkipSelfMutation(el: Element): boolean {
        if (el.hasAttribute?.(SELF_MUTATION_MARKER)) return true
        return false
    }

    private buildAncestorIndex(el: Element, smart: CosmeticPlan['smartRules'][0]): void {
        const ruleId = smart.rule.id
        if (!ruleId) return
        if (this.ancestorIndex.has(ruleId)) return

        const ancestors: Element[] = []
        let current = el.parentElement
        const scopeSelector = smart.rule.scope?.[0]
        const depDepth = smart.performance?.dependencyDepth ?? Infinity
        let depth = 0
        while (current && depth < depDepth) {
            if (scopeSelector && current.matches?.(scopeSelector) && smart.rule.logicOptions?.stopAtScopeForAncestor !== false) break
      ancestors.push(current)
      current = current.parentElement
      depth++
        }
        if (depth >= depDepth && current) {
      this.clearPerPageCaches()
      this.dependencyPrefilterCache = new WeakMap()
      this.emitWarning?.('dependency-depth-fallback-scope-reeval')
      this.trackDependencyFallback(ruleId)
      return
        }
    this.ancestorIndex.set(ruleId, ancestors)
    this.ancestorIndexSize += ancestors.length

    const where = (smart.rule as any).where
    const except = (smart.rule as any).except
    const attrNames = new Set<string>()
    const depSelectors: string[] = []
    if (where) this.collectAncestorDeps(where, attrNames, depSelectors)
    if (except) this.collectAncestorDeps(except, attrNames, depSelectors)
    this.ancestorDependencySelectors.set(ruleId, depSelectors)
    this.ancestorAttributeNames.set(ruleId, attrNames)

    if (this.ancestorIndexSize > this.MAX_ANCESTOR_LINKS) {
      this.ancestorIndex.delete(ruleId)
      this.ancestorIndexSize -= ancestors.length
      this.emitWarning?.('ancestor-index-too-large-coarse-invalidation')
    }
    }

    private collectAncestorDeps(expr: unknown, attrNames: Set<string>, depSelectors: string[]): void {
        if (!expr || typeof expr !== 'object') return
        const e = expr as Record<string, unknown>
        if ('condition' in e && typeof e.condition === 'object' && e.condition !== null) {
            const c = e.condition as Record<string, unknown>
            if (c.operator === 'has-ancestor' && c.selector) {
        depSelectors.push(c.selector as string)
        const sel = c.selector as string
        const attrMatch = sel.match(/\[(\w+)/)
        if (attrMatch) attrNames.add(attrMatch[1])
            }
            return
        }
        const group = e as { all?: unknown[]; any?: unknown[]; none?: unknown[] }
        for (const key of ['all', 'any', 'none'] as const) {
            const arr = group[key]
            if (arr) for (const child of arr) this.collectAncestorDeps(child, attrNames, depSelectors)
        }
    }

    private checkAncestorMutationRelevance(mutation: MutationRecord): boolean {
        const target = mutation.target instanceof Element ? mutation.target : null
        if (!target) return false

        for (const [ruleId, ancestors] of this.ancestorIndex) {
            if (ancestors.includes(target)) {
                const attrNames = this.ancestorAttributeNames.get(ruleId)
                if (mutation.type === 'childList') return true
                if (mutation.type === 'attributes' && attrNames && mutation.attributeName && attrNames.has(mutation.attributeName)) return true
            }
        }
        return false
    }

    private extractPrefilter(sel: string): { tag?: string; attrs: string[]; classes: string[]; id?: string; unsafe: boolean } {
        const result = { attrs: [] as string[], classes: [] as string[], unsafe: false }
        if (/:(?:has|has-text|contains|matches-css|upward|xpath|host-context|not|is|where)/.test(sel)) {
            result.unsafe = true
            return result
        }
        const tagMatch = sel.match(/^(\w+)/)
        if (tagMatch) result.tag = tagMatch[1]
        const attrMatches = sel.matchAll(/\[(\w+)/g)
        for (const m of attrMatches) result.attrs.push(m[1])
        const classMatches = sel.matchAll(/\.([\w-]+)/g)
        for (const m of classMatches) result.classes.push(m[1])
        const idMatch = sel.match(/#([\w-]+)/)
        if (idMatch) result.id = idMatch[1]
        return result
    }

    private hasPrefilterDependencies(_el: Element, smart: CosmeticPlan['smartRules'][0]): boolean {
        const perf = smart.performance
        if (!perf?.dependencyPrefilter) return true

        const cached = this.dependencyPrefilterCache.get(_el)
        if (cached !== undefined) return cached

        const deps = smart.candidates.slice(0, 3)
        for (const sel of deps) {
            const pf = this.extractPrefilter(sel)
            if (pf.unsafe) {
        this.dependencyPrefilterCache.set(_el, true)
        return true
            }
            try {
                if (pf.tag && _el.tagName.toLowerCase() !== pf.tag) continue
                if (pf.classes.length > 0 && !pf.classes.some(c => _el.classList.contains(c))) continue
                if (pf.id && _el.id !== pf.id) continue
                if (pf.attrs.length > 0 && !pf.attrs.every(a => _el.hasAttribute(a))) continue
                if (_el.matches?.(sel)) {
          this.dependencyPrefilterCache.set(_el, true)
          return true
                }
                if (_el.querySelector(sel)) {
          this.dependencyPrefilterCache.set(_el, true)
          return true
                }
            } catch (e) {
        console.warn('[uBR] smart-runtime: dependency prefilter querySelector failed', sel, e)
        continue
            }
        }

        const result = deps.length === 0
    this.dependencyPrefilterCache.set(_el, result)
    return result
    }

    private async evaluateSmartRule(
        smart: CosmeticPlan['smartRules'][0],
        perRuleCap: number = 150,
        remainingCap: number = 300,
    ): Promise<void> {
        const doc = document
        if (!doc) return

        const candidates = this.collectCandidates(smart.candidates)
        const performance = smart.performance
        const maxCandidates = Math.min(performance.maxCandidates ?? perRuleCap, remainingCap)

        let appliedCount = 0
        const cap = Math.min(candidates.length, maxCandidates)
        const isPartial = candidates.length > cap
        const safety = smart.safety
        const allowPartial = safety?.allowPartialApply === true
        const ruleId = smart.rule.id
        const newSelectors: string[] = []

        if (isPartial) {
            const partialTracker = this.partialCycleCounters.get(ruleId) ?? 0
      this.partialCycleCounters.set(ruleId, partialTracker + 1)
      const maxPartial = safety?.maxConsecutivePartial ?? 3
      if (partialTracker >= maxPartial) {
          if (this.applier) this.applier.updateSelectors([])
          return
      }
        } else if (this.partialCycleCounters.has(ruleId)) {
      this.partialCycleCounters.delete(ruleId)
        }

        for (let i = 0; i < cap; i++) {
            const el = candidates[i]
            if (!el || !doc.contains(el)) continue

            if (this.shouldSkipSelfMutation(el)) continue

            if (!this.hasPrefilterDependencies(el, smart)) continue

            if (this.frameAppliedCount >= this.frameAppliedLimit) break
            if (this.frameAppliedTotal >= this.aggregateFrameLimit) break

            if ((smart.rule as any).scope && Array.isArray((smart.rule as any).scope)) {
                const scopeSelectors = (smart.rule as any).scope as string[]
                let inScope = false
                for (const sel of scopeSelectors) {
                    try {
                        if (el.matches(sel) || el.closest(sel)) { inScope = true; break }
                    } catch(e) { console.warn('[uBR] smart-runtime: scope selector match failed', sel, e); continue }
                }
                if (!inScope) continue
            }

            const hostname = this.hostname
            const _url = this.currentUrl
            const rules = (smart.rule as any)
            let targetMatch = false
            if (rules.targets && Array.isArray(rules.targets)) {
                for (const t of rules.targets) {
                    if (!t.form || !t.value) continue
                    if (t.form === 'host' && t.value === hostname) { targetMatch = true; break }
                    if (t.form === 'domain') {
                        const parts = hostname.split('.')
                        const registered = parts.slice(-2).join('.')
                        if (registered === t.value || hostname === t.value) { targetMatch = true; break }
                    }
                    if (t.form === 'regex') {
                        try {
                            const re = new RegExp(t.value)
                            if (re.test(hostname)) { targetMatch = true; break }
                        } catch(e) { console.warn('[uBR] smart-runtime: target regex compile failed', t.value, e); }
                    }
                    if (t.form === 'entity') {
                        if (hostname.endsWith(t.value) || hostname === t.value) { targetMatch = true; break }
                    }
                    if (t.value === '*') { targetMatch = true; break }
                }
            }
            if (!targetMatch) continue

            const boundaryConfig: Boundary = smart.boundary
            const resolvedTarget = resolveBoundary(el, boundaryConfig)

            if (!resolvedTarget) continue

            if (smart.performance?.dependencyPrefilter) {
        this.buildAncestorIndex(el, smart)
            }

            const frameMode: FramesBlock['mode'] = smart.frames?.mode ?? 'top-only'
            const isFrame = window.top !== window.self
            if (frameMode === 'top-only' && isFrame) continue
            if (frameMode === 'same-origin' && isFrame) {
                try {
                    if (window.top && window.top.location.origin !== location.origin) continue
                } catch (e) {
          console.warn('[uBR] smart-runtime: same-origin check failed', e)
          continue
                }
            }
            if (frameMode === 'accessible' && isFrame) {
                try {
                    if (window.top) {
                        const canAccess = typeof window.top.document === 'object'
                        if (!canAccess) continue
                    }
                } catch (e) {
          console.warn('[uBR] smart-runtime: accessible check failed', e)
          continue
                }
            }

            if (smart.frames?.accounting === 'per-frame') {
                const frameKey = isFrame ? `frame:${window.location.href}` : 'top'
                let fc = this.frameCounters.get(frameKey)
                if (!fc) {
                    fc = { numerator: 0, denominator: smart.performance?.maxCandidates ?? 150 }
          this.frameCounters.set(frameKey, fc)
                }
                if (fc.numerator >= fc.denominator) continue
                fc.numerator++
            }

            const shadowMode: ShadowBlock['mode'] = smart.shadow?.mode ?? 'none'
            if (shadowMode !== 'none') {
        this.traverseShadow(el, smart)
            }

            const safety = smart.safety
            if (safety?.preview === 'required') {
                const status = this.getPreviewStatus(smart)
                if (status !== 'confirmed' && status !== 'active') continue
            }

            const logicResult = evaluateRuleLogic(resolvedTarget.element, smart.rule)
            if (!logicResult.passed) continue

            const match = smart.match
            if (match && match.mode !== 'none') {
                if (!this.checkSimilarity(resolvedTarget.element, match, smart.candidates)) continue
            }

            if (this.applier) {
                if (isPartial && !allowPartial) continue
                const selector = this.buildSelector(resolvedTarget.element)
        resolvedTarget.element.setAttribute(SELF_MUTATION_MARKER, '')
        newSelectors.push(selector)
        appliedCount++
        this.frameAppliedCount++
        this.frameAppliedTotal++
            }

            if (appliedCount >= maxCandidates) break
        }

        if (newSelectors.length > 0 && this.applier) {
            this.applier.updateSelectors([...this.applier.getAppliedSelectors(), ...newSelectors])
        }
    }

    private getPreviewStatus(smart: CosmeticPlan['smartRules'][0]): string {
        return smart.preview?.status ?? 'none'
    }

    private collectCandidates(selectors: string[]): Element[] {
        const elements: Element[] = []
        const seen = new Set<Element>()
        for (const sel of selectors) {
            try {
                const found = document.querySelectorAll(sel)
                for (const el of found) {
                    if (!seen.has(el)) {
            seen.add(el)
            elements.push(el)
                    }
                }
            } catch (e) {
        console.warn('[uBR] smart-runtime: collectCandidates querySelectorAll failed', sel, e)
        continue
            }
        }
        return elements
    }

    private checkSimilarity(element: Element, match: MatchBlock, candidates?: string[]): boolean {
        const refSelector = match.reference
        const refSelection = match.referenceSelection

        if (!refSelector || refSelector === 'none') {
            if (refSelection === 'first' && candidates && candidates.length > 0) {
                try {
                    const firstEl = document.querySelector(candidates[0])
                    if (firstEl) return this.computeSimilarity(element, firstEl, match)
                } catch (e) {
          console.warn('[uBR] smart-runtime: checkSimilarity querySelector failed', e)
                }
            }
            return refSelection === 'error' ? false : true
        }

        const refEl = refSelector === 'picked' ? null : document.querySelector(refSelector)
        if (!refEl) {
            if (refSelection === 'error') return false
            return true
        }

        return this.computeSimilarity(element, refEl, match)
    }

    private computeSimilarity(element: Element, reference: Element, match: MatchBlock): boolean {
        try {
            const candidateFV = extractFeatureVector(element)
            const referenceFV = extractFeatureVector(reference)
            const profile: WeightProfile = match.weights ?? 'default-card'
            const result = computeSimilarity(candidateFV, referenceFV, profile)
            const threshold = match.threshold ?? 0.74
            const minFeat = 3

            if (!minFeaturesAvailable(result, minFeat)) return false
            return result.score >= threshold
        } catch (e) {
      console.warn('[uBR] smart-runtime: computeSimilarity failed', e)
      return false
        }
    }

    private buildSelector(element: Element): string {
        if (element.id) return `#${CSS.escape(element.id)}`
        const tag = element.tagName.toLowerCase()
        const classes = Array.from(element.classList)
      .filter(c => !isGeneratedToken(c) && !/_\d+$/.test(c))
      .map(c => CSS.escape(c))
        if (classes.length > 0) return `${tag}.${classes.join('.')}`
        return tag
    }

    private traverseShadow(root: Element, smart: CosmeticPlan['smartRules'][0]): void {
        if (!root.shadowRoot) {
            const maybeHost = root.querySelectorAll(':host-context(*), *')
            for (const el of maybeHost) {
                if (el.shadowRoot) {
          this.evaluateInShadow(el.shadowRoot, smart)
                }
            }
            return
        }
    this.evaluateInShadow(root.shadowRoot, smart)
    }

    private evaluateInShadow(shadowRoot: ShadowRoot, smart: CosmeticPlan['smartRules'][0]): void {
        const candidates = shadowRoot.querySelectorAll(smart.candidates.join(','))
        const newSelectors: string[] = []
        for (const el of Array.from(candidates)) {
            if (this.shouldSkipSelfMutation(el)) continue
            const logicResult = evaluateRuleLogic(el, smart.rule)
            if (logicResult.passed && this.applier) {
                const selector = this.buildSelector(el)
        el.setAttribute(SELF_MUTATION_MARKER, '')
        newSelectors.push(selector)
            }
        }
        if (newSelectors.length > 0 && this.applier) {
            this.applier.updateSelectors([...this.applier.getAppliedSelectors(), ...newSelectors])
        }
    }

    private async startMutationObserver(): Promise<void> {
        if (typeof this.authorizeSmart === "undefined" || !(await this.authorizeSmart("smart-observe"))) return;
        if (this.observer) this.observer.disconnect()

        const observedAttrs = this.collectObservedAttributes()

        this.observer = new MutationObserver((mutations) => {
            this.mutationCycleCount++
            if (this.mutationCycleCount > 100) {
                this.observer?.disconnect()
                vAPI.setTimeout(() => {
                    this.mutationCycleCount = 0
                    this.startObserver()
                }, 5000)
        return
            }

            const hasRelevantChange = mutations.some(m =>
                m.type === 'childList' ||
        (m.type === 'attributes' && observedAttrs.length > 0 &&
          observedAttrs.some(a => m.attributeName === a || a === 'auto')),
            )
            if (!hasRelevantChange) return

            if (this.debounceTimer) clearTimeout(this.debounceTimer)
            this.debounceTimer = setTimeout(async () => {
        await this.handleMutations(mutations)
            }, 100)
        })

        const observeConfig: MutationObserverInit = {
      childList: true,
      subtree: true,
      attributes: observedAttrs.length > 0,
        }
        if (observedAttrs.length > 0) {
            observeConfig.attributeFilter = observedAttrs.includes('auto') ? undefined : observedAttrs
        }

    this.observer.observe(document.documentElement, observeConfig)
    }

    private collectObservedAttributes(): string[] {
        if (!this.plan) return []
        const attrs = new Set<string>()
        for (const smart of this.plan.smartRules) {
            const runtime = smart.runtime
            if (!runtime?.observeAttributes) continue
            if (runtime.observeAttributes === 'auto') {
        attrs.add('auto')
            } else if (runtime.observeAttributes === true) {
        attrs.add('all')
            }
        }
        return Array.from(attrs)
    }

    private async scheduleReEvaluation(_ruleId: string): Promise<void> {
        if (typeof this.authorizeSmart === "undefined" || !(await this.authorizeSmart("smart-selector-update"))) return;
        void _ruleId;
        this.clearPerPageCaches()
        this.dependencyPrefilterCache = new WeakMap()
        await this.executePlan()
    }

    private async handleMutations(mutations: MutationRecord[]): Promise<void> {
        if (typeof this.authorizeSmart === "undefined" || !(await this.authorizeSmart("smart-selector-update"))) return;
        if (!this.plan) return
        if (this.mutationCycleCount > 100) return
        this.currentCycle++
        markDomGeneration()

        const hasAncestorMutation = mutations.some(m => this.checkAncestorMutationRelevance(m))
        if (hasAncestorMutation) {
            for (const [ruleId] of this.ancestorIndex) {
        await this.scheduleReEvaluation(ruleId)
            }
        } else {

        for (const m of mutations) {
            for (const node of m.removedNodes) {
                if (node instanceof HTMLIFrameElement) {
          this.onFrameRemoved(node)
                }
            }
        }

        const nodeCount = mutations.reduce((sum, m) => sum + m.addedNodes.length, 0)
        const maxNodes = 150
        if (nodeCount > maxNodes) {
            const priorityOrder = ['data-ubr-scope-boundary', 'data-ubr-scope', '', 'iframe', 'shadow-host', '']
            const relevant = mutations.filter(m => {
                for (const node of m.addedNodes) {
                    if (node instanceof Element) {
                        const pri = priorityOrder.findIndex(p => p && node.closest?.(`[${p}]`))
                        if (pri >= 0 && pri < priorityOrder.length - 2) return true
                    }
                }
                return false
            })
            if (relevant.length === 0) return
        }

    await this.executePlan()
        }
    }

    private onPathChange = async (): Promise<void> => {
        const newUrl = location.href
        if (newUrl === this.currentUrl) return
        this.currentUrl = newUrl
        if (!this.plan) return

    this.restartShadowScan()

    const hasNeverReEvaluate = this.plan.smartRules.some(s => s.runtime?.reEvaluateOnPathChange === 'never')
    if (hasNeverReEvaluate) {
      this.applier?.updateSelectors([])
      const neverIds = new Set(this.plan.smartRules.filter(s => s.runtime?.reEvaluateOnPathChange === 'never').map(s => s.rule.id))
      const reevaluating = this.plan.smartRules.filter(s => !neverIds.has(s.rule.id))
      if (reevaluating.length === 0) return
      this.skipRuleIds = neverIds
      this.clearPerPageCaches()
      await this.loadPlan(this.plan)
      this.skipRuleIds = null
      return
    }

    this.clearPerPageCaches()
    await this.loadPlan(this.plan)
    }

    private wrapHistoryAPI(): void {
        try {
            this.originalPushState = history.pushState.bind(history)
            this.originalReplaceState = history.replaceState.bind(history)

            history.pushState = (...args: any[]) => {
                const result = this.originalPushState!.apply(history, args)
        this.onPathChange()
        return result
            }

            history.replaceState = (...args: any[]) => {
                const result = this.originalReplaceState!.apply(history, args)
        this.onPathChange()
        return result
            }
        } catch (e) {
      console.warn('[uBR] smart-runtime: History API wrapping failed', e)
        }
    }

    private async startIframeObserver(): Promise<void> {
        if (typeof this.authorizeSmart === "undefined" || !(await this.authorizeSmart("smart-observe"))) return;
        if (this.iframeObserver) return
        this.iframeObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node instanceof HTMLIFrameElement) {
            (async () => { await this.onFrameAdded(node) })()
                    }
                }
            }
        })
    this.iframeObserver.observe(document.documentElement, { childList: true, subtree: true })
    }

    private async onFrameAdded(_iframe: HTMLIFrameElement): Promise<void> {
        if (typeof this.authorizeSmart === "undefined" || !(await this.authorizeSmart("smart-selector-update"))) return;
        void _iframe;
        if (!this.plan || !this.applier) return
        const hasFrameRules = this.plan.smartRules.some(s => s.frames?.mode !== 'top-only')
        if (!hasFrameRules) return
    this.restartShadowScan()
    await this.executePlan()
    }

    private onFrameRemoved(iframe: HTMLIFrameElement): void {
        const frameKey = iframe.src || iframe.id || ''
        const counter = this.frameCounters.get(frameKey)
        if (counter) {
      this.frameCounters.delete(frameKey)
        }
    }

    private hookAttachShadow(): void {
        if (typeof Element === 'undefined' || !Element.prototype) return
        const originalAttachShadow = Element.prototype.attachShadow
        if ((originalAttachShadow as any).__ubrHooked) return
        const self = this
        this.originalAttachShadow = originalAttachShadow
        Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
            const shadowRoot = originalAttachShadow.call(this, init)
            if (self.initialized && self.plan && typeof self.authorizeSmart !== "undefined") {
                const host: Element = this
                self.authorizeSmart("smart-observe").then(function(authorized) {
                    if (!authorized) return;
                    if (!self.initialized || !self.plan) return;
                    for (const sr of self.plan.smartRules) {
                        if (sr.shadow?.mode !== 'none') self.traverseShadow(host, sr)
                    }
                }).catch(function() {});
            }
            return shadowRoot
        }
        ;(Element.prototype.attachShadow as any).__ubrHooked = true
    }

    private startShadowScan(): void {
        if (this.shadowScanTimer) return
        const self = this
        let emptyScans = 0
        this.shadowScanTimer = setInterval(() => {
            if (!self.plan || !self.applier) return
            if (typeof self.authorizeSmart !== "undefined") {
                self.authorizeSmart("smart-observe").then(function(authorized) {
                    if (!authorized) return;
                    if (!self.plan || !self.shadowScanTimer) return;
                    let found = false;
                    const shadowHosts = document.querySelectorAll('*');
                    for (const el of shadowHosts) {
                        if (el.shadowRoot && !el.hasAttribute('data-ubr-shadow-scanned')) {
                            el.setAttribute('data-ubr-shadow-scanned', '');
                            found = true;
                            for (const sr of self.plan.smartRules) {
                                if (sr.shadow?.mode !== 'none') self.traverseShadow(el, sr);
                            }
                        }
                    }
                    if (!found) {
                        emptyScans++;
                        if (emptyScans >= 3) {
                            clearInterval(self.shadowScanTimer!);
                            self.shadowScanTimer = null;
                        }
                    } else {
                        emptyScans = 0;
                    }
                }).catch(function() {});
            }
        }, 2000)
    }

    private restartShadowScan(): void {
        if (this.shadowScanTimer) {
            clearInterval(this.shadowScanTimer)
            this.shadowScanTimer = null
        }
    this.startShadowScan()
    }

    private clearPerPageCaches(): void {
    this.perPageCaches.clear()
    this.dependencyPrefilterCache = new WeakMap()
    this.ancestorIndex.clear()
    this.ancestorDependencySelectors.clear()
    this.ancestorAttributeNames.clear()
    this.ancestorIndexSize = 0
    }

    private trackDependencyFallback(ruleId: string): void {
        const now = Date.now()
        const existing = this.dependencyFallbackCounters.get(ruleId)
        if (!existing) {
      this.dependencyFallbackCounters.set(ruleId, { count: 1, firstTime: now })
        } else {
            existing.count++
            if (existing.count > 3 && (now - existing.firstTime) < 10000) {
        this.emitWarning?.(`rule ${ruleId}: dependency-depth fallback triggered >3x in 10s; consider increasing dependency-depth or narrowing scope/candidates`)
            }
        }
    }

    destroy(): void {
        if (this.observer) this.observer.disconnect()
        if (this.iframeObserver) this.iframeObserver.disconnect()
        if (this.shadowScanTimer) clearInterval(this.shadowScanTimer)
        if (this.applier) this.applier.destroy()
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
    window.removeEventListener('popstate', this.onPathChange)
    window.removeEventListener('hashchange', this.onPathChange)

    if (this.originalPushState) {
        history.pushState = this.originalPushState
    }
    if (this.originalReplaceState) {
        history.replaceState = this.originalReplaceState
    }
    if (this.originalAttachShadow) {
        Element.prototype.attachShadow = this.originalAttachShadow
        ;(Element.prototype.attachShadow as any).__ubrHooked = false
        this.originalAttachShadow = null
    }

    document.querySelectorAll(`[${SELF_MUTATION_MARKER}]`).forEach(el => el.removeAttribute(SELF_MUTATION_MARKER))
    this.initialized = false
    }
}

export * as Runtime from "./smart-runtime"
