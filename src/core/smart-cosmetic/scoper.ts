import type { Boundary } from './smart-rule-schema'

export interface ScopeResult {
  elements: Element[]
  scoped: boolean
  stoppedEarly: boolean
}

export interface BoundaryCandidate {
  element: Element
  depth: number
  score: number
  featureScores: BoundaryFeatureScores
}

export interface ScopeDiagnostic {
  mode: string
  ancestorCount: number
  bestScore: number
  features: BoundaryFeatureScores
  stoppedEarly: boolean
  selectedDepth: number
  fallbackUsed: boolean
  allowBroad?: boolean
}

export interface BoundaryFeatureScores {
  semanticTagOrRole: number
  candidateSelectorMatch: number
  repeatedSibling: number
  selfContainedText: number
  geometryCompactness: number
  linkButtonCoherence: number
  stableAttributes: number
}

const SEMANTIC_TAGS = new Set(['article', 'section', 'li', 'main', 'aside', 'nav'])
const SEMANTIC_ROLES = new Set(['article', 'listitem', 'complementary', 'main', 'feed'])
const MEANINGFUL_DATA_KEYS = ['data-testid', 'data-test', 'data-uid', 'data-component', 'data-block', 'data-card', 'data-module']

const BOUNDARY_WEIGHTS = {
  semanticTagOrRole: 0.20,
  candidateSelectorMatch: 0.15,
  repeatedSibling: 0.25,
  selfContainedText: 0.10,
  geometryCompactness: 0.15,
  linkButtonCoherence: 0.05,
  stableAttributes: 0.10,
}

const MODE_THRESHOLDS: Record<string, { minScore: number; extra: ((_: BoundaryFeatureScores) => boolean) | null }> = {
  'nearest-card': { minScore: 0.55, extra: null },
  'repeated-card': { minScore: 0.65, extra: (_s) => _s.repeatedSibling >= 0.60 },
  'semantic-block': { minScore: 0.50, extra: (_s) => _s.semanticTagOrRole > 0 },
  'visual-block': { minScore: 0.60, extra: (_s) => _s.geometryCompactness >= 0.50 },
}

let boundaryCache = new WeakMap<Element, { element: Element; diagnostic?: ScopeDiagnostic }>()

export function markDomGeneration(): void {
    // WeakMap clears automatically when elements are GC'd, no manual clear needed
}

export function resolveBoundary(
    el: Element,
    boundary: Boundary | undefined,
    candidates?: string[],
): { element: Element; diagnostic?: ScopeDiagnostic } {
    if (!boundary || boundary.mode === 'exact') return { element: el }

    if (!boundary.allowBroad) {
        const tag = el.tagName.toLowerCase()
        if (tag === 'html' || tag === 'body') return { element: el }
    }

    const cached = boundaryCache.get(el)
    if (cached && document.contains(el)) return cached

    let ancestors = enumerateAncestors(el, boundary)
    if (ancestors.length === 0) return { element: el }

    // includeSelf adds the target element itself as a boundary candidate (selector mode only)
    if (boundary.includeSelf && boundary.mode === 'selector') {
        ancestors = [el, ...ancestors]
    }

    const mode = boundary.mode
    const threshold = MODE_THRESHOLDS[mode]

    const scored = ancestors.map(anc => ({
    element: anc,
    depth: getDepth(el, anc),
    ...scoreBoundaryCandidate(anc, mode, candidates),
    }))

  scored.sort((a, b) => {
      if (Math.abs(b.score - a.score) > 0.03) return b.score - a.score
      if (a.depth !== b.depth) return a.depth - b.depth
      if (b.featureScores.semanticTagOrRole !== a.featureScores.semanticTagOrRole) {
          return b.featureScores.semanticTagOrRole - a.featureScores.semanticTagOrRole
      }
      return compareDocumentPosition(a.element, b.element)
  })

  const best: Element = threshold && scored[0]?.score >= threshold.minScore
      ? (!threshold.extra || threshold.extra(scored[0].featureScores))
          ? scored[0].element
          : fallbackBoundary(scored, threshold)
      : el

  const fallbackUsed = best !== (scored[0]?.element || el)
  const selectedDepth = ancestors.findIndex(a => a === best) + 1 || 0
  const maxDepth = boundary.maxDepth ?? 8
  const stoppedEarly = ancestors.length >= maxDepth

  const result: { element: Element; diagnostic?: ScopeDiagnostic } = {
    element: best,
    diagnostic: {
      mode: boundary.mode,
      ancestorCount: ancestors.length,
      bestScore: scored[0]?.score ?? 0,
      features: scored[0]?.featureScores ?? {
        semanticTagOrRole: 0,
        candidateSelectorMatch: 0,
        repeatedSibling: 0,
        selfContainedText: 0,
        geometryCompactness: 0,
        linkButtonCoherence: 0,
        stableAttributes: 0,
      },
      stoppedEarly,
      selectedDepth,
      fallbackUsed,
      allowBroad: boundary?.allowBroad ?? false,
    },
  }

  boundaryCache.set(el, result)
  return result
}

