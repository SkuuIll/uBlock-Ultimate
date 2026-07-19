import type {
    SmartCosmeticRule, SmartHideRule, HideSimilarRule, SmartAllowRule,
    PreviewStatus,
} from './smart-rule-schema'
import { evaluateWhereExcept, LogicEvalResult } from './logic-evaluator'
import { extractFeatureVector, computeSimilarity, minFeaturesAvailable } from './matcher'
import { sortByConflictOrder } from './conflict'
import { resolveBoundary } from './scoper'
import { createConfirmationHash } from './canonical-hash'
export { createConfirmationHash }

export type ConfidenceBucket =
  | 'high'
  | 'medium'
  | 'borderline'
  | 'matched-logic-not-similar'
  | 'similar-logic-failed'
  | 'excluded-by-except'
  | 'blocked-by-allow'
  | 'blocked-by-safety'
  | 'reference'
  | 'blocked-by-external-classic'

export interface PreviewElementResult {
  element: Element
  bucket: ConfidenceBucket
  logicResult?: LogicEvalResult
  similarityScore?: number
  threshold?: number
  reason?: string
  boundaryExplanation?: string
}

export interface PreviewResult {
  ruleId: string
  timestamp: string
  totalElements: number
  buckets: Record<ConfidenceBucket, PreviewElementResult[]>
  explanation: string
  recommended: boolean
  relaxedCapsUsed?: boolean
  previewCandidateCap?: number
  activeCandidateCap?: number
}

export function isPreviewStale(rule: SmartCosmeticRule): boolean {
    if (!rule.preview) return true
    if (rule.preview.status === 'confirmed') return false

    const current = createConfirmationHash(rule)
    return rule.preview.confirmationHash !== current
}

export function getRequiredPreviewStatus(rule: SmartCosmeticRule): PreviewStatus {
    if (rule.type === 'smart-allow') return 'none'
    if (rule.type === 'hide-exact') return 'none'

    if (rule.type === 'hide-similar' || rule.type === 'smart-hide') {
        const safety = rule.safety
        if (safety?.preview === 'required') return 'draft'
        if (safety?.preview === 'recommended') return 'draft'
    }

    return 'none'
}

export function previewRule(
    elements: Element[],
    rule: SmartHideRule | HideSimilarRule,
    allowRules?: SmartAllowRule[],
    relaxedCaps: boolean = true,
    externalClassicSelectors?: string[],
): PreviewResult {
    const buckets: Record<ConfidenceBucket, PreviewElementResult[]> = {
    high: [],
    medium: [],
    borderline: [],
    'matched-logic-not-similar': [],
    'similar-logic-failed': [],
    'excluded-by-except': [],
    'blocked-by-allow': [],
    'blocked-by-safety': [],
    reference: [],
    'blocked-by-external-classic': [],
    }

    let relaxedCapsUsed = false
    const originalSafety = rule.safety ? { ...rule.safety } : undefined
    if (relaxedCaps && rule.safety) {
        relaxedCapsUsed = true
        rule.safety = {
      ...rule.safety,
      maxMatches: (rule.safety.maxMatches ?? 100) * 2,
      maxPagePercent: (rule.safety.maxPagePercent ?? 25) * 2,
        }
    }

    try {

    const externalClassicBuckets: Set<Element> = new Set()
    if (externalClassicSelectors && externalClassicSelectors.length > 0) {
        for (const sel of externalClassicSelectors) {
            try {
                const matched = document.querySelectorAll(sel)
                for (const el of matched) externalClassicBuckets.add(el)
            } catch (e) {
        console.warn('[uBR] preview-engine: querySelectorAll failed for external classic selector', sel, e)
            }
        }
    }

    for (const el of elements) {
        if (externalClassicBuckets.has(el)) {
      buckets['blocked-by-external-classic'].push({
        element: el,
        bucket: 'blocked-by-external-classic',
        reason: 'Also blocked by external classic cosmetic filter',
      })
      continue
        }
        const result = previewElement(el, rule, allowRules)
    buckets[result.bucket].push(result)
    }

    const totalHigh = buckets.high.length
    const totalMedium = buckets.medium.length
    const _totalBorderline = buckets.borderline.length
    const total = elements.length
    const recommended = total > 0 && (totalHigh + totalMedium) > total * 0.3

    let explanation: string
    if (total === 0) {
        explanation = 'No matching elements found on the page.'
    } else if (recommended) {
        explanation = `${totalHigh + totalMedium} of ${total} elements will be hidden.`
    } else {
        explanation = `${totalHigh + totalMedium} of ${total} elements match. Review before confirming.`
    }

    const boundaryResult = elements.length > 0 ? resolveBoundary(elements[0], (rule as any).boundary) : null
    const boundaryExplanation = boundaryResult?.element
        ? `Boundary resolved to <${boundaryResult.element.tagName.toLowerCase()}>${boundaryResult.element.id ? `#${  boundaryResult.element.id}` : ''}${boundaryResult.element.classList.length ? `.${  Array.from(boundaryResult.element.classList).slice(0, 3).join('.')}` : ''}`
        : 'No boundary resolution'

    } finally {
    if (originalSafety) {
        rule.safety = originalSafety
    }
    }

    return {
    ruleId: rule.id,
    timestamp: new Date().toISOString(),
    totalElements: total,
    buckets,
    explanation: `${explanation  } ${  boundaryExplanation}`,
    recommended,
    relaxedCapsUsed: relaxedCapsUsed || undefined,
    previewCandidateCap: relaxedCapsUsed ? (rule.safety?.maxMatches ?? 200) : undefined,
    activeCandidateCap: !relaxedCapsUsed ? (rule.safety?.maxMatches ?? 100) : undefined,
    }
}

