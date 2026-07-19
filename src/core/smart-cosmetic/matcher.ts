import type { WeightProfile } from './smart-rule-schema'
import { DEFAULT_WEIGHT_PROFILES } from './smart-rule-schema'

export interface FeatureVector {
  tagName: string
  role: string | null
  id: string | null
  classList: string[]
  classIsGenerated: boolean[]
  attributes: Record<string, string>
  nthChild: number
  depth: number
  childCount: number
  textTokens: string[]
  ownText: string[]
  semanticTextTokens: string[]
  descendantLinks: Array<{ host: string; pathTokens: string[]; queryKeys: string[] }>
  ariaValues: string[]
  childTagHistogramDepth1: Record<string, number>
  childTagHistogramDepth2: Record<string, number>
  linkCount: number
  buttonCount: number
  imageCount: number
  textLengthBucket: number
  linkDensityBucket: number
  widthBucket: number
  heightBucket: number
  areaBucket: number
  aspectRatioBucket: number
  hRegion: 'left' | 'center' | 'right' | 'full'
  vOrder: 'first' | 'middle' | 'last' | 'q1' | 'q2' | 'q3' | 'q4'
}

export interface SimFeatureScores {
  roleTag: number
  textTokens: number
  semanticText: number
  href: number
  dataAttrs: number
  aria: number
  structure: number
  visualBox: number
  classes: number
  nthChild: number
}

export interface SimResult {
  score: number
  availableWeight: number
  totalWeight: number
  features: SimFeatureScores
}

const TEXT_LENGTH_BUCKETS = [0, 1, 39, 159, 399, 899, 1999, Infinity]
const LINK_BUCKETS = [0, 1, 2, 4, 8, 16, Infinity]
const BUTTON_BUCKETS = [0, 1, 2, 4, 8, Infinity]
const IMAGE_BUCKETS = [0, 1, 2, 4, 8, Infinity]
const WIDTH_RATIO_BUCKETS = [0, 0.15, 0.35, 0.65, 0.95, Infinity]
const HEIGHT_RATIO_BUCKETS = [0, 0.10, 0.25, 0.50, 0.90, Infinity]
const AREA_RATIO_BUCKETS = [0, 0.001, 0.01, 0.05, 0.15, 0.40, 0.60, Infinity]
const ASPECT_BUCKETS = [0, 0.2, 0.5, 1.5, 3.0, 8.0, Infinity]

export function computeSimilarity(
    candidate: FeatureVector,
    reference: FeatureVector,
    profile: WeightProfile = 'default-card',
): SimResult {
    const weights = DEFAULT_WEIGHT_PROFILES[profile]
    const features = computeFeatureScores(candidate, reference)

    let availableWeight = 0
    let weightedSum = 0

    for (const [key, weight] of Object.entries(weights)) {
        const score = (features as any)[key]
        const avail = score >= 0 ? 1 : 0
        availableWeight += weight * avail
        weightedSum += weight * avail * score
    }

    const score = availableWeight > 0 ? weightedSum / availableWeight : 0

    return {
    score,
    availableWeight,
    totalWeight: Object.values(weights).reduce((a, b) => a + b, 0),
    features,
    }
}

function computeFeatureScores(a: FeatureVector, b: FeatureVector): SimFeatureScores {
    return {
    roleTag: computeRoleTagScore(a, b),
    textTokens: computeTextTokensScore(a, b),
    semanticText: computeSemanticTextScore(a, b),
    href: computeHrefScore(a, b),
    dataAttrs: computeDataAttrsScore(a, b),
    aria: computeAriaScore(a, b),
    structure: computeStructureScore(a, b),
    visualBox: computeVisualBoxScore(a, b),
    classes: computeClassesScore(a, b),
    nthChild: computeNthChildScore(a, b),
    }
}

