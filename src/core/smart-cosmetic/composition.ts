import type { SmartCosmeticRule, MatchBlock } from './smart-rule-schema'
import { isStrongWhereLogic } from './smart-rule-validator'

export interface ScoredRule {
  rule: SmartCosmeticRule
  qualityScore: number
  safetyScore: number
  specificityScore: number
  effectivenessScore: number
  compositeScore: number
}

export interface RuleSuggestion {
  baseSelector: string
  candidateSelectors: string[]
  suggestedMatch: MatchBlock
  suggestedBoundary: string
  suggestedThreshold: number
  confidence: number
}

const TRUSTED_BOUNDARY_MODES = ['semantic-block', 'repeated-card', 'ad-zone'] as const

export function scoreRule(rule: SmartCosmeticRule): ScoredRule {
    const qualityScore = computeQualityScore(rule)
    const safetyScore = computeSafetyScore(rule)
    const specificityScore = computeSpecificityScore(rule)
    const effectivenessScore = computeEffectivenessScore(rule)

    const compositeScore = (
        qualityScore * 0.30 +
    safetyScore * 0.30 +
    specificityScore * 0.20 +
    effectivenessScore * 0.20
    )

    return {
    rule,
    qualityScore,
    safetyScore,
    specificityScore,
    effectivenessScore,
    compositeScore,
    }
}

function computeQualityScore(rule: SmartCosmeticRule): number {
    let score = 0.5

    if (rule.syntaxVersion >= 1) score += 0.1
    if (rule.metadata?.author) score += 0.1
    if (rule.metadata?.description) score += 0.1

    if (rule.type === 'hide-exact' && rule.selector) {
        if (rule.selector.startsWith('#')) score += 0.1
        else if (rule.selector.startsWith('.')) score += 0.05
    }

    if (rule.type === 'smart-hide' || rule.type === 'hide-similar') {
        if (rule.match?.threshold && rule.match.threshold >= 0.75) score += 0.1
        if (rule.boundary && TRUSTED_BOUNDARY_MODES.includes(rule.boundary.mode as any)) score += 0.1
        if (rule.where && isStrongWhereLogic(rule.where)) score += 0.1
    }

    return Math.min(1.0, Math.max(0, score))
}

function computeSafetyScore(rule: SmartCosmeticRule): number {
    let score = 0.7

    if (rule.action.action === 'remove') score -= 0.3
    if (rule.action.action === 'unhide') score -= 0.1

    if (rule.type === 'smart-hide' || rule.type === 'hide-similar') {
        if (rule.match?.mode === 'none' || rule.match?.mode === 'exact') score += 0.15
        if (rule.match?.threshold && rule.match.threshold >= 0.76) score += 0.1
        if (rule.match?.threshold && rule.match.threshold < 0.70) score -= 0.15
    }

    if (rule.scope) {
        for (const s of rule.scope) {
            if (s === 'body' || s === 'html') { score -= 0.15; break }
        }
    }

    if (rule.action.action === 'style') score -= 0.1

    return Math.min(1.0, Math.max(0, score))
}

function computeSpecificityScore(rule: SmartCosmeticRule): number {
    let score = 0.3

    if (rule.targets.length > 0) score += 0.15 * Math.min(rule.targets.length, 3) / 3
    if (rule.paths && rule.paths.length > 0) score += 0.1
    if (rule.selector) {
        if (rule.selector.startsWith('#')) score += 0.3
        else if (rule.selector.includes('[')) score += 0.2
        else if (rule.selector.startsWith('.')) score += 0.1
    }

    if (rule.type === 'smart-hide' || rule.type === 'hide-similar') {
        if (rule.where) score += 0.15
        if (rule.candidates && rule.candidates.length <= 3) score += 0.1
    }

    if (rule.metadata?.tags && rule.metadata.tags.length > 0) score += 0.05

    return Math.min(1.0, Math.max(0, score))
}

function computeEffectivenessScore(rule: SmartCosmeticRule): number {
    let score = 0.5

    if (rule.metadata?.lastMatched) {
        const age = Date.now() - new Date(rule.metadata.lastMatched).getTime()
        const days = age / (1000 * 60 * 60 * 24)
        if (days < 7) score += 0.2
        else if (days < 30) score += 0.1
    }

    if (rule.metadata?.matchCount !== undefined) {
        score += Math.min(rule.metadata.matchCount * 0.05, 0.2)
    }

    return Math.min(1.0, Math.max(0, score))
}

export function sortByQuality(rules: SmartCosmeticRule[]): ScoredRule[] {
    return rules
    .map(r => scoreRule(r))
    .sort((a, b) => b.compositeScore - a.compositeScore)
}

export function getTopRules(rules: SmartCosmeticRule[], count: number = 10): ScoredRule[] {
    return sortByQuality(rules).slice(0, count)
}

export function analyzeRuleComposition(rules: SmartCosmeticRule[]): {
  total: number
  averageQuality: number
  averageSafety: number
  distribution: Record<string, number>
  recommendations: string[]
} {
    const scored = rules.map(r => scoreRule(r))
    const total = scored.length

    if (total === 0) {
        return { total: 0, averageQuality: 0, averageSafety: 0, distribution: {}, recommendations: ['No rules to analyze'] }
    }

    const avgQuality = scored.reduce((s, r) => s + r.qualityScore, 0) / total
    const avgSafety = scored.reduce((s, r) => s + r.safetyScore, 0) / total
    const distribution: Record<string, number> = {}

    for (const r of rules) {
        distribution[r.type] = (distribution[r.type] || 0) + 1
    }

    const recommendations: string[] = []
    if (avgSafety < 0.6) recommendations.push('Multiple rules have low safety scores - review scope and thresholds')
    if (avgQuality < 0.5) recommendations.push('Consider adding metadata (author, description) to rules')
    if (rules.some(r => r.action.action === 'remove')) recommendations.push('Rules using action "remove" can break page scripts')
    if (rules.some(r => r.type === 'smart-hide' && !r.where && !r.keywords)) recommendations.push('Smart-hide rules without where/keywords may be too broad')

    return {
    total,
    averageQuality: avgQuality,
    averageSafety: avgSafety,
    distribution,
    recommendations,
    }
}

export * as RuleComposition from './composition'