function previewElement(
    el: Element,
    rule: SmartHideRule | HideSimilarRule,
    allowRules?: SmartAllowRule[],
): PreviewElementResult {
    const logicResult = evaluateWhereExcept(el, rule.where, rule.except)
    if (!logicResult.passed) {
        if (rule.except && evaluateWhereExcept(el, undefined, rule.except).passed) {
            return {
        element: el,
        bucket: 'excluded-by-except',
        logicResult,
        reason: 'Excluded by except conditions',
            }
        }
        return {
      element: el,
      bucket: 'borderline',
      logicResult,
      reason: 'Where logic conditions not met',
        }
    }

    if (allowRules && allowRules.length > 0) {
        const sorted = sortByConflictOrder(allowRules)
        for (const ar of sorted) {
            const allowSelector = 'selector' in ar ? (ar as any).selector as string : undefined
            if (allowSelector && el.matches?.(allowSelector)) {
                return {
          element: el,
          bucket: 'blocked-by-allow',
          logicResult,
          reason: `Blocked by allow rule ${ar.id}`,
                }
            }
            const allowMatch = ar.match
            if (allowMatch && allowMatch.mode !== 'none') {
                const refSel = allowMatch.reference
                if (refSel && refSel !== 'none' && refSel !== 'picked') {
                    try {
                        if (el.matches(refSel)) {
                            return {
                element: el,
                bucket: 'blocked-by-allow',
                logicResult,
                reason: `Blocked by allow rule ${ar.id} selector match`,
                            }
                        }
                    } catch (e) {
            console.warn('[uBR] preview-engine: el.matches failed for allow rule refSel', refSel, e)
                    }
                }
            }
        }
    }

    const match = rule.match
    if (!match || match.mode === 'none') {
        return {
      element: el,
      bucket: 'matched-logic-not-similar',
      logicResult,
      reason: 'Logic conditions met (no similarity mode)',
        }
    }

    const threshold = match.threshold ?? 0.74
    const profile: WeightProfile = match.weights ?? 'default-card'
    const safety = rule.safety
    const minFeatures = safety?.minFeatures ?? 3

    let simScore = 0
    let featuresOk = true
    try {
        const refSelector = match.reference
        let refEl: Element | null = null
        if (refSelector === 'picked') {
            refEl = document.querySelector(`[data-ubr-reference="${rule.id}"]`)
        } else if (refSelector && refSelector !== 'none') {
            refEl = document.querySelector(refSelector)
        }
        if (refEl) {
            const fv = extractFeatureVector(el)
            const refFV = extractFeatureVector(refEl)
            const result = computeSimilarity(fv, refFV, profile)
            simScore = result.score
            featuresOk = minFeaturesAvailable(result, minFeatures)
        }
    } catch (e) {
    console.warn('[uBR] preview-engine: similarity computation failed', e)
    simScore = 0
    }

    if (!featuresOk) {
        return {
      element: el,
      bucket: 'blocked-by-safety',
      logicResult,
      similarityScore: simScore,
      threshold,
      reason: `Insufficient features (need ${minFeatures})`,
        }
    }

    if (match.reference && match.reference === 'picked') {
        return {
      element: el,
      bucket: 'reference',
      logicResult,
      similarityScore: simScore,
      threshold,
      reason: 'Reference element (not actionable)',
        }
    }

    if (simScore >= threshold) {
        return {
      element: el,
      bucket: 'high',
      logicResult,
      similarityScore: simScore,
      threshold,
      reason: 'High similarity match',
        }
    }

    if (simScore >= threshold * 0.85) {
        return {
      element: el,
      bucket: 'medium',
      logicResult,
      similarityScore: simScore,
      threshold,
      reason: `Moderate similarity (${simScore.toFixed(2)} vs ${threshold})`,
        }
    }

    return {
    element: el,
    bucket: 'similar-logic-failed',
    logicResult,
    similarityScore: simScore,
    threshold,
    reason: `Logic passed but similarity too low (${simScore.toFixed(2)} vs ${threshold})`,
    }
}

export function previewRuleForSelectors(
    selectors: string[],
    rule: SmartHideRule | HideSimilarRule,
    allowRules?: SmartAllowRule[],
): PreviewResult {
    const elements: Element[] = []
    for (const sel of selectors) {
        try {
            const found = document.querySelectorAll(sel)
      elements.push(...Array.from(found))
        } catch (e) {
      console.warn('[uBR] preview-engine: querySelectorAll failed for selector', sel, e)
      continue
        }
    }
    return previewRule(elements, rule, allowRules)
}

export function shouldAllowConfirmation(
    rule: SmartCosmeticRule,
    previewResult?: PreviewResult,
): { allowed: boolean; reason?: string } {
    if (rule.type === 'hide-exact' || rule.type === 'smart-allow') {
        return { allowed: true }
    }

    if (!previewResult) {
        return { allowed: false, reason: 'Preview required before confirmation' }
    }

    const safety = rule.safety
    if (!safety) return { allowed: true }

    if (safety.preview === 'required' && !previewResult.recommended) {
        return { allowed: false, reason: 'Preview shows low confidence; review before confirming' }
    }

    return { allowed: true }
}

export * as PreviewEngine from "./preview-engine"