function fallbackBoundary(
    scored: BoundaryCandidate[],
    threshold: { minScore: number; extra: ((_s: BoundaryFeatureScores) => boolean) | null },
): Element {
    for (const s of scored) {
        if (s.score >= threshold.minScore && (!threshold.extra || threshold.extra(s.featureScores))) {
            return s.element
        }
    }
    return scored[0]?.element
}

function compareDocumentPosition(a: Element, b: Element): number {
    const pos = a.compareDocumentPosition(b)
    return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
}

export function isScopeRootSentinel(el: Element): boolean {
    const tag = el.tagName.toLowerCase()
    if (tag === 'body' || tag === 'main') return true
    const role = el.getAttribute('role')
    if (role === 'main' || role === 'feed') return true
    if (tag === 'ul' || tag === 'ol') {
        const items = el.querySelectorAll(':scope > li')
        if (items.length >= 15) return true
    }
    if (el.matches?.('[data-feed], [data-list], [role="list"]')) return true
    if (el.classList.contains('feed') || el.id === 'feed' || el.id.match?.(/feed|stream|timeline/i)) return true
    return false
}

function enumerateAncestors(el: Element, boundary: Boundary): Element[] {
    const ancestors: Element[] = []
    const maxDepth = boundary.maxDepth ?? 8
    let current: Element | null = el.parentElement
    let depth = 0

    while (current && depth < maxDepth) {
        const tag = current.tagName.toLowerCase()
        if (tag === 'html' || tag === 'body') {
            if (boundary.stopAtScope !== false && !boundary.allowPageRoot) break
        }
        if (boundary.stopAtScope !== false && current.hasAttribute?.('data-ubr-scope-boundary')) break
        if (!boundary.allowScopeRoot && isScopeRootSentinel(current)) break
        if (boundary.allowCrossScope && current.hasAttribute?.('data-ubr-scope-cross')) {
            ancestors.push(current)
            current = current.parentElement
            depth++
            continue
        }
        ancestors.push(current)
        current = current.parentElement
        depth++
    }

    if (boundary.mode === 'ancestor-depth' && boundary.depth !== undefined) {
        const target = ancestors[boundary.depth - 1]
        return target ? [target] : ancestors
    }

    if (boundary.mode === 'selector' && boundary.selector) {
        const matched = ancestors.find(a => a.matches?.(boundary.selector!))
        return matched ? [matched] : ancestors
    }

    return ancestors
}

function getDepth(from: Element, to: Element): number {
    let depth = 0
    let current: Element | null = from
    while (current && current !== to) {
        current = current.parentElement
        depth++
    }
    return depth
}

export function scoreBoundaryCandidate(
    el: Element,
    mode: string,
    candidates?: string[],
): { score: number; featureScores: BoundaryFeatureScores } {
    const featureScores: BoundaryFeatureScores = {
    semanticTagOrRole: scoreSemanticTagOrRole(el),
    candidateSelectorMatch: candidates ? scoreCandidateSelectorMatch(el, candidates) : 0,
    repeatedSibling: scoreRepeatedSibling(el),
    selfContainedText: scoreSelfContainedText(el),
    geometryCompactness: scoreGeometryCompactness(el),
    linkButtonCoherence: scoreLinkButtonCoherence(el),
    stableAttributes: scoreStableAttributes(el),
    }

    let weightedSum = 0
    let applicableWeight = 0

    for (const [key, weight] of Object.entries(BOUNDARY_WEIGHTS)) {
        const score = featureScores[key as keyof BoundaryFeatureScores]
        if (score >= 0) {
            weightedSum += weight * score
            applicableWeight += weight
        }
    }

    const score = applicableWeight > 0 ? weightedSum / applicableWeight : 0

    return { score, featureScores }
}

