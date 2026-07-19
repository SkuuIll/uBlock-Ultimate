export interface CandidateCollectOptions {
  maxCandidates?: number
  filterVisible?: boolean
  deduplicate?: boolean
}

export function collectCandidates(
    selectors: string[],
    options: CandidateCollectOptions = {},
): Element[] {
    const {
        maxCandidates = 300,
        filterVisible = false,
        deduplicate = true,
    } = options

    const elements: Element[] = []
    const seen = deduplicate ? new Set<Element>() : null

    for (const sel of selectors) {
        if (elements.length >= maxCandidates) break
        try {
            const found = document.querySelectorAll(sel)
            for (const el of found) {
                if (elements.length >= maxCandidates) break
                if (seen && seen.has(el)) continue
                if (filterVisible && !isElementVisible(el)) continue
                if (seen) seen.add(el)
        elements.push(el)
            }
        } catch (e) {
      console.warn('[uBR] candidate-collector: collectCandidates querySelectorAll failed', sel, e)
      continue
        }
    }

    return elements
}

function isElementVisible(el: Element): boolean {
    try {
        const style = window.getComputedStyle(el)
        if (style.display === 'none') return false
        if (style.visibility === 'hidden') return false
        const rect = el.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return false
    } catch (e) {
    console.warn('[uBR] candidate-collector: isElementVisible failed', e)
    return false
    }
    return true
}

export function collectShadowCandidates(
    selectors: string[],
    root: Document | ShadowRoot = document,
): Element[] {
    const elements: Element[] = []
    for (const sel of selectors) {
        try {
            const found = root.querySelectorAll(sel)
      elements.push(...Array.from(found))
        } catch (e) {
      console.warn('[uBR] candidate-collector: collectShadowCandidates querySelectorAll failed', sel, e)
      continue
        }
    }
    return elements
}

export * as CandidateCollector from './candidate-collector'
