import type {
    SmartCosmeticRule, SmartHideRule, HideSimilarRule, HideExactRule, SmartAllowRule,
    ExportLossMetadata,
    SafetyBlock, PerformanceBlock, FramesBlock, ShadowBlock, RuntimeBlock, CacheBlock,
    RuleMetadata, RuleProvenance, LogicOptions, LogicExpression, LogicGroup,
    LogicExpressionItem, LogicCondition, ActionExpression,
} from './smart-rule-schema'
import { smartRuleStore } from './smart-rule-store'

export interface ExportResult {
  yaml: string
  classicLines: string[]
  lossMetadata: ExportLossMetadata[]
  totalRules: number
  losslessCount: number
  partialCount: number
  approximateCount: number
  notPossibleCount: number
}

export function determineExportLoss(rule: SmartCosmeticRule): ExportLossMetadata {
    if (rule.type === 'hide-exact') {
        if (rule.selector && rule.targets) {
            return { code: 'lossless', reason: 'Simple CSS selector with targets' }
        }
        return { code: 'partial', reason: 'Hide-exact without selector or targets', affectedRuleIds: [rule.id] }
    }

    if (rule.type === 'smart-allow') {
        if (canExportSmartAllowLossless(rule)) {
            return { code: 'lossless', reason: 'Simple unhide with candidate selector' }
        }
        return { code: 'partial', reason: 'Smart-allow with complex semantics', affectedRuleIds: [rule.id] }
    }

    if (rule.type === 'hide-similar') {
        if (rule.match?.mode === 'exact' && !rule.where && !rule.except) {
            return { code: 'lossless', reason: 'Exact match without logic' }
        }
        return { code: 'approximate', reason: 'Similarity-based hide cannot be exactly represented in CSS', affectedRuleIds: [rule.id] }
    }

    if (rule.type === 'smart-hide') {
        if (hasFieldUsage(rule, 'own-text')) {
            return { code: 'partial', reason: 'own-text field used — cannot be exactly represented in classic CSS', affectedRuleIds: [rule.id] }
        }
        if (hasFieldUsage(rule, 'semantic-text')) {
            return { code: 'not-possible', reason: 'semantic-text field used — cannot be represented in classic CSS', affectedRuleIds: [rule.id] }
        }
        if (!rule.where && !rule.except && !rule.keywords && (!rule.match || rule.match.mode === 'none')) {
            return { code: 'partial', reason: 'Smart-hide without logic and no match mode' }
        }
        if (rule.where || rule.except || rule.keywords) {
            return { code: 'approximate', reason: 'Smart-hide with logic cannot be exactly represented in classic CSS' }
        }
        return { code: 'approximate', reason: 'Smart-hide with semantic matching', affectedRuleIds: [rule.id] }
    }

    const neverRule: SmartCosmeticRule = rule as SmartCosmeticRule
    return { code: 'not-possible', reason: 'Unknown rule type', affectedRuleIds: [neverRule.id] }
}

function hasFieldUsage(rule: SmartCosmeticRule, fieldName: string): boolean {
    function scanExpr(expr: unknown): boolean {
        if (!expr || typeof expr !== 'object') return false
        const e = expr as Record<string, unknown>
        if ('condition' in e && typeof e.condition === 'object' && e.condition !== null) {
            const c = e.condition as Record<string, unknown>
            if (c.field === fieldName) return true
        }
        const group = e as { all?: unknown[]; any?: unknown[]; none?: unknown[] }
        for (const key of ['all', 'any', 'none'] as const) {
            const arr = group[key]
            if (arr) for (const child of arr) if (scanExpr(child)) return true
        }
        return false
    }
    const where = 'where' in rule ? (rule as any).where : undefined
    const except = 'except' in rule ? (rule as any).except : undefined
    return scanExpr(where) || scanExpr(except)
}

function canExportSmartAllowLossless(rule: SmartAllowRule): boolean {
    if (rule.action.action !== 'unhide') return false
    if (rule.where || rule.except || rule.keywords) return false
    if (rule.match && rule.match.mode !== 'none') return false
    if (!rule.candidates || rule.candidates.length !== 1) return false
    return true
}