function scoreSemanticTagOrRole(el: Element): number {
    const tag = el.tagName.toLowerCase()
    const role = el.getAttribute('role')

    if (SEMANTIC_TAGS.has(tag) || (role && SEMANTIC_ROLES.has(role))) return 1.0
    if (tag === 'div' || tag.startsWith('u')) {
        const meaningfulData = MEANINGFUL_DATA_KEYS.some(k => el.hasAttribute(k))
        if (meaningfulData) {
            const label = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')
            if (label) return 0.75
        }
    }
    if (tag === 'div' || tag.startsWith('u')) {
        const hasData = Array.from(el.attributes).some(a => a.name.startsWith('data-') && isMeaningfulDataValue(a.value))
        if (hasData) return 0.50
    }
    return 0
}

function scoreCandidateSelectorMatch(el: Element, candidates: string[]): number {
    for (const sel of candidates) {
        try {
            if (el.matches?.(sel)) return 1.0
        } catch (e) {
      console.warn('[uBR] scoper: el.matches failed for candidate selector', sel, e)
        }
    }
    return 0
}

function scoreRepeatedSibling(el: Element): number {
    const parent = el.parentElement
    if (!parent) return 0

    const siblings = Array.from(parent.children).filter(c => c !== el)
    if (siblings.length < 2) return 0

    let maxSimilarity = 0
    for (const sibling of siblings) {
        const sim = computeSiblingSimilarity(el, sibling)
        if (sim > maxSimilarity) maxSimilarity = sim
    }

    return Math.min(maxSimilarity, 1.0)
}