function jaccard(a: string[], b: string[]): number {
    if (a.length === 0 && b.length === 0) return 1
    const setA = new Set(a)
    const setB = new Set(b)
    let intersection = 0
    for (const x of setA) if (setB.has(x)) intersection++
    const union = new Set([...setA, ...setB]).size
    return union > 0 ? intersection / union : 0
}

function computeRoleTagScore(a: FeatureVector, b: FeatureVector): number {
    if (a.tagName === b.tagName && a.role === b.role) return 1.0
    if (a.role !== null && b.role !== null) {
        const compatible = isRoleCompatible(a.role, b.role)
        if (compatible) return 0.75
    }
    if (a.tagName === b.tagName) return 0.50
    return 0
}

const COMPATIBLE_ROLES: Record<string, string[]> = {
  article: ['article', 'complementary', 'main'],
  listitem: ['listitem', 'option', 'menuitem'],
  complementary: ['complementary', 'article'],
}

function isRoleCompatible(aRole: string, bRole: string): boolean {
    if (aRole === bRole) return true
    const aCompat = COMPATIBLE_ROLES[aRole]
    return aCompat ? aCompat.includes(bRole) : false
}

function computeTextTokensScore(a: FeatureVector, b: FeatureVector): number {
    const raw = jaccard(a.textTokens, b.textTokens)
    if (a.textTokens.length < 4 && b.textTokens.length < 4) return raw * 0.75
    return raw
}

function computeSemanticTextScore(a: FeatureVector, b: FeatureVector): number {
    return jaccard(a.semanticTextTokens, b.semanticTextTokens)
}

function computeHrefScore(a: FeatureVector, b: FeatureVector): number {
    const aHosts = new Set(a.descendantLinks.map(l => l.host))
    const bHosts = new Set(b.descendantLinks.map(l => l.host))
    const aPaths = new Set(a.descendantLinks.flatMap(l => l.pathTokens))
    const bPaths = new Set(b.descendantLinks.flatMap(l => l.pathTokens))
    const aKeys = new Set(a.descendantLinks.flatMap(l => l.queryKeys))
    const bKeys = new Set(b.descendantLinks.flatMap(l => l.queryKeys))

    const pathScore = jaccard([...aPaths], [...bPaths]) * 0.50
    const hostScore = jaccard([...aHosts], [...bHosts]) * 0.30
    const queryScore = jaccard([...aKeys], [...bKeys]) * 0.20

    return pathScore + hostScore + queryScore
}

function computeDataAttrsScore(a: FeatureVector, b: FeatureVector): number {
    const aDataKeys = Object.keys(a.attributes).filter(k => k.startsWith('data-') && isMeaningfulDataAttr(a.attributes[k]))
    const bDataKeys = Object.keys(b.attributes).filter(k => k.startsWith('data-') && isMeaningfulDataAttr(b.attributes[k]))

    const nameOverlap = jaccard(aDataKeys, bDataKeys) * 0.50
    const aTokens = aDataKeys.flatMap(k => tokenizeAttrValue(a.attributes[k]))
    const bTokens = bDataKeys.flatMap(k => tokenizeAttrValue(b.attributes[k]))
    const valueOverlap = jaccard(aTokens, bTokens) * 0.50

    return nameOverlap + valueOverlap
}

function isMeaningfulDataAttr(value: string): boolean {
    if (value.length < 2 || value.length > 80) return false
    if (/^[a-f0-9]{8,}$/i.test(value)) return false
    if (/(\w{20,})/.test(value)) return false
    return true
}

function tokenizeAttrValue(value: string): string[] {
    return value.split(/[-\s_:/.]+/).filter(t => t.length > 0)
}

function computeAriaScore(a: FeatureVector, b: FeatureVector): number {
    const aTokens = a.ariaValues.flatMap(v => v.split(/\s+/).filter(Boolean))
    const bTokens = b.ariaValues.flatMap(v => v.split(/\s+/).filter(Boolean))
    return jaccard(aTokens, bTokens)
}

