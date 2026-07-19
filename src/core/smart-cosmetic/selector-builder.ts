const cssEscape = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? (s: string) => CSS.escape(s)
    : (s: string) => s.replace(/[!"#$%&'()*+,./:;<=>?@[\]^`{|}~]/g, '\\$&')

export interface SelectorOptions {
  preferId?: boolean
  preferDataAttrs?: boolean
  maxDepth?: number
  useNthChild?: boolean
}

export interface ElementDescriptor {
  tagName: string
  id: string | null
  classList: string[]
  attributes: Record<string, string>
  nthChild: number
  depth: number
  textSnippet: string
  childCount: number
}

export function describeElement(el: Element): ElementDescriptor {
    const id = el.id || null
    const classList = Array.from(el.classList)
    const attributes: Record<string, string> = {}
    for (const attr of el.attributes) {
        if (attr.name !== 'id' && attr.name !== 'class' && !attr.name.startsWith('on')) {
            attributes[attr.name] = attr.value
        }
    }
    const parent = el.parentElement
    let nthChild = 1
    if (parent) {
        const siblings = parent.children
        nthChild = Array.from(siblings).indexOf(el) + 1
    }
    const textContent = (el.textContent || '').trim().slice(0, 80)
    return {
    tagName: el.tagName.toLowerCase(),
    id,
    classList,
    attributes,
    nthChild,
    depth: calculateDepth(el, 0),
    textSnippet: textContent,
    childCount: el.children.length,
    }
}

function calculateDepth(el: Element, depth: number): number {
    if (!el.parentElement || el.parentElement === el.ownerDocument?.body) return depth
    return calculateDepth(el.parentElement, depth + 1)
}

export function buildSelector(desc: ElementDescriptor, options: SelectorOptions = {}): string {
    const { preferId = true, preferDataAttrs = false, useNthChild = false } = options

    if (preferId && desc.id) {
        return `#${cssEscape(desc.id)}`
    }

    let sel = desc.tagName

    if (desc.classList.length > 0) {
        const classes = desc.classList.slice(0, 3).map(c => `.${cssEscape(c)}`).join('')
        sel += classes
    }

    if (preferDataAttrs) {
        for (const [name, value] of Object.entries(desc.attributes)) {
            if (name.startsWith('data-') && value.length > 0 && value.length < 100) {
                sel += `[${name}="${cssEscape(value)}"]`
                break
            }
        }
    }

    if (useNthChild || sel === desc.tagName) {
        sel += `:nth-child(${desc.nthChild})`
    }

    return sel
}

export function buildUniqueSelector(el: Element, options: SelectorOptions = {}): string {
    const parts: string[] = []
    let current: Element | null = el
    let depth = 0
    const maxDepth = options.maxDepth || 4

    while (current && current !== document.body && current !== document.documentElement && depth < maxDepth) {
        const desc = describeElement(current)
        const part = buildSelector(desc, { ...options, useNthChild: true })
    parts.unshift(part)
    current = current.parentElement
    depth++
    }

    return parts.join(' > ')
}

export function getCandidateElements(scope: string | string[]): Element[] {
    const selectors = Array.isArray(scope) ? scope : [scope]
    const results = new Set<Element>()

    for (const sel of selectors) {
        const elements = document.querySelectorAll(sel)
        for (const el of elements) {
      results.add(el)
        }
    }

    return Array.from(results)
}

export function findCommonParent(elements: Element[]): Element | null {
    if (elements.length === 0) return null
    if (elements.length === 1) return elements[0].parentElement

    const ancestors = getAncestors(elements[0])
    for (const ancestor of ancestors) {
        if (elements.every(el => ancestor.contains(el) || ancestor === el)) {
            return ancestor
        }
    }
    return null
}

function getAncestors(el: Element): Element[] {
    const ancestors: Element[] = []
    let current: Element | null = el.parentElement
    while (current) {
    ancestors.push(current)
    current = current.parentElement
    }
    return ancestors
}

export function escapeSelector(sel: string): string {
    return cssEscape(sel)
}

export * as SelectorBuilder from './selector-builder'
