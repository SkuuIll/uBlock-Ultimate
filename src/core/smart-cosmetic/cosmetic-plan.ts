import type {
    SmartCosmeticRule, SmartHideRule, HideSimilarRule, HideExactRule, SmartAllowRule,
    PathEntry, Boundary, MatchBlock, LogicExpression,
    SafetyBlock, PerformanceBlock, FramesBlock, ShadowBlock, RuntimeBlock,
} from './smart-rule-schema'
import {
    DEFAULT_BOUNDARY, DEFAULT_SAFETY, DEFAULT_PERFORMANCE, DEFAULT_FRAMES,
    DEFAULT_SHADOW, DEFAULT_RUNTIME,
} from './smart-rule-schema'
import { ConflictClass, getActionStrength, hasHideLikeAction, getConflictClass, getSpecificityLevel, getCreatedAt } from './conflict'

export type PlanActionType = 'css-hide' | 'smart-evaluate' | 'allow-unhide' | 'remove'

export interface PlanAction {
  type: PlanActionType
  selector?: string
  rule: SmartCosmeticRule
  conflictClass: ConflictClass
  specificityLevel: number
  actionStrength: number
  createdAt: string
  id: string
}

export interface CosmeticPlan {
  cssSelectors: string[]
  smartRules: Array<{
    rule: SmartHideRule | HideSimilarRule
    boundary: Boundary
    match?: MatchBlock
    where?: LogicExpression
    except?: LogicExpression
    candidates: string[]
    safety: SafetyBlock
    performance: PerformanceBlock
    frames: FramesBlock
    shadow: ShadowBlock
    runtime: RuntimeBlock
  }>
  allows: SmartAllowRule[]
  classicRules: Array<{ rule: HideExactRule | SmartAllowRule; losslessSelectorCompile?: boolean }>
  diagnostics: string[]
  exportLoss: string[]
}

export function compileCosmeticPlan(
    rules: SmartCosmeticRule[],
    url: string,
    _hostname: string,
): CosmeticPlan {
    const plan: CosmeticPlan = {
    cssSelectors: [],
    smartRules: [],
    allows: [],
    classicRules: [],
    diagnostics: [],
    exportLoss: [],
    }

    const enabled = rules.filter(r => r.state === 'active')
    const path = getPathFromUrl(url)

    for (const rule of enabled) {
        if (!pathMatches(rule.paths, path)) continue

    plan.diagnostics.push(`rule ${rule.id}: added to plan`)

    if (rule.type === 'smart-allow') {
      plan.allows.push(rule)
      plan.classicRules.push({ rule })
      plan.exportLoss.push('lossless')
      continue
    }
    if (!hasHideLikeAction(rule)) continue

    if (rule.type === 'hide-exact') {
        if (rule.selector) {
            const lossless = isLosslessSelector(rule.selector)
        plan.cssSelectors.push(rule.selector)
        plan.diagnostics.push(`rule ${rule.id}: compiled as CSS selector`)
        plan.classicRules.push({ rule, losslessSelectorCompile: lossless })
        plan.exportLoss.push('lossless')
        }
        continue
    }

    if (rule.type === 'smart-hide' || rule.type === 'hide-similar') {
      plan.diagnostics.push(`rule ${rule.id}: compiled as smart evaluation`)
      plan.exportLoss.push('not-possible')

      const safety = { ...DEFAULT_SAFETY, ...rule.safety }
      const performance = { ...DEFAULT_PERFORMANCE, ...rule.performance }
      const frames = { ...DEFAULT_FRAMES, ...rule.frames }
      const shadow = { ...DEFAULT_SHADOW, ...rule.shadow }
      const runtime = { ...DEFAULT_RUNTIME, ...rule.runtime }

      plan.smartRules.push({
        rule: rule as SmartHideRule | HideSimilarRule,
        boundary: rule.boundary ?? DEFAULT_BOUNDARY,
        match: rule.match,
        where: rule.where,
        except: rule.except,
        candidates: ('candidates' in rule ? rule.candidates : (rule as HideSimilarRule).candidates) ?? [],
        safety,
        performance,
        frames,
        shadow,
        runtime,
      })
    }
    }

    plan.cssSelectors = applyConflictResolution(plan.cssSelectors, plan.allows)
    plan.allows = plan.allows.filter(a => {
        const conflictClass = getConflictClass(a)
        return conflictClass === ConflictClass.UserAllow
    })

    return plan
}