function computeStructureScore(a: FeatureVector, b: FeatureVector): number {
    const fields: Array<{ a: Record<string, number> | number; b: Record<string, number> | number }> = [
    { a: a.childTagHistogramDepth1, b: b.childTagHistogramDepth1 },
    { a: a.childTagHistogramDepth2, b: b.childTagHistogramDepth2 },
    ]

    let totalSim = 0
    let fieldCount = 0

    for (const f of fields) {
        totalSim += histogramSimilarity(f.a as Record<string, number>, f.b as Record<string, number>)
        fieldCount++
    }

    totalSim += bucketedSimilarity(a.linkCount, b.linkCount, LINK_BUCKETS)
    fieldCount++
    totalSim += bucketedSimilarity(a.buttonCount, b.buttonCount, BUTTON_BUCKETS)
    fieldCount++
    totalSim += bucketedSimilarity(a.imageCount, b.imageCount, IMAGE_BUCKETS)
    fieldCount++
    totalSim += bucketedSimilarity(a.textLengthBucket, b.textLengthBucket, TEXT_LENGTH_BUCKETS.map((_, i) => i))
    fieldCount++

    return fieldCount > 0 ? totalSim / fieldCount : 0
}

function histogramSimilarity(
    a: Record<string, number>,
    b: Record<string, number>,
): number {
    if (Object.keys(a).length === 0 && Object.keys(b).length === 0) return 1.0
    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])
    let intersection = 0
    for (const k of allKeys) {
        const va = a[k] || 0
        const vb = b[k] || 0
        if (va > 0 && vb > 0) intersection += Math.min(va, vb)
    }
    const union = Math.max(
    Object.values(a).reduce((s, v) => s + v, 0),
    Object.values(b).reduce((s, v) => s + v, 0),
    1,
    )
    return union > 0 ? intersection / union : 0
}

function bucketedSimilarity(a: number, b: number, buckets: number[]): number {
    const idxA = bucketIndex(a, buckets)
    const idxB = bucketIndex(b, buckets)
    return idxA === idxB ? 1 : Math.abs(idxA - idxB) <= 1 ? 0.5 : 0
}

function bucketIndex(value: number, buckets: number[]): number {
    for (let i = 0; i < buckets.length; i++) {
        if (value <= buckets[i]) return i
    }
    return buckets.length - 1
}

function computeVisualBoxScore(a: FeatureVector, b: FeatureVector): number {
    const comparisons = [
    compareBuckets(a.widthBucket, b.widthBucket),
    compareBuckets(a.heightBucket, b.heightBucket),
    compareBuckets(a.areaBucket, b.areaBucket),
    compareBuckets(a.aspectRatioBucket, b.aspectRatioBucket),
    a.hRegion === b.hRegion ? 1 : 0,
    a.vOrder === b.vOrder ? 1 : 0,
    ]
    return comparisons.reduce((s, v) => s + v, 0) / comparisons.length
}

function compareBuckets(a: number, b: number): number {
    if (a === b) return 1
    if (Math.abs(a - b) === 1) return 0.5
    return 0
}

function computeClassesScore(a: FeatureVector, b: FeatureVector): number {
    const aStable = a.classList.filter((_, i) => !a.classIsGenerated[i])
    const bStable = b.classList.filter((_, i) => !b.classIsGenerated[i])
    return jaccard(aStable, bStable)
}

function computeNthChildScore(a: FeatureVector, b: FeatureVector): number {
    const aBucket = coarsePositionBucket(a.nthChild)
    const bBucket = coarsePositionBucket(b.nthChild)
    return aBucket === bBucket ? 1 : 0
}

function coarsePositionBucket(nth: number): number {
    if (nth <= 1) return 0
    if (nth <= 3) return 1
    if (nth <= 6) return 2
    return 3
}

export function findBestMatch(
    target: FeatureVector,
    candidates: FeatureVector[],
    profile: WeightProfile = 'default-card',
): { match: FeatureVector; result: SimResult } | null {
    if (candidates.length === 0) return null
    let best: { match: FeatureVector; result: SimResult } | null = null
    for (const candidate of candidates) {
        const result = computeSimilarity(target, candidate, profile)
        if (!best || result.score > best.result.score) {
            best = { match: candidate, result }
        }
    }
    return best
}

