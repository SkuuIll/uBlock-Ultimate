import type { SmartCosmeticRule, ActionExpression } from './smart-rule-schema'

/* eslint-disable no-unused-vars */
export enum ConflictClass {
  UserAllow = 'A',
  UserExactHide = 'B',
  UserSmartHide = 'C',
  GenericCosmetic = 'F',
}
/* eslint-enable no-unused-vars */

const ACTION_STRENGTH: Record<string, number> = {
  remove: 4,
  collapse: 3,
  hide: 2,
  mark: 1,
  unhide: 1,
}

const TARGET_WEIGHTS: Record<string, number> = {
  host: 500,
  domain: 400,
  entity: 350,
  regex: 300,
}

const PATH_WEIGHTS: Record<string, number> = {
  exact: 400,
  regex: 200,
}

function getPathScore(paths: { form: string; value?: string }[] | undefined): number {
    if (!paths || paths.length === 0) return 100
    let maxScore = 0
    for (const p of paths) {
        if (p.form === 'glob') {
            maxScore = Math.max(maxScore, p.value?.includes('**') ? 250 : 300)
        } else {
            maxScore = Math.max(maxScore, PATH_WEIGHTS[p.form] || 100)
        }
    }
    return maxScore || 100
}

function getRuleIntentScore(rule: SmartCosmeticRule): number {
    if (rule.type === 'hide-exact') return 500
    if (rule.type === 'smart-allow') return 100
    if ('match' in rule && rule.match?.mode === 'exact') return 475
    if (rule.type === 'hide-similar') {
        const threshold = ('match' in rule && rule.match?.threshold) ?? 0.82
        return threshold >= 0.82 ? 425 : 400
    }
    if (rule.type === 'smart-hide') {
        const matchMode = ('match' in rule && rule.match?.mode) || 'none'
        if (matchMode === 'none') return 325
        const hasStrongLogic = 'where' in rule && rule.where !== undefined
        if (matchMode === 'similar' || matchMode === 'structural') return hasStrongLogic ? 375 : 350
    }
    if (rule.action.action === 'mark') return 200
    return 150
}

function getSelectorScopeScore(rule: SmartCosmeticRule): number {
    if ('selector' in rule && rule.selector) return 150
    const scope = 'scope' in rule ? rule.scope : undefined
    if (scope && scope.length > 0) {
        if (scope.some(s => s === 'body' || s === 'html')) return 50
        if (scope.some(s => s === 'div' || s === 'section' || s === 'article')) return 250
        return 300
    }
    return 50
}

const BOUNDARY_SCORES: Record<string, number> = {
  exact: 300,
  selector: 275,
  'ancestor-depth': 250,
  'repeated-card': 225,
  'semantic-block': 200,
  'nearest-card': 175,
  'visual-block': 150,
}

const MATCH_MODE_SCORES: Record<string, (_threshold?: number) => number> = {
  none: () => 100,
  exact: () => 300,
  similar: (t?: number) => (t ?? 0.82) >= 0.82 ? 250 : 220,
  structural: (t?: number) => (t ?? 0.80) >= 0.80 ? 240 : 220,
}

function getLogicStrengthScore(rule: SmartCosmeticRule): number {
    const where = 'where' in rule ? rule.where : undefined
    const except = 'except' in rule ? rule.except : undefined
    if (!where) return 0
    if (except) return 300
    if (hasConditionType(where, 'regex') || hasConditionType(where, 'attribute')) return 250
    if (hasConditionType(where, 'text')) return 200
    return 100
}

function hasConditionType(expr: unknown, op: string): boolean {
    if (!expr || typeof expr !== 'object') return false
    const e = expr as Record<string, unknown>
    if ('condition' in e && typeof e.condition === 'object' && e.condition !== null) {
        const c = e.condition as Record<string, unknown>
        if (c.operator === op) return true
    }
    const group = e as { all?: unknown[]; any?: unknown[]; none?: unknown[] }
    for (const key of ['all', 'any', 'none'] as const) {
        const arr = group[key]
        if (arr) {
            for (const child of arr) {
                if (hasConditionType(child, op)) return true
            }
        }
    }
    return false
}