const MAJOR_TAGS = new Set(['a', 'button', 'img', 'video', 'picture', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div', 'ul', 'ol', 'li'])

function computeSiblingSimilarity(a: Element, b: Element): number {
    const sigA = getSiblingSignature(a)
    const sigB = getSiblingSignature(b)

    let matches = 0
    let total = 0

    for (const [key, valA] of Object.entries(sigA)) {
        total++
        const valB = sigB[key]
        if (valB !== undefined && valA === valB) matches++
    }

    return total > 0 ? matches / total : 0
}

function getSiblingSignature(el: Element): Record<string, number> {
    const tag = el.tagName.toLowerCase()
    const role = el.getAttribute('role') || ''
    const meaningfulDataAttrs = Array.from(el.attributes)
    .filter(a => a.name.startsWith('data-') && isMeaningfulDataValue(a.value))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(a => `${a.name}=${a.value.slice(0, 20)}`)
    .join('|')

    const tagHistogram: Record<string, number> = {}
    for (const child of el.children) {
        const t = child.tagName.toLowerCase()
        if (MAJOR_TAGS.has(t)) {
            tagHistogram[t] = (tagHistogram[t] || 0) + 1
        }
    }
    const childTagKeys = Array.from(new Set(Object.keys(tagHistogram))).sort()
    const childTagProfile = childTagKeys.map(k => `${k}:${bucketCount(tagHistogram[k], [0, 1, 2, 4, 8, Infinity])}`).join('|')

    const text = (el.textContent || '').trim()
    const textLen = text.length
    const links = el.querySelectorAll('a').length
    const buttons = el.querySelectorAll('button').length
    const images = el.querySelectorAll('img, picture').length

    return {
    tag: tag.charCodeAt(0),
    role: role.length,
    dataAttrs: meaningfulDataAttrs.length,
    textLen: bucketCount(textLen, [0, 1, 39, 159, 399, 899, 1999, Infinity]),
    childTags: childTagProfile.length,
    links: bucketCount(links, [0, 1, 2, 4, 8, 16, Infinity]),
    buttons: bucketCount(buttons, [0, 1, 2, 4, 8, Infinity]),
    images: bucketCount(images, [0, 1, 2, 4, 8, Infinity]),
    }
}

function bucketCount(value: number, buckets: number[]): number {
    for (let i = 0; i < buckets.length; i++) {
        if (value <= buckets[i]) return i
    }
    return buckets.length - 1
}

function isMeaningfulDataValue(value: string): boolean {
    if (value.length < 2 || value.length > 80) return false
    if (isGeneratedClass(value)) return false
    if (/(\w{20,})/.test(value)) return false
    return true
}

function isGeneratedClass(value: string): boolean {
    if (value.length < 6) return false
    let digitCount = 0
    for (const ch of value) {
        if (ch >= '0' && ch <= '9') digitCount++
    }
    return digitCount / value.length > 0.40
}

const scopeRootCache: WeakMap<Element, Element | null> = new WeakMap()

function findScopeRoot(el: Element): Element | null {
    const cached = scopeRootCache.get(el)
    if (cached !== undefined) return cached

    let root: Element | null = null
    let current: Element | null = el
    while (current) {
        if (current.hasAttribute?.('data-ubr-scope-boundary')) {
            root = current
            break
        }
        current = current.parentElement
    }

  scopeRootCache.set(el, root)
  return root
}

function scoreSelfContainedText(el: Element): number {
    const chars = normalizeTextLength(el)
    const scopeRoot = findScopeRoot(el)
    const scopeChars = scopeRoot ? normalizeTextLength(scopeRoot) : 0

    if (scopeChars === 0) return 0

    const ratio = chars / scopeChars
    if (chars >= 40 && chars <= 1200 && ratio <= 0.35) return 1.0
    if ((chars >= 10 && chars < 40) || (chars > 1200 && chars <= 2500)) return 0.50
    return 0
}

function normalizeTextLength(el: Element): number {
    const clone = el.cloneNode(true) as Element
    const scripts = clone.querySelectorAll('script, style, template')
    for (const s of scripts) s.remove()
    const text = (clone.textContent || '').replace(/\s+/g, ' ').trim()
    return text.length
}

function scoreGeometryCompactness(el: Element): number {
    let rect: DOMRect
    try {
        rect = el.getBoundingClientRect()
    } catch (e) {
    console.warn('[uBR] scoper: getBoundingClientRect failed', e)
    return 0
    }

    if (rect.width === 0 || rect.height === 0) return 0

    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return 0

    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    const viewportArea = viewportW * viewportH
    if (viewportArea === 0) return 0

    const area = rect.width * rect.height
    const areaRatio = area / viewportArea
    const aspect = rect.width / Math.max(rect.height, 1)

    if (areaRatio >= 0.001 && areaRatio <= 0.40 && aspect >= 0.2 && aspect <= 8.0) return 1.0
    if (areaRatio <= 0.60) return 0.50
    return 0
}

function scoreLinkButtonCoherence(el: Element): number {
    const links = el.querySelectorAll('a').length
    const buttons = el.querySelectorAll('button').length
    const interactive = links + buttons

    if (interactive >= 1 && interactive <= 8) return 1.0
    if (interactive >= 9 && interactive <= 20) return 0.50
    return 0
}

function scoreStableAttributes(el: Element): number {
    const id = el.id
    if (id && id.length > 0 && !/^[a-f0-9]{8,}$/i.test(id)) return 1.0

    const hasStableData = Array.from(el.attributes).some(
        a => a.name.startsWith('data-') && isMeaningfulDataValue(a.value),
    )
    if (hasStableData) return 1.0

    const hasAria = Array.from(el.attributes).some(a => a.name.startsWith('aria-'))
    if (hasAria) return 1.0

    const role = el.getAttribute('role')
    const tag = el.tagName.toLowerCase()
    if (role || SEMANTIC_TAGS.has(tag)) return 0.50

    return 0
}

export function findCommonContainer(
    elements: Element[],
    mode: string = 'semantic-block',
): Element | null {
    if (elements.length === 0) return null

    const uniqueParents = new Set<Element>()
    for (const el of elements) {
        const scored = scoreBoundaryCandidate(el, mode)
        if (scored.featureScores.semanticTagOrRole > 0) {
      uniqueParents.add(el)
        }
    }

    if (uniqueParents.size === 1) return uniqueParents.values().next().value

    let common = elements[0].parentElement
    for (let i = 1; i < elements.length && common; i++) {
        while (common && !common.contains(elements[i])) {
            common = common.parentElement
        }
    }
    return common
}

export function isElementVisible(el: Element): boolean {
    const style = window.getComputedStyle(el)
    if (style.display === 'none') return false
    if (style.visibility === 'hidden') return false
    if (parseFloat(style.opacity) === 0) return false
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    return true
}

export function getVisibleElements(elements: Element[]): Element[] {
    return elements.filter(isElementVisible)
}

export * as Scoper from './scoper'
