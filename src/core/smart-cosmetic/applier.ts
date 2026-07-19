import { SAFE_STYLE_PROPERTIES, ALLOWED_DISPLAY_VALUES, ALLOWED_VISIBILITY_VALUES } from './smart-rule-schema'

export interface CosmeticAction {
  type: 'hide' | 'collapse' | 'remove' | 'unhide' | 'mark' | 'style'
  selector: string
  style?: string
  important?: boolean
  ruleId?: string
}

const MARK_COLORS = ['red', 'orange', 'blue']

export class CosmeticApplier {
    private styleEl: HTMLStyleElement | null = null
    private hiddenElements: Map<string, HTMLElement[]> = new Map()
    private removedElements: Map<string, { el: HTMLElement; parent: Node; nextSibling: Node | null }[]> = new Map()
    private ruleSelectors: Map<string, Set<string>> = new Map()
    private mutationObserver: MutationObserver | null = null
    private pendingSelectors: string[] = []
    private appliedSelectors: string[] = []
    private applyTimer: ReturnType<typeof setTimeout> | null = null
    private active = false
    private ariaHiddenTracker: Map<HTMLElement, { originalValue: string | null; count: number }> = new Map()
    // Original inline-style values captured before the applier touched them, so
    // rollback can restore the exact pre-extension DOM state rather than merely
    // deleting properties (which would destroy legitimate page styling).
    private originalInline: Map<HTMLElement, Map<string, { value: string | null; priority: string | null }>> = new Map()

    constructor(
        private authorizeSmart?: (action: string) => Promise<boolean>,
        private checkSmartLease?: () => boolean,
    ) {}

    async activate(selectors: string[]): Promise<void> {
        this.active = true
    this.ensureStyleElement()
    this.injectStyles(selectors, true)
    this.pendingSelectors = [...selectors]
    await this.observeMutations()
    }

    deactivate(): void {
        this.active = false
    this.clearStyles()
    this.stopObserver()
    }

    updateSelectors(selectors: string[]): void {
        const combined = [...new Set([...selectors, ...this.pendingSelectors])]
    this.clearStyles()

    if (selectors.length > 0) {
      this.ensureStyleElement()
      this.injectStyles(combined, true)
    }

    this.pendingSelectors = []
    }

    private ensureStyleElement(): void {
        if (this.styleEl) return
        this.styleEl = document.createElement('style')
        this.styleEl.id = 'ubr-smart-cosmetic'
    this.styleEl.setAttribute('data-ubr', 'smart-cosmetic')
    document.head?.appendChild(this.styleEl)
    }

    private injectStyles(selectors: string[], important: boolean = true): void {
        if (!this.styleEl) return
        this.appliedSelectors = [...selectors]
        const imp = important ? ' !important' : ''
        const css = selectors.map(s => `${s} { display: none${imp}; }`).join('\n')
        this.styleEl.textContent = css
    }

    getAppliedSelectors(): string[] {
        return [...this.appliedSelectors]
    }

    setImportant(enabled: boolean): void {
        if (this.appliedSelectors.length > 0) {
      this.injectStyles(this.appliedSelectors, enabled)
        }
    }

    private clearStyles(): void {
        if (this.styleEl) {
            this.styleEl.textContent = ''
        }
    }

    removeStyleElement(): void {
        if (this.styleEl && this.styleEl.parentNode) {
      this.styleEl.parentNode.removeChild(this.styleEl)
        }
        this.styleEl = null
    }