function getPathFromUrl(url: string): string {
    try {
        const u = new URL(url)
        return u.pathname + u.search + u.hash
    } catch (e) {
    console.warn('[uBR] cosmetic-plan: getPathFromUrl URL parse failed', url, e)
    return ''
    }
}

function pathMatches(paths?: PathEntry[], currentPath?: string): boolean {
    if (!paths || paths.length === 0) return true
    if (!currentPath) return true

    for (const entry of paths) {
        switch (entry.form) {
        case 'exact':
            if (currentPath === entry.value) return true
            break
        case 'glob': {
            const pattern = entry.value
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')
            if (new RegExp(`^${pattern}$`).test(currentPath)) return true
            break
        }
        case 'regex': {
            try {
                if (new RegExp(entry.value).test(currentPath)) return true
            } catch (e) {
          console.warn('[uBR] cosmetic-plan: invalid regex in path match', entry.value, e);
            }
            break
        }
        }
    }

    return false
}

function isLosslessSelector(selector: string): boolean {
    if (/::/.test(selector)) return false
    if (/:has\(|:contains\(|:matches-property\(|:xpath\(/.test(selector)) return false
    return true
}

function applyConflictResolution(
    selectors: string[],
    allows: SmartAllowRule[],
): string[] {
    if (allows.length === 0 || selectors.length === 0) return selectors

    const blocked = new Set<string>()
    for (const allow of allows) {
        if (allow.candidates) {
            for (const sel of allow.candidates) {
        blocked.add(sel)
            }
        }
    }

    return selectors.filter(s => !blocked.has(s))
}

export function createPlanActions(
    plan: CosmeticPlan,
    _matchedSelectors?: string[],
): PlanAction[] {
    const actions: PlanAction[] = []

    for (const sel of plan.cssSelectors) {
        const rule = findRuleForSelector(sel, plan)
        if (!rule) continue
    actions.push({
      type: 'css-hide',
      selector: sel,
      rule,
      conflictClass: getConflictClass(rule),
      specificityLevel: getSpecificityLevel(rule),
      actionStrength: 2,
      createdAt: getCreatedAt(rule),
      id: rule.id,
    })
    }

    for (const smart of plan.smartRules) {
    actions.push({
      type: 'smart-evaluate',
      rule: smart.rule as SmartCosmeticRule,
      conflictClass: getConflictClass(smart.rule as SmartCosmeticRule),
      specificityLevel: getSpecificityLevel(smart.rule as SmartCosmeticRule),
      actionStrength: getActionStrength(smart.rule.action),
      createdAt: getCreatedAt(smart.rule as SmartCosmeticRule),
      id: smart.rule.id,
    })
    }

  actions.sort((a, b) => {
      if (a.conflictClass !== b.conflictClass) return a.conflictClass.localeCompare(b.conflictClass)
      if (a.specificityLevel !== b.specificityLevel) return b.specificityLevel - a.specificityLevel
      if (a.actionStrength !== b.actionStrength) return b.actionStrength - a.actionStrength
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
      return a.id.localeCompare(b.id)
  })

  return actions
}

function findRuleForSelector(selector: string, plan: CosmeticPlan): SmartCosmeticRule | null {
    for (const rule of plan.smartRules) {
        if (rule.candidates?.includes(selector)) return rule.rule as SmartCosmeticRule
        if ('selector' in rule.rule && (rule.rule as any).selector === selector) return rule.rule as SmartCosmeticRule
    }
    if ('candidates' in plan) return null
    return null
}

export * as CosmeticPlan from "./cosmetic-plan"