const SOURCE_SPECIFICITY: Record<string, number> = {
  picker: 3,
  'manual-editor': 2,
  migration: 1,
}

export interface SpecificityTuple {
  targetScore: number
  pathScore: number
  ruleIntentScore: number
  selectorScopeScore: number
  boundaryScore: number
  matchScore: number
  logicStrengthScore: number
  sourceSpecificity: number
}

export function getActionStrength(action: ActionExpression): number {
    return ACTION_STRENGTH[action.action] || 0
}

export function hasHideLikeAction(rule: SmartCosmeticRule): boolean {
    const a = rule.action.action
    return a === 'hide' || a === 'collapse' || a === 'remove' || a === 'mark'
}

export function getCreatedAt(rule: SmartCosmeticRule): string {
    return rule.metadata?.createdAt || '0'
}

export function getConflictClass(rule: SmartCosmeticRule): ConflictClass {
    if (rule.type === 'smart-allow' && rule.action.action === 'unhide') return ConflictClass.UserAllow
    if (rule.type === 'hide-exact') return ConflictClass.UserExactHide
    if (rule.type === 'smart-hide' || rule.type === 'hide-similar') return ConflictClass.UserSmartHide
    return ConflictClass.GenericCosmetic
}

export function getFullSpecificity(rule: SmartCosmeticRule): SpecificityTuple {
    const targetScore = rule.targets.reduce((max, t) => Math.max(max, TARGET_WEIGHTS[t.form] || 100), 0)
    const pathScore = getPathScore(rule.paths)
    const ruleIntentScore = getRuleIntentScore(rule)
    const selectorScopeScore = getSelectorScopeScore(rule)

    let boundaryScore = 0
    if ('boundary' in rule && rule.boundary) {
        boundaryScore = BOUNDARY_SCORES[rule.boundary.mode] || 0
    }

    let matchScore = 0
    if ('match' in rule && rule.match) {
        matchScore = (MATCH_MODE_SCORES[rule.match.mode] || MATCH_MODE_SCORES.none)(rule.match.threshold)
    }

    const logicStrengthScore = getLogicStrengthScore(rule)
    const sourceSpecificity = SOURCE_SPECIFICITY[rule.metadata?.source || ''] || 0

    return {
    targetScore,
    pathScore,
    ruleIntentScore,
    selectorScopeScore,
    boundaryScore,
    matchScore,
    logicStrengthScore,
    sourceSpecificity,
    }
}

const SPECIFICITY_DIMS: (keyof SpecificityTuple)[] = [
  'targetScore', 'pathScore', 'ruleIntentScore', 'selectorScopeScore',
  'boundaryScore', 'matchScore', 'logicStrengthScore', 'sourceSpecificity',
]

export function compareSpecificityTuples(a: SpecificityTuple, b: SpecificityTuple): number {
    for (const dim of SPECIFICITY_DIMS) {
        if (a[dim] !== b[dim]) return b[dim] - a[dim]
    }
    return 0
}

export function getSpecificityLevel(rule: SmartCosmeticRule): number {
    return getFullSpecificity(rule).targetScore
}

export function sortByConflictOrder(rules: SmartCosmeticRule[]): SmartCosmeticRule[] {
    return [...rules].sort((a, b) => {
        const classA = getConflictClass(a)
        const classB = getConflictClass(b)
        if (classA !== classB) return classA.localeCompare(classB)

        const specDiff = compareSpecificityTuples(getFullSpecificity(a), getFullSpecificity(b))
        if (specDiff !== 0) return specDiff

        const strengthA = getActionStrength(a.action)
        const strengthB = getActionStrength(b.action)
        if (strengthA !== strengthB) return strengthB - strengthA

        const createdA = getCreatedAt(a)
        const createdB = getCreatedAt(b)
        if (createdA !== createdB) return createdA < createdB ? -1 : 1

        return a.id.localeCompare(b.id)
    })
}

export * as Conflict from "./conflict"