export function filterByThreshold(
    results: Array<{ match: FeatureVector; result: SimResult }>,
    threshold: number,
): Array<{ match: FeatureVector; result: SimResult }> {
    return results.filter(r => r.result.score >= threshold)
}

export function isGeneratedToken(value: string): boolean {
    if (value.length < 6) return false
    let digitCount = 0
    for (const ch of value) {
        if (ch >= '0' && ch <= '9') digitCount++
    }
    return digitCount / value.length > 0.40
}

export function minFeaturesAvailable(result: SimResult, min: number = 3): boolean {
    const featureKeys = ['roleTag', 'textTokens', 'semanticText', 'href', 'dataAttrs', 'aria', 'structure', 'visualBox', 'classes', 'nthChild'] as const
    let available = 0
    for (const key of featureKeys) {
        if ((result.features as any)[key] >= 0) available++
    }
    return available >= min
}

export function extractFeatureVector(element: Element): FeatureVector {
    const tagName = element.tagName.toLowerCase()
    const role = element.getAttribute('role')
    const id = element.id || null
    const classList = Array.from(element.classList)
    const classIsGenerated = classList.map(c => isGeneratedToken(c) || /_\d+$/.test(c))

    const attributes: Record<string, string> = {}
    if (element.hasAttributes()) {
        for (let i = 0; i < element.attributes.length; i++) {
            const attr = element.attributes[i]
            attributes[attr.name] = attr.value
        }
    }

    const parent = element.parentElement
    let nthChild = 1
    if (parent) {
        const siblings = parent.children
        for (let i = 0; i < siblings.length; i++) {
            if (siblings[i] === element) { nthChild = i + 1; break }
        }
    }

    let depth = 0
    let el: Element | null = element
    while ((el = el.parentElement)) depth++

    const childCount = element.children.length
    const textTokens = tokenizeText(element.textContent ?? '')
    const ownText = tokenizeText(
    Array.from(element.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent || '')
      .join(' ')
    )
    const semanticTextTokens = extractSemanticTokens(element)
    const descendantLinks = extractLinks(element)
    const ariaValues = extractAriaValues(element)

    const childTags = element.children
    const childTagHistogramDepth1: Record<string, number> = {}
    const childTagHistogramDepth2: Record<string, number> = {}
    for (let i = 0; i < childTags.length; i++) {
        const t = childTags[i].tagName.toLowerCase()
        childTagHistogramDepth1[t] = (childTagHistogramDepth1[t] || 0) + 1
        for (let j = 0; j < childTags[i].children.length; j++) {
            const t2 = childTags[i].children[j].tagName.toLowerCase()
            childTagHistogramDepth2[t2] = (childTagHistogramDepth2[t2] || 0) + 1
        }
    }

    const linkCount = element.querySelectorAll('a[href]').length
    const buttonCount = element.querySelectorAll('button, [role="button"]').length
    const imageCount = element.querySelectorAll('img, svg, [role="img"]').length

    const text = (element.textContent ?? '').trim()
    const textLengthBucket = bucketIndex(text.length, TEXT_LENGTH_BUCKETS)

    const linkTextLen = Array.from(element.querySelectorAll('a[href]'))
    .reduce((s, a) => s + ((a.textContent ?? '').trim().length), 0)
    const linkDensityBucket = bucketIndex(text.length > 0 ? linkTextLen / text.length : 0, [0, 0.01, 0.05, 0.15, 0.40, 0.70, Infinity])

    const rect = element.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const wRatio = vw > 0 ? rect.width / vw : 0
    const hRatio = vh > 0 ? rect.height / vh : 0
    const area = wRatio * hRatio

    const widthBucket = bucketIndex(wRatio, WIDTH_RATIO_BUCKETS)
    const heightBucket = bucketIndex(hRatio, HEIGHT_RATIO_BUCKETS)
    const areaBucket = bucketIndex(area, AREA_RATIO_BUCKETS)
    const aspectRatioBucket = bucketIndex(rect.height > 0 ? rect.width / rect.height : 0, ASPECT_BUCKETS)

    const rectCenter = rect.left + rect.width / 2
    const hRegion: 'left' | 'center' | 'right' | 'full' =
    rect.width >= vw * 0.95 ? 'full' :
        rectCenter < vw * 0.33 ? 'left' :
            rectCenter > vw * 0.66 ? 'right' : 'center'

    const vOrder: 'first' | 'middle' | 'last' | 'q1' | 'q2' | 'q3' | 'q4' =
    rect.top <= vh * 0.25 ? 'first' :
        rect.top <= vh * 0.50 ? 'q2' :
            rect.top <= vh * 0.75 ? 'q3' : 'q4'

    return {
    tagName, role, id, classList, classIsGenerated, attributes,
    nthChild, depth, childCount,
    textTokens, ownText, semanticTextTokens, descendantLinks, ariaValues,
    childTagHistogramDepth1, childTagHistogramDepth2,
    linkCount, buttonCount, imageCount,
    textLengthBucket, linkDensityBucket,
    widthBucket, heightBucket, areaBucket, aspectRatioBucket,
    hRegion, vOrder,
    }
}