    private async observeMutations(): Promise<void> {
        if (typeof this.authorizeSmart === "undefined" || !(await this.authorizeSmart("smart-observe"))) return;
        if (this.mutationObserver) return
        this.mutationObserver = new MutationObserver((mutations) => {
            queueMicrotask(() => this.handleObservedMutations(mutations))
        })

    this.mutationObserver.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    })
    }

    private async handleObservedMutations(mutations: MutationRecord[]): Promise<void> {
        if (this.checkSmartLease && !this.checkSmartLease()) return
        if (typeof this.authorizeSmart === "undefined" || !(await this.authorizeSmart("smart-selector-update"))) return
        let needsReapply = false
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
        needsReapply = true
        break
            }
        }
        if (needsReapply && this.active && this.pendingSelectors.length > 0) {
        this.debouncedReapply()
        }
    }

    private stopObserver(): void {
        if (this.mutationObserver) {
      this.mutationObserver.disconnect()
      this.mutationObserver = null
        }
    }

    private debouncedReapply(): void {
        if (this.applyTimer) clearTimeout(this.applyTimer)
        this.applyTimer = setTimeout(() => {
            if (this.active && this.pendingSelectors.length > 0) {
        this.injectStyles(this.pendingSelectors, true)
            }
        }, 200)
    }

    async executeActions(actions: CosmeticAction[]): Promise<void> {
        if (typeof this.authorizeSmart === "undefined" || !(await this.authorizeSmart("smart-selector-update"))) return;
        for (const action of actions) {
      this.executeAction(action)
      if (action.ruleId) {
          const selectors = this.ruleSelectors.get(action.ruleId) ?? new Set()
        selectors.add(action.selector)
        this.ruleSelectors.set(action.ruleId, selectors)
      }
        }
    }

    private executeAction(action: CosmeticAction): void {
        try {
            const elements = document.querySelectorAll(action.selector) as NodeListOf<HTMLElement>
            const priority: string | undefined = action.important !== false ? 'important' : undefined

            switch (action.type) {
            case 'hide':
                for (const el of elements) {
            this.setInlineProp(el, 'display', 'none', priority)
            this.setAriaHidden(el, action.ruleId)
            if (!this.hiddenElements.has(action.selector)) {
              this.hiddenElements.set(action.selector, [])
            }
            this.hiddenElements.get(action.selector)!.push(el)
                }
                break

            case 'collapse':
                for (const el of elements) {
            this.setInlineProp(el, 'display', 'none', priority)
            this.setInlineProp(el, 'height', '0', priority)
            this.setInlineProp(el, 'overflow', 'hidden', priority)
            this.setAriaHidden(el, action.ruleId)
            if (!this.hiddenElements.has(action.selector)) {
              this.hiddenElements.set(action.selector, [])
            }
            this.hiddenElements.get(action.selector)!.push(el)
                }
                break

            case 'remove':
                for (const el of elements) {
            this.setAriaHidden(el, action.ruleId)
            const parent = el.parentNode
            const nextSibling = el.nextSibling
            el.remove()
            if (!this.removedElements.has(action.selector)) {
              this.removedElements.set(action.selector, [])
            }
            // Retain position metadata so rollback can reinsert the element
            // exactly where it was removed from (audit Item 3).
            this.removedElements.get(action.selector)!.push({
              el,
              parent: parent as Node,
              nextSibling: nextSibling as Node | null,
            })
                }
                break

            case 'unhide':
          this.restoreHidden(action.selector)
                break

            case 'style':
                for (const el of elements) {
                    if (action.style) {
                        this.applySafeStyle(el, action.style, priority)
                    }
                }
                break

            case 'mark':
                for (const el of elements) {
            el.setAttribute('data-ubr-marked', 'true')
            const existing = parseInt(el.getAttribute('data-ubr-mark-count') || '0', 10)
            const count = existing + 1
            el.setAttribute('data-ubr-mark-count', String(count))
            const color = MARK_COLORS[Math.min(count - 1, MARK_COLORS.length - 1)]
            const existingOutline = el.style.outline
            const mergeOutline = action.ruleId ? this.ruleSelectors.get(action.ruleId)?.has(action.selector) : false
            if (existingOutline && existingOutline !== 'none' && mergeOutline) {
              this.setInlineProp(el, 'outline', `${existingOutline} double ${color}`, priority)
            } else {
              this.setInlineProp(el, 'outline', `3px solid ${color}`, priority)
            }
                }
                break
            }
        } catch (e) {
      console.warn('[uBR] applier: executeAction style set failed', e)
        }
    }

    private applyAction(action: CosmeticAction): void {
    this.executeAction(action)
    }

    private setAriaHidden(el: HTMLElement, ruleId?: string): void {
        const existing = this.ariaHiddenTracker.get(el)
        if (existing) {
            existing.count++
            return
        }
        const originalValue = el.getAttribute('aria-hidden')
    this.ariaHiddenTracker.set(el, { originalValue, count: 1 })
    el.setAttribute('aria-hidden', 'true')
    el.setAttribute('data-ubr-aria-hidden', ruleId ?? '')
    }

    private restoreAriaHidden(el: HTMLElement): void {
        const tracked = this.ariaHiddenTracker.get(el)
        if (!tracked) return
        tracked.count--
        if (tracked.count > 0) return
    this.ariaHiddenTracker.delete(el)
    el.removeAttribute('data-ubr-aria-hidden')
    if (tracked.originalValue === null) {
      el.removeAttribute('aria-hidden')
    } else {
      el.setAttribute('aria-hidden', tracked.originalValue)
    }
    }

    private restoreHidden(selector: string): void {
        const elements = this.hiddenElements.get(selector)
        if (elements) {
            for (const el of elements) {
        this.restoreInline(el)
        this.restoreAriaHidden(el)
            }
      this.hiddenElements.delete(selector)
        }

        const css = this.styleEl?.textContent || ''
        const regex = new RegExp(`${escapeRegex(selector)  }\\s*\\{[^}]+\\}`, 'g')
        if (this.styleEl) {
            this.styleEl.textContent = css.replace(regex, '')
        }
    }

    // Capture the previous value/priority of an inline style property the first
    // time we set it, so rollback can restore the exact pre-extension value.
    private setInlineProp(el: HTMLElement, prop: string, value: string, priority?: string): void {
        let elMap = this.originalInline.get(el)
        if (!elMap) {
            elMap = new Map()
            this.originalInline.set(el, elMap)
        }
        if (!elMap.has(prop)) {
            const existing = el.style.getPropertyValue(prop)
            const existingPriority = el.style.getPropertyPriority(prop)
            elMap.set(prop, { value: existing || null, priority: existingPriority || null })
        }
        el.style.setProperty(prop, value, priority)
    }

    private restoreInline(el: HTMLElement): void {
        const elMap = this.originalInline.get(el)
        if (!elMap) return
        for (const [prop, orig] of elMap) {
            if (orig.value === null) {
                el.style.removeProperty(prop)
            } else {
                el.style.setProperty(prop, orig.value, orig.priority || undefined)
            }
        }
        this.originalInline.delete(el)
    }

    // Reinsert elements that were removed, restoring them to their original
    // parent and sibling position (audit Item 3).
    private restoreRemoved(selector: string): void {
        const entries = this.removedElements.get(selector)
        if (!entries) return
        for (const { el, parent, nextSibling } of entries) {
            try {
                if (parent) {
                    if (nextSibling && nextSibling.parentNode === parent) {
                        parent.insertBefore(el, nextSibling)
                    } else {
                        parent.appendChild(el)
                    }
                }
            } catch { /* element may already be detached/reattached */ }
            this.restoreAriaHidden(el)
            this.restoreInline(el)
        }
        this.removedElements.delete(selector)
    }

    destroy(): void {
    this.deactivate()
    this.restoreAll()
    this.removedElements.clear()
    this.hiddenElements.clear()
    this.ariaHiddenTracker.clear()
    this.originalInline.clear()
    this.ruleSelectors.clear()
    this.pendingSelectors = []
    if (this.applyTimer) clearTimeout(this.applyTimer)
    }

    // Restore every applied mutation before tearing down.  Revocation must not
    // leave page modifications behind: hidden/collapsed elements return to
    // their exact pre-extension inline styles, removed elements are reinserted
    // at their original position, aria-hidden is reverted, and smart mark
    // outlines/attributes are removed (restoring the original outline).
    restoreAll(): void {
    for (const selector of [...this.hiddenElements.keys()]) {
        this.restoreHidden(selector)
    }
    for (const selector of [...this.removedElements.keys()]) {
        this.restoreRemoved(selector)
    }
    for (const el of document.querySelectorAll('[data-ubr-marked]')) {
        el.removeAttribute('data-ubr-marked')
        el.removeAttribute('data-ubr-mark-count')
        this.restoreInline(el as HTMLElement)
    }
    for (const [el, tracked] of this.ariaHiddenTracker) {
        el.removeAttribute('data-ubr-aria-hidden')
        if (tracked.originalValue === null) {
        el.removeAttribute('aria-hidden')
        } else {
        el.setAttribute('aria-hidden', tracked.originalValue)
        }
    }
    }

    cleanupRule(ruleId: string): void {
        const selectors = this.ruleSelectors.get(ruleId)
        if (selectors) {
            for (const sel of selectors) {
        this.restoreHidden(sel)
        this.restoreRemoved(sel)
            }
      this.ruleSelectors.delete(ruleId)
        }
    }

    private applySafeStyle(el: HTMLElement, styleStr: string, important: boolean = true): void {
        const decls = styleStr.split(';').filter(Boolean)
        for (const decl of decls) {
            const colonIdx = decl.indexOf(':')
            if (colonIdx === -1) continue
            const prop = decl.slice(0, colonIdx).trim().toLowerCase()
            const value = decl.slice(colonIdx + 1).trim()

            if (!SAFE_STYLE_PROPERTIES.has(prop)) continue

            if (prop === 'display' && !ALLOWED_DISPLAY_VALUES.has(value)) continue
            if (prop === 'visibility' && !ALLOWED_VISIBILITY_VALUES.has(value)) continue
            if (prop === 'filter' && (value.includes('%') || value.includes('url(') || value.includes('var('))) continue

            this.setInlineProp(el, prop, value, important ? 'important' : undefined)
        }
    }
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export * as Applier from "./applier"
