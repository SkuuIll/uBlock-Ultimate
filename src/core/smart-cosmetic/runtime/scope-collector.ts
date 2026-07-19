export function collectScopeElements(
    scopes?: string[],
): Element[] {
    if (!scopes || scopes.length === 0) {
        return [document.documentElement]
    }

    const elements: Element[] = []
    const seen = new Set<Element>()

    for (const scope of scopes) {
        try {
            const found = document.querySelectorAll(scope)
            for (const el of found) {
                if (!seen.has(el)) {
          seen.add(el)
          elements.push(el)
                }
            }
        } catch (e) {
      console.warn('[uBR] scope-collector: collectScopeCandidates querySelectorAll failed', scope, e)
      continue
        }
    }

    return elements
}

export function isInScope(
    element: Element,
    scopes: string[],
): boolean {
    if (!scopes || scopes.length === 0) return true

    for (const scope of scopes) {
        try {
            if (element.matches(scope)) return true
            if (element.closest(scope)) return true
        } catch (e) {
      console.warn('[uBR] scope-collector: isInScope selector match failed', scope, e)
      continue
        }
    }

    return false
}

export function expandToScopeRoot(
    element: Element,
    scopes: string[],
): Element {
    if (!scopes || scopes.length === 0) return element

    let current: Element | null = element
    let best: Element = element

    while (current) {
        for (const scope of scopes) {
            try {
                if (current.matches(scope)) {
                    best = current
                }
            } catch (e) {
        console.warn('[uBR] scope-collector: expandToScopeRoot matches failed', scope, e)
            }
        }
        current = current.parentElement
    }

    return best
}

export * as ScopeCollector from './scope-collector'