function escapeYamlValue(value: string): string {
    if (/[:{}[\],&*?|>!%@`#]/.test(value) || value.startsWith(' ') || value.endsWith(' ') || value === '' || value === '~' || value === 'null' || value === 'true' || value === 'false') {
        return JSON.stringify(value)
    }
    return value
}

function indent(level: number): string {
    return '  '.repeat(level)
}

// ---------- block-level field mappings ----------

const SAFETY_FIELDS: [string, keyof SafetyBlock][] = [
  ['preview', 'preview'],
  ['max-matches', 'maxMatches'],
  ['max-page-percent', 'maxPagePercent'],
  ['max-viewport-area-percent', 'maxViewportAreaPercent'],
  ['min-features', 'minFeatures'],
  ['min-logic-matches', 'minLogicMatches'],
  ['allow-partial-apply', 'allowPartialApply'],
  ['max-consecutive-partial', 'maxConsecutivePartial'],
  ['partial-cycle-count', 'partialCycleCount'],
  ['warn-if-scope-is-body', 'warnIfScopeIsBody'],
  ['warn-if-no-where-logic', 'warnIfNoWhereLogic'],
  ['warn-if-action-remove', 'warnIfActionRemove'],
  ['confirm-page-root', 'confirmPageRoot'],
  ['warn-if-weak-exact-reference', 'warnIfWeakExactReference'],
]

const PERFORMANCE_FIELDS: [string, keyof PerformanceBlock][] = [
  ['max-candidates', 'maxCandidates'],
  ['max-evaluations-per-cycle', 'maxEvaluationsPerCycle'],
  ['max-added-nodes-per-cycle', 'maxAddedNodesPerCycle'],
  ['max-regex-ms-per-rule-cycle', 'maxRegexMsPerRuleCycle'],
  ['max-regex-pattern-length', 'maxRegexPatternLength'],
  ['max-text-regex-input-chars', 'maxTextRegexInputChars'],
  ['debounce-ms', 'debounceMs'],
  ['dependency-depth', 'dependencyDepth'],
  ['dependency-prefilter', 'dependencyPrefilter'],
  ['prefer-css-prefilter', 'preferCssPrefilter'],
  ['metrics', 'metrics'],
  ['sample-rate', 'sampleRate'],
]

const FRAMES_FIELDS: [string, keyof FramesBlock][] = [
  ['mode', 'mode'],
  ['accounting', 'accounting'],
  ['max-total-matches', 'maxTotalMatches'],
]

const SHADOW_FIELDS: [string, keyof ShadowBlock][] = [
  ['mode', 'mode'],
  ['observe-mutations', 'observeMutations'],
  ['observe-recursive', 'observeRecursive'],
  ['allow-host-ancestor', 'allowHostAncestor'],
  ['max-roots-per-cycle', 'maxRootsPerCycle'],
]

const RUNTIME_FIELDS: [string, keyof RuntimeBlock][] = [
  ['observe-path-changes', 'observePathChanges'],
  ['path-change-debounce-ms', 'pathChangeDebounceMs'],
  ['re-evaluate-on-path-change', 'reEvaluateOnPathChange'],
  ['observe-subtree', 'observeSubtree'],
  ['observe-attributes', 'observeAttributes'],
  ['error-recovery', 'errorRecovery'],
  ['on-budget-exceeded', 'onBudgetExceeded'],
  ['max-consecutive-partial-cycles', 'maxConsecutivePartialCycles'],
]

const CACHE_FIELDS: [string, keyof CacheBlock][] = [
  ['max-entries', 'maxEntries'],
  ['max-age-ms', 'maxAgeMs'],
  ['eviction-policy', 'evictionPolicy'],
  ['scope', 'scope'],
]

const METADATA_FIELDS: [string, keyof RuleMetadata][] = [
  ['source', 'source'],
  ['created-at', 'createdAt'],
  ['updated-at', 'updatedAt'],
  ['title', 'title'],
  ['description', 'description'],
  ['created-by', 'createdBy'],
  ['original-syntax', 'originalSyntax'],
  ['original-id', 'originalId'],
]

const PROVENANCE_FIELDS: [string, keyof RuleProvenance][] = [
  ['source', 'source'],
  ['original-rule-id', 'originalRuleId'],
  ['import-timestamp', 'importTimestamp'],
  ['created-by', 'createdBy'],
  ['created-from-host', 'createdFromHost'],
  ['created-from-path', 'createdFromPath'],
  ['original-rule-text', 'originalRuleText'],
  ['original-source', 'originalSource'],
]

function toKebab(s: string): string {
    return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

// ---------- generic YAML serializers ----------

function serializeBlock(lines: string[], level: number, blockName: string, block: Record<string, any> | undefined, fields: [string, string][]): void {
    if (!block) return
    const hasValue = fields.some(([_yamlKey, key]) => block[key] !== undefined && block[key] !== null)
    if (!hasValue) return
  lines.push(`${indent(level)}${blockName}:`)
  for (const [yamlKey, key] of fields) {
      const val = block[key]
      if (val === undefined || val === null) continue
      if (typeof val === 'string') {
      lines.push(`${indent(level + 1)}${yamlKey}: ${escapeYamlValue(val)}`)
      } else if (typeof val === 'boolean') {
      lines.push(`${indent(level + 1)}${yamlKey}: ${val}`)
      } else if (typeof val === 'number') {
      lines.push(`${indent(level + 1)}${yamlKey}: ${val}`)
      }
  }
}

function serializeActionBlock(lines: string[], level: number, action: ActionExpression): void {
    const actionName = action.action
    if (actionName === 'style' && 'style' in action) {
    lines.push(`${indent(level)}action: style`)
    lines.push(`${indent(level + 1)}style: ${escapeYamlValue(action.style)}`)
    } else {
    lines.push(`${indent(level)}action: ${actionName}`)
    }
    if (action.options) {
        if (action.options.important) {
      lines.push(`${indent(level + 1)}important: true`)
        }
    }
}

function serializeBoundaryBlock(lines: string[], level: number, boundary: { mode: string; [key: string]: any } | undefined): void {
    if (!boundary) return
  lines.push(`${indent(level)}boundary:`)
  lines.push(`${indent(level + 1)}mode: ${boundary.mode}`)
  for (const [yamlKey, key] of [['max-depth', 'maxDepth'], ['selector', 'selector'], ['depth', 'depth'], ['stop-at-scope', 'stopAtScope'], ['allow-cross-scope', 'allowCrossScope'], ['allow-scope-root', 'allowScopeRoot'], ['include-self', 'includeSelf'], ['allow-page-root', 'allowPageRoot']] as [string, string][]) {
      if (boundary[key] !== undefined && boundary[key] !== null) {
          const val = boundary[key]
          if (typeof val === 'boolean') {
        lines.push(`${indent(level + 1)}${yamlKey}: ${val}`)
          } else if (typeof val === 'number') {
        lines.push(`${indent(level + 1)}${yamlKey}: ${val}`)
          } else if (typeof val === 'string') {
        lines.push(`${indent(level + 1)}${yamlKey}: ${escapeYamlValue(val)}`)
          }
      }
  }
}

function serializeMatchBlock(lines: string[], level: number, match: { mode: string; [key: string]: any } | undefined): void {
    if (!match) return
  lines.push(`${indent(level)}match:`)
  lines.push(`${indent(level + 1)}mode: ${match.mode}`)
  for (const [yamlKey, key] of [['reference', 'reference'], ['reference-selection', 'referenceSelection'], ['threshold', 'threshold'], ['weight-profile', 'weights']] as [string, string][]) {
      if (match[key] !== undefined && match[key] !== null) {
          const val = match[key]
          if (typeof val === 'number') {
        lines.push(`${indent(level + 1)}${yamlKey}: ${val}`)
          } else if (typeof val === 'string') {
        lines.push(`${indent(level + 1)}${yamlKey}: ${escapeYamlValue(val)}`)
          }
      }
  }
}

function serializeKeywordsBlock(lines: string[], level: number, keywords: { matchMode?: string; includeAny?: string[]; includeAll?: string[]; excludeAny?: string[]; excludeAll?: string[]; fields?: string[]; caseSensitive?: boolean; wordBoundary?: boolean } | undefined): void {
    if (!keywords) return
  lines.push(`${indent(level)}keywords:`)
  if (keywords.matchMode) lines.push(`${indent(level + 1)}match-mode: ${keywords.matchMode}`)
  if (keywords.fields && keywords.fields.length > 0) lines.push(`${indent(level + 1)}fields: [${keywords.fields.join(', ')}]`)
  if (keywords.caseSensitive !== undefined) lines.push(`${indent(level + 1)}case-sensitive: ${keywords.caseSensitive}`)
  if (keywords.wordBoundary !== undefined) lines.push(`${indent(level + 1)}word-boundary: ${keywords.wordBoundary}`)
  for (const [yamlKey, arr] of [['include-any', 'includeAny'], ['include-all', 'includeAll'], ['exclude-any', 'excludeAny'], ['exclude-all', 'excludeAll']] as [string, string][]) {
      const items = (keywords as any)[arr] as string[] | undefined
      if (items && items.length > 0) {
      lines.push(`${indent(level + 1)}${yamlKey}:`)
      for (const item of items) lines.push(`${indent(level + 2)}- ${escapeYamlValue(item)}`)
      }
  }
}

function serializeCondition(lines: string[], level: number, cond: LogicCondition): void {
    const c = cond as any
  lines.push(`${indent(level)}condition:`)
  for (const key of ['field', 'attr-name', 'attr-family', 'operator', 'value', 'pattern', 'selector', 'flags', 'case-sensitive']) {
      const yamlKey = toKebab(key)
      const val = c[key] ?? c[toKebab(key)]
      if (val !== undefined && val !== null) {
          if (typeof val === 'boolean') {
        lines.push(`${indent(level + 1)}${yamlKey}: ${val}`)
          } else {
        lines.push(`${indent(level + 1)}${yamlKey}: ${escapeYamlValue(String(val))}`)
          }
      }
  }
}

function serializeLogicExpression(lines: string[], level: number, expr: LogicExpression): void {
    const group = expr as LogicGroup
    if (group.all || group.any || group.none) {
        for (const key of ['all', 'any', 'none'] as const) {
            const items = group[key]
            if (items && items.length > 0) {
        lines.push(`${indent(level)}${key}:`)
        for (const item of items) {
          lines.push(`${indent(level + 1)}-`)
          if ((item as LogicGroup).all || (item as LogicGroup).any || (item as LogicGroup).none) {
              serializeLogicExpression(lines, level + 2, item)
          } else {
              const expItem = item as LogicExpressionItem
              serializeCondition(lines, level + 2, expItem.condition)
              if (expItem.label) lines.push(`${indent(level + 2)}label: ${escapeYamlValue(expItem.label)}`)
          }
        }
            }
        }
    } else {
        const expItem = expr as LogicExpressionItem
        serializeCondition(lines, level, expItem.condition)
        if (expItem.label) lines.push(`${indent(level + 1)}label: ${escapeYamlValue(expItem.label)}`)
    }
}

function serializeWhereOrExcept(lines: string[], level: number, key: string, expr: LogicExpression | undefined): void {
    if (!expr) return
  lines.push(`${indent(level)}${key}:`)
  serializeLogicExpression(lines, level + 1, expr)
}

function serializeMetadata(lines: string[], level: number, metadata: RuleMetadata | undefined): void {
    if (!metadata) return
  lines.push(`${indent(level)}metadata:`)
  for (const [yamlKey, key] of METADATA_FIELDS) {
      const val = (metadata as any)[key]
      if (val === undefined || val === null) continue
      if (typeof val === 'string') {
      lines.push(`${indent(level + 1)}${yamlKey}: ${escapeYamlValue(val)}`)
      } else if (typeof val === 'boolean') {
      lines.push(`${indent(level + 1)}${yamlKey}: ${val}`)
      } else if (typeof val === 'number') {
      lines.push(`${indent(level + 1)}${yamlKey}: ${val}`)
      }
  }
  // provenance is nested inside metadata
  if (metadata.provenance) {
      serializeBlock(lines, level + 1, 'provenance', metadata.provenance as Record<string, any>, PROVENANCE_FIELDS)
  }
}

function serializeLogicOptions(lines: string[], level: number, logicOptions: LogicOptions | undefined): void {
    if (!logicOptions) return
  lines.push(`${indent(level)}logic-options:`)
  if (logicOptions.stopAtScopeForAncestor !== undefined) {
    lines.push(`${indent(level + 1)}stop-at-scope-for-ancestor: ${logicOptions.stopAtScopeForAncestor}`)
  }
}

function serializeScope(lines: string[], level: number, scope: string[] | undefined): void {
    if (!scope || scope.length === 0) return
  lines.push(`${indent(level)}scope:`)
  for (const s of scope) lines.push(`${indent(level + 1)}- ${escapeYamlValue(s)}`)
}

export function serializeToYaml(rules: SmartCosmeticRule[]): string {
    const lines: string[] = []
  lines.push('# uBR Smart Cosmetic Rules Export')
  lines.push(`# Generated: ${new Date().toISOString()}`)
  lines.push(`# Total rules: ${rules.length}`)
  lines.push('')

  for (const rule of rules) {
      const loss = determineExportLoss(rule)
    lines.push(`# Export loss: ${loss.code}${loss.reason ? ` — ${loss.reason}` : ''}`)
    lines.push('')

    switch (rule.type) {
    case 'hide-exact':
        serializeHideExact(lines, rule as HideExactRule)
        break
    case 'hide-similar':
        serializeHideSimilar(lines, rule as HideSimilarRule)
        break
    case 'smart-hide':
        serializeSmartHide(lines, rule as SmartHideRule)
        break
    case 'smart-allow':
        serializeSmartAllow(lines, rule as SmartAllowRule)
        break
    }
    lines.push('')
  }

  return lines.join('\n')
}

function serializeHideExact(lines: string[], rule: HideExactRule): void {
  lines.push(`hide-exact:`)
  serializeTargets(lines, rule.targets)
  if (rule.paths) serializePaths(lines, rule.paths)
  lines.push(`${indent(1)}state: ${rule.state}`)
  serializeScope(lines, 1, rule.scope)
  lines.push(`${indent(1)}selector: ${escapeYamlValue(rule.selector)}`)
  serializeActionBlock(lines, 1, rule.action)
  serializeBlock(lines, 1, 'safety', rule.safety as Record<string, any>, SAFETY_FIELDS)
  serializeBlock(lines, 1, 'performance', rule.performance as Record<string, any>, PERFORMANCE_FIELDS)
  serializeBlock(lines, 1, 'frames', rule.frames as Record<string, any>, FRAMES_FIELDS)
  serializeBlock(lines, 1, 'shadow', rule.shadow as Record<string, any>, SHADOW_FIELDS)
  serializeBlock(lines, 1, 'runtime', rule.runtime as Record<string, any>, RUNTIME_FIELDS)
  serializeBlock(lines, 1, 'cache', rule.cache as Record<string, any>, CACHE_FIELDS)
  serializeMetadata(lines, 1, rule.metadata)
}

function serializeHideSimilar(lines: string[], rule: HideSimilarRule): void {
  lines.push(`hide-similar:`)
  serializeTargets(lines, rule.targets)
  if (rule.paths) serializePaths(lines, rule.paths)
  lines.push(`${indent(1)}state: ${rule.state}`)
  serializeScope(lines, 1, rule.scope)
  serializeBoundaryBlock(lines, 1, rule.boundary)
  serializeMatchBlock(lines, 1, rule.match)
  serializeWhereOrExcept(lines, 1, 'where', rule.where)
  serializeWhereOrExcept(lines, 1, 'except', rule.except)
  if (rule.candidates && rule.candidates.length > 0) {
    lines.push(`${indent(1)}candidates:`)
    for (const c of rule.candidates) lines.push(`${indent(2)}- ${escapeYamlValue(c)}`)
  }
  serializeActionBlock(lines, 1, rule.action)
  serializeBlock(lines, 1, 'safety', rule.safety as Record<string, any>, SAFETY_FIELDS)
  serializeBlock(lines, 1, 'performance', rule.performance as Record<string, any>, PERFORMANCE_FIELDS)
  serializeBlock(lines, 1, 'frames', rule.frames as Record<string, any>, FRAMES_FIELDS)
  serializeBlock(lines, 1, 'shadow', rule.shadow as Record<string, any>, SHADOW_FIELDS)
  serializeBlock(lines, 1, 'runtime', rule.runtime as Record<string, any>, RUNTIME_FIELDS)
  serializeBlock(lines, 1, 'cache', rule.cache as Record<string, any>, CACHE_FIELDS)
  serializeMetadata(lines, 1, rule.metadata)
}

function serializeSmartHide(lines: string[], rule: SmartHideRule): void {
  lines.push(`smart-hide:`)
  serializeTargets(lines, rule.targets)
  if (rule.paths) serializePaths(lines, rule.paths)
  lines.push(`${indent(1)}state: ${rule.state}`)
  serializeScope(lines, 1, rule.scope)
  serializeBoundaryBlock(lines, 1, rule.boundary)
  serializeMatchBlock(lines, 1, rule.match)
  serializeWhereOrExcept(lines, 1, 'where', rule.where)
  serializeWhereOrExcept(lines, 1, 'except', rule.except)
  serializeKeywordsBlock(lines, 1, rule.keywords)
  if (rule.keywordMerge !== undefined) lines.push(`${indent(1)}keyword-merge: ${rule.keywordMerge}`)
  if (rule.candidates && rule.candidates.length > 0) {
    lines.push(`${indent(1)}candidates:`)
    for (const c of rule.candidates) lines.push(`${indent(2)}- ${escapeYamlValue(c)}`)
  }
  serializeActionBlock(lines, 1, rule.action)
  serializeBlock(lines, 1, 'safety', rule.safety as Record<string, any>, SAFETY_FIELDS)
  serializeBlock(lines, 1, 'performance', rule.performance as Record<string, any>, PERFORMANCE_FIELDS)
  serializeBlock(lines, 1, 'frames', rule.frames as Record<string, any>, FRAMES_FIELDS)
  serializeBlock(lines, 1, 'shadow', rule.shadow as Record<string, any>, SHADOW_FIELDS)
  serializeBlock(lines, 1, 'runtime', rule.runtime as Record<string, any>, RUNTIME_FIELDS)
  serializeBlock(lines, 1, 'cache', rule.cache as Record<string, any>, CACHE_FIELDS)
  serializeMetadata(lines, 1, rule.metadata)
}

function serializeSmartAllow(lines: string[], rule: SmartAllowRule): void {
  lines.push(`smart-allow:`)
  serializeTargets(lines, rule.targets)
  if (rule.paths) serializePaths(lines, rule.paths)
  lines.push(`${indent(1)}state: ${rule.state}`)
  serializeScope(lines, 1, rule.scope)
  serializeBoundaryBlock(lines, 1, rule.boundary)
  serializeMatchBlock(lines, 1, rule.match)
  serializeWhereOrExcept(lines, 1, 'where', rule.where)
  serializeWhereOrExcept(lines, 1, 'except', rule.except)
  serializeKeywordsBlock(lines, 1, rule.keywords)
  if (rule.keywordMerge !== undefined) lines.push(`${indent(1)}keyword-merge: ${rule.keywordMerge}`)
  if (rule.allowBroad !== undefined) lines.push(`${indent(1)}allow-broad: ${rule.allowBroad}`)
  serializeLogicOptions(lines, 1, rule.logicOptions)
  if (rule.candidates && rule.candidates.length > 0) {
    lines.push(`${indent(1)}candidates:`)
    for (const c of rule.candidates) lines.push(`${indent(2)}- ${escapeYamlValue(c)}`)
  }
  serializeActionBlock(lines, 1, rule.action)
  serializeBlock(lines, 1, 'safety', rule.safety as Record<string, any>, SAFETY_FIELDS)
  serializeBlock(lines, 1, 'performance', rule.performance as Record<string, any>, PERFORMANCE_FIELDS)
  serializeBlock(lines, 1, 'frames', rule.frames as Record<string, any>, FRAMES_FIELDS)
  serializeBlock(lines, 1, 'shadow', rule.shadow as Record<string, any>, SHADOW_FIELDS)
  serializeBlock(lines, 1, 'runtime', rule.runtime as Record<string, any>, RUNTIME_FIELDS)
  serializeBlock(lines, 1, 'cache', rule.cache as Record<string, any>, CACHE_FIELDS)
  serializeMetadata(lines, 1, rule.metadata)
}

function serializeTargets(lines: string[], targets: { form: string; value: string }[]): void {
    if (targets.length > 0) {
    lines.push(`${indent(1)}targets:`)
    for (const t of targets) {
      lines.push(`${indent(2)}- ${t.form}: ${escapeYamlValue(t.value)}`)
    }
    }
}

function serializePaths(lines: string[], paths: { form: string; value: string }[]): void {
  lines.push(`${indent(1)}paths:`)
  for (const p of paths) {
    lines.push(`${indent(2)}- ${p.form}: ${escapeYamlValue(p.value)}`)
  }
}

export async function exportAllRules(): Promise<ExportResult> {
    const rules = smartRuleStore.getAllRules()
    const yaml = serializeToYaml(rules)

    const lossMetadata: ExportLossMetadata[] = []

    for (const rule of rules) {
        const loss = determineExportLoss(rule)
    lossMetadata.push(loss)
    }

    return {
    yaml,
    classicLines: [],
    lossMetadata,
    totalRules: rules.length,
    losslessCount: lossMetadata.filter(l => l.code === 'lossless').length,
    partialCount: lossMetadata.filter(l => l.code === 'partial').length,
    approximateCount: lossMetadata.filter(l => l.code === 'approximate').length,
    notPossibleCount: lossMetadata.filter(l => l.code === 'not-possible').length,
    }
}

export * as Export from "./export"