function tokenizeText(text: string): string[] {
    return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\s\n\r]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(/[\s,.;:!?()\[\]{}"'\/\\|_@#$%^&*+=<>~`\-]+/)
    .filter(t => t.length > 0 && t.length < 100)
}

function extractSemanticTokens(element: Element): string[] {
    const clone = element.cloneNode(true) as Element
    for (const el of clone.querySelectorAll('script, style, template, svg, [aria-hidden="true"]')) {
    el.remove()
    }
    return tokenizeText(clone.textContent ?? '')
}

function extractLinks(element: Element): Array<{ host: string; pathTokens: string[]; queryKeys: string[] }> {
    const links: Array<{ host: string; pathTokens: string[]; queryKeys: string[] }> = []
    const seen = new Set<string>()
    for (const a of element.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        try {
            const url = new URL(a.href)
            const key = url.hostname + url.pathname
            if (seen.has(key)) continue
      seen.add(key)
      links.push({
        host: url.hostname,
        pathTokens: url.pathname.split('/').filter(Boolean),
        queryKeys: [...url.searchParams.keys()],
      })
        } catch (e) {
      console.warn('[uBR] matcher: extractLinks URL parse failed', e);
        }
    }
    return links
}

function extractAriaValues(element: Element): string[] {
    const values: string[] = []
    for (const attr of ['aria-label', 'aria-describedby', 'aria-roledescription', 'aria-valuetext']) {
        const val = element.getAttribute(attr)
        if (val) values.push(val)
    }
    for (const child of element.querySelectorAll('[aria-label]')) {
        const val = child.getAttribute('aria-label')
        if (val) values.push(val)
    }
    return values
}

export function isExactMatch(a: FeatureVector, b: FeatureVector): boolean {
    if (a.tagName !== b.tagName) return false
    if (a.id !== b.id) return false
    const aClasses = [...a.classList].sort()
    const bClasses = [...b.classList].sort()
    if (aClasses.join(',') !== bClasses.join(',')) return false
    const aKeys = Object.keys(a.attributes).sort()
    const bKeys = Object.keys(b.attributes).sort()
    if (aKeys.join(',') !== bKeys.join(',')) return false
    for (const key of aKeys) {
        if (a.attributes[key] !== b.attributes[key]) return false
    }
    return true
}

export function areStructurallySimilar(a: FeatureVector, b: FeatureVector, _depth: number = 1): boolean {
    if (a.tagName !== b.tagName) return false
    const aTopClasses = a.classList.slice(0, 2).sort()
    const bTopClasses = b.classList.slice(0, 2).sort()
    const sharedClasses = aTopClasses.filter(c => bTopClasses.includes(c))
    if (sharedClasses.length === 0 && a.classList.length > 0 && b.classList.length > 0) {
        return false
    }
    return true
}

const fingerprintCache = new WeakMap<Element, FeatureVector>()

export function getCachedFingerprint(element: Element): FeatureVector | undefined {
    return fingerprintCache.get(element)
}

export function setCachedFingerprint(element: Element, fv: FeatureVector): void {
  fingerprintCache.set(element, fv)
}

let gcTimer: ReturnType<typeof setInterval> | null = null

export function scheduleFingerprintGC(): void {
    if (gcTimer) return
    gcTimer = setInterval(() => {
        invalidateFingerprintCache()
    }, 5 * 60 * 1000)
}

export function triggerFingerprintGC(activeSelectors?: string[]): void {
    if (typeof document === 'undefined') return
    if (activeSelectors && activeSelectors.length > 0) {
        gcFingerprintsNotInUse(activeSelectors)
    } else {
        invalidateFingerprintCache()
    }
}

function gcFingerprintsNotInUse(activeSelectors: string[]): void {
    const inUse = new Set<Element>()
    try {
        for (const sel of activeSelectors) {
            for (const el of document.querySelectorAll(sel)) {
        inUse.add(el)
            }
        }
    } catch (e) {
    console.warn('[uBR] matcher: gcFingerprintsNotInUse querySelectorAll failed', e)
    }
    const keys = [] as Element[]
    try {
        for (const el of document.querySelectorAll('*')) {
            if (fingerprintCache.get(el) !== undefined && !inUse.has(el)) {
        keys.push(el)
            }
            if (keys.length > 500) break
        }
    } catch (e) {
    console.warn('[uBR] matcher: gcFingerprintsNotInUse querySelectorAll("*") failed', e)
    }
    for (const key of keys) {
    fingerprintCache.delete(key)
    }
}

export function invalidateFingerprintCache(): void {
    const keys = [] as Element[]
    try {
        for (const el of document.querySelectorAll('*')) {
            const fv = fingerprintCache.get(el)
            if (fv !== undefined) {
        keys.push(el)
            }
            if (keys.length > 500) break
        }
    } catch (e) {
    console.warn('[uBR] matcher: invalidateFingerprintCache querySelectorAll("*") failed', e)
    }
    for (const key of keys) {
    fingerprintCache.delete(key)
    }
}

export interface ReferenceDiagnostic {
  ok: boolean
  reason?: string
  code?: string
}

export function checkReferenceAvailable(
    reference: string | undefined,
    ruleId: string,
): ReferenceDiagnostic {
    if (!reference || reference === 'none') {
        return { ok: true }
    }
    if (reference === 'picked') {
        const refEl = document.querySelector(`[data-ubr-reference="${ruleId}"]`)
        if (!refEl) {
            return { ok: false, reason: 'Reference element not found (picked element must exist in DOM)', code: 'missing-reference' }
        }
        return { ok: true }
    }
    try {
        const refEl = document.querySelector(reference)
        if (!refEl) {
            return { ok: false, reason: `Reference selector "${reference}" matched no elements`, code: 'missing-reference' }
        }
        return { ok: true }
    } catch (e) {
    console.warn('[uBR] matcher: querySelector failed for reference selector', reference, e)
    return { ok: false, reason: `Invalid reference selector: "${reference}"`, code: 'invalid-reference' }
    }
}

export function checkReferenceStale(
    currentHash: string | undefined,
    storedHash?: string,
): ReferenceDiagnostic {
    if (!storedHash) return { ok: true }
    if (!currentHash) {
        return { ok: false, reason: 'Cannot compute reference fingerprint', code: 'stale-reference' }
    }
    if (currentHash !== storedHash) {
        return { ok: false, reason: 'Reference fingerprint has changed', code: 'stale-reference' }
    }
    return { ok: true }
}

export * as Matcher from './matcher'
