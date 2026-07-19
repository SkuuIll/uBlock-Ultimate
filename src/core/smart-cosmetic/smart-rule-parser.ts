export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue }

export interface ParseError {
  line: number
  message: string
}

export interface ParseResult {
  value: YamlValue
  errors: ParseError[]
}

interface ParseFrame {
  indent: number
  parentKey: string | null
  parent: ParseFrame | null
  map: { [key: string]: YamlValue } | null
  list: YamlValue[] | null
}

function inferScalar(raw: string): string | number | boolean | null {
    const trimmed = raw.trim()
    if (trimmed === 'null' || trimmed === '~') return null
    if (trimmed === 'true') return true
    if (trimmed === 'false') return false
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return trimmed.includes('.') ? parseFloat(trimmed) : parseInt(trimmed, 10)
    }
    return trimmed
}

function unquote(raw: string): string {
    const s = raw.trim()
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
        return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'")
    }
    return s
}

function getAssignableMap(top: ParseFrame): { [key: string]: YamlValue } | null {
    if (top.map) return top.map
    if (top.list && top.list.length > 0) {
        const last = top.list[top.list.length - 1]
        if (typeof last === 'object' && !Array.isArray(last) && last !== null) {
            return last as { [key: string]: YamlValue }
        }
    }
    return null
}

const MAX_YAML_NESTING_DEPTH = 100

export function parseYamlLines(lines: string[]): ParseResult {
    const errors: ParseError[] = []
    const root: { [key: string]: YamlValue } = {}
    const stack: ParseFrame[] = [{ indent: -1, parentKey: null, parent: null, map: root, list: null }]

    let i = 0
    while (i < lines.length) {
        const raw = lines[i]
        i++
        const trimmed = raw.trim()
        if (trimmed === '' || trimmed.startsWith('#')) continue

        const indent = raw.length - raw.trimStart().length

        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop()
        }

        const top = stack[stack.length - 1]

        if (trimmed.startsWith('- ')) {
            const afterDash = trimmed.slice(2)

            if (top.list === null) {
                if (top.parent && top.parentKey && top.map) {
                    const list: YamlValue[] = []
          top.parent.map![top.parentKey] = list
          top.map = null
          top.list = list
                } else {
          errors.push({ line: i, message: 'List without parent key' })
          continue
                }
            }

            const nestedColonIdx = afterDash.indexOf(':')
            const hasSpaceBeforeColon = afterDash.slice(0, nestedColonIdx).includes(' ')
            if (nestedColonIdx > 0 && !hasSpaceBeforeColon) {
                const itemKey = afterDash.slice(0, nestedColonIdx).trim()
                const itemVal = afterDash.slice(nestedColonIdx + 1).trim()
                if (itemVal === '') {
                    const itemMap: { [key: string]: YamlValue } = {}
          top.list.push(itemMap)
          if (stack.length >= MAX_YAML_NESTING_DEPTH) {
              errors.push({ line: i, message: `YAML nesting depth exceeds limit of ${MAX_YAML_NESTING_DEPTH}` })
              continue
          }
          stack.push({ indent, parentKey: null, parent: top, map: itemMap, list: null })
                } else {
                    const item: { [key: string]: YamlValue } = {}
                    item[itemKey] = inferScalar(itemVal)
          top.list.push(item)
                }
            } else {
        top.list.push(inferScalar(afterDash))
            }
            continue
        }

        const colonIdx = trimmed.indexOf(':')
        if (colonIdx === -1) {
      errors.push({ line: i, message: `Expected key: value on line ${i}: "${trimmed}"` })
      continue
        }

        const key = trimmed.slice(0, colonIdx).trim()
        const rest = trimmed.slice(colonIdx + 1).trim()
        const target = getAssignableMap(top)

        if (!target) {
      errors.push({ line: i, message: `Cannot assign key "${key}" in current context` })
      continue
        }

        if (rest === '') {
            const childMap: { [key: string]: YamlValue } = {}
            target[key] = childMap
      if (stack.length >= MAX_YAML_NESTING_DEPTH) {
          errors.push({ line: i, message: `YAML nesting depth exceeds limit of ${MAX_YAML_NESTING_DEPTH}` })
          continue
      }
      stack.push({ indent, parentKey: key, parent: top, map: childMap, list: null })
      continue
        }

        if (rest.startsWith('|')) {
            const blockLines: string[] = []
            while (i < lines.length) {
                const nextRaw = lines[i]
                const nextTrimmed = nextRaw.trim()
                if (nextTrimmed === '' || nextTrimmed.startsWith('#')) { i++; continue }
                const nextIndent = nextRaw.length - nextRaw.trimStart().length
                if (nextIndent <= indent) break
        blockLines.push(nextTrimmed)
        i++
            }
            target[key] = blockLines.join('\n')
            continue
        }

        if (rest.startsWith('[')) {
            const items = rest.slice(1, -1).split(',').map(s => inferScalar(s.trim()))
            target[key] = items
            continue
        }

        if (rest.startsWith("'") || rest.startsWith('"')) {
            target[key] = unquote(rest)
            continue
        }

        if (rest.startsWith('/') && rest.length > 1) {
            target[key] = rest
            continue
        }

        target[key] = inferScalar(rest)
    }

    return { value: root, errors }
}

export function parseYaml(text: string): ParseResult {
    return parseYamlLines(text.split(/\r?\n/))
}

export interface IntermediateRule {
  type: string
  data: { [key: string]: YamlValue }
}

export function extractRulesFromParsed(parsed: YamlValue): { rules: IntermediateRule[]; errors: ParseError[] } {
    const errors: ParseError[] = []
    const rules: IntermediateRule[] = []

    if (typeof parsed !== 'object' || parsed === null) {
    errors.push({ line: 0, message: 'Expected a mapping at root' })
    return { rules, errors }
    }

    const root = parsed as { [key: string]: YamlValue }

    if ('ubr-smart-rules' in root || 'ubrSmartRules' in root) {
        const container = (root['ubr-smart-rules'] || root['ubrSmartRules']) as { [key: string]: YamlValue } | undefined
        if (container && typeof container === 'object' && 'rules' in container) {
            const items = container.rules
            if (Array.isArray(items)) {
                for (const item of items) {
                    if (typeof item !== 'object' || item === null) continue
                    const obj = item as { [key: string]: YamlValue }
                    const ruleType = findRuleType(obj)
                    if (ruleType) {
            rules.push({ type: ruleType, data: obj })
                    } else {
            errors.push({ line: 0, message: 'Rule object does not contain a recognized rule type' })
                    }
                }
                return { rules, errors }
            }
        }
        return { rules, errors }
    }

    const singleType = findRuleType(root)
    if (singleType) {
    rules.push({ type: singleType, data: root })
    return { rules, errors }
    }

  errors.push({ line: 0, message: 'No recognized rule type found in input' })
  return { rules, errors }
}

import type { SmartCosmeticRule, HideExactRule, HideSimilarRule, SmartHideRule, SmartAllowRule, TargetEntry, PathEntry, KeywordBlock, LogicExpression, Boundary, MatchBlock, ActionExpression, ActionOptions, LogicOptions, FramesBlock, FrameMode, FrameAccounting, ShadowBlock, ShadowMode, RuntimeBlock, ReEvaluateOnPathChange, CacheBlock, CacheScope, EvictionPolicy, PerformanceBlock, MetricsMode, SafetyBlock, RuleProvenance, RuleHistoryEntry, RuleSource, PreviewStatus, PreviewState } from './smart-rule-schema'
import { DEFAULT_BOUNDARY, RULE_ID_PREFIX, normalizeRuleState } from './smart-rule-schema'

const RULE_TYPE_KEYS = new Set(['hide-exact', 'hide-similar', 'smart-hide', 'smart-allow', 'hideExact', 'hideSimilar', 'smartHide', 'smartAllow'])

function findRuleType(obj: { [key: string]: YamlValue }): string | null {
    for (const key of RULE_TYPE_KEYS) {
        if (key in obj) return key
    }
    return null
}

function parseTargets(raw: YamlValue): TargetEntry[] {
    if (!Array.isArray(raw)) return []
    const targets: TargetEntry[] = []
    for (const item of raw) {
        if (typeof item === 'object' && item !== null) {
            const obj = item as { [key: string]: YamlValue }
            const form = Object.keys(obj)[0] as TargetEntry['form']
            const value = obj[form]
            if (form && typeof value === 'string' && ['host', 'domain', 'entity', 'regex'].includes(form)) {
        targets.push({ form, value })
            }
        }
    }
    if (targets.length === 0 && typeof raw[0] === 'string') {
        for (const s of raw as string[]) {
            const colonIdx = s.indexOf(':')
            if (colonIdx > 0) {
                const form = s.slice(0, colonIdx) as TargetEntry['form']
                const value = s.slice(colonIdx + 1)
                if (['host', 'domain', 'entity', 'regex'].includes(form)) {
          targets.push({ form, value })
                }
            }
        }
    }
    return targets
}

function parsePaths(raw: YamlValue): PathEntry[] | undefined {
    if (!Array.isArray(raw)) return undefined
    const paths: PathEntry[] = []
    for (const item of raw) {
        if (typeof item === 'object' && item !== null) {
            const obj = item as { [key: string]: YamlValue }
            const form = Object.keys(obj)[0] as PathEntry['form']
            const value = obj[form]
            if (form && typeof value === 'string' && ['exact', 'glob', 'regex'].includes(form)) {
        paths.push({ form, value })
            }
        } else if (typeof item === 'string') {
            const colonIdx = item.indexOf(':')
            if (colonIdx > 0) {
                const form = item.slice(0, colonIdx) as PathEntry['form']
                const value = item.slice(colonIdx + 1)
                if (['exact', 'glob', 'regex'].includes(form)) {
          paths.push({ form, value })
                } else {
          paths.push({ form: 'glob', value: item })
                }
            } else {
        paths.push({ form: 'glob', value: item })
            }
        }
    }
    return paths.length > 0 ? paths : undefined
}

function parseCandidates(raw: YamlValue): string[] | undefined {
    if (!Array.isArray(raw)) return undefined
    const candidates = raw.filter((c): c is string => typeof c === 'string')
    return candidates.length > 0 ? candidates : undefined
}

function parseScope(raw: YamlValue): string[] | undefined {
    if (!Array.isArray(raw)) return undefined
    const scope = raw.filter((s): s is string => typeof s === 'string')
    return scope.length > 0 ? scope : undefined
}

function parseBoundary(data: { [key: string]: YamlValue }): Boundary {
    const mode = String(data.mode || DEFAULT_BOUNDARY.mode) as Boundary['mode']
    const allowCrossScope = data.allowCrossScope === true
    return {
    mode,
    maxDepth: typeof data.maxDepth === 'number' ? data.maxDepth : DEFAULT_BOUNDARY.maxDepth,
    stopAtScope: allowCrossScope ? false : data.stopAtScope !== false,
    allowCrossScope,
    allowScopeRoot: data.allowScopeRoot === true,
    includeSelf: data.includeSelf === true,
    allowPageRoot: data.allowPageRoot === true,
    selector: typeof data.selector === 'string' ? data.selector : undefined,
    depth: typeof data.depth === 'number' ? data.depth as number : undefined,
    }
}

function parseMatch(data: { [key: string]: YamlValue } | undefined): MatchBlock | undefined {
    if (!data) return undefined
    const mode = String(data.mode || 'none') as MatchBlock['mode']
    const match: MatchBlock = { mode }
    if (typeof data.threshold === 'number') match.threshold = data.threshold
    if (data.reference === 'picked' || data.reference === 'none') match.reference = data.reference as MatchBlock['reference']
    else if (typeof data.reference === 'string') match.reference = data.reference
    if (data.referenceSelection === 'error' || data.referenceSelection === 'first') match.referenceSelection = data.referenceSelection as MatchBlock['referenceSelection']
    if (data.weights && typeof data.weights === 'string') match.weights = data.weights as MatchBlock['weights']
    return match
}

function parseKeywords(data: { [key: string]: YamlValue } | undefined): KeywordBlock | undefined {
    if (!data) return undefined
    const kw: KeywordBlock = {
    matchMode: typeof data.matchMode === 'string' ? data.matchMode as KeywordBlock['matchMode'] : undefined,
    fields: Array.isArray(data.fields) ? data.fields.filter((f): f is string => typeof f === 'string') : ['text'],
    }
    const includeArr = data.includeAny as YamlValue[] | undefined
    if (includeArr && Array.isArray(includeArr)) {
        kw.includeAny = includeArr.filter((i): i is string => typeof i === 'string')
    }
    const includeAllArr = data.includeAll as YamlValue[] | undefined
    if (includeAllArr && Array.isArray(includeAllArr)) {
        kw.includeAll = includeAllArr.filter((i): i is string => typeof i === 'string')
    }
    const excludeArr = data.excludeAny as YamlValue[] | undefined
    if (excludeArr && Array.isArray(excludeArr)) {
        kw.excludeAny = excludeArr.filter((i): i is string => typeof i === 'string')
    }
    const excludeAllArr = data.excludeAll as YamlValue[] | undefined
    if (excludeAllArr && Array.isArray(excludeAllArr)) {
        kw.excludeAll = excludeAllArr.filter((i): i is string => typeof i === 'string')
    }
    if (typeof data.caseSensitive === 'boolean') kw.caseSensitive = data.caseSensitive as boolean
    if (typeof data.wordBoundary === 'boolean') {
        kw.wordBoundary = data.wordBoundary as boolean
    }
    return kw
}

function parseWhere(data: { [key: string]: YamlValue }, key: string): LogicExpression | undefined {
    const val = data[key]
    if (!val) return undefined
    if (typeof val === 'object' && !Array.isArray(val) && val !== null) {
        return val as LogicExpression
    }
    return undefined
}

function parseAction(raw: YamlValue): ActionExpression {
    if (typeof raw === 'string') {
        if (raw === 'unhide') return { action: 'unhide' }
        if (raw === 'collapse') return { action: 'collapse' }
        if (raw === 'remove') return { action: 'remove' }
        if (raw === 'mark') return { action: 'mark' }
        return { action: 'hide' }
    }
    if (typeof raw === 'object' && raw !== null) {
        const obj = raw as { [key: string]: YamlValue }
        const actionType = String(obj.action || 'hide')
        const options = obj.options as { [key: string]: YamlValue } | undefined
        const parsedOptions = options ? {
      important: options.important === true,
        } : undefined
        if (actionType === 'style' && obj.style) {
            return { action: 'style', style: String(obj.style), options: parsedOptions }
        }
        if (actionType === 'unhide') return { action: 'unhide', options: parsedOptions }
        if (actionType === 'collapse') return { action: 'collapse', options: parsedOptions }
        if (actionType === 'remove') return { action: 'remove', options: parsedOptions }
        if (actionType === 'mark') return { action: 'mark', options: parsedOptions }
        return { action: 'hide', options: parsedOptions }
    }
    return { action: 'hide' }
}

function normalizeKeys(obj: { [key: string]: YamlValue }): { [key: string]: YamlValue } {
    const result: { [key: string]: YamlValue } = {}
    for (const key of Object.keys(obj)) {
        const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        const val = obj[key]
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            result[camel] = normalizeKeys(val as { [key: string]: YamlValue })
        } else {
            result[camel] = val
        }
    }
    return result
}

function parseLogicOptions(data: { [key: string]: YamlValue } | undefined): LogicOptions | undefined {
    if (!data) return undefined
    const opts: LogicOptions = { stopAtScopeForAncestor: data.stopAtScopeForAncestor !== false }
    return opts
}

function parseFrames(data: { [key: string]: YamlValue } | string | undefined): FramesBlock | undefined {
    if (!data) return undefined
    if (typeof data === 'string') return { mode: data as FrameMode }
    const result: FramesBlock = { mode: (String(data.mode || 'top-only') as FrameMode) }
    if (typeof data.accounting === 'string') result.accounting = data.accounting as FrameAccounting
    if (typeof data.maxTotalMatches === 'number') result.maxTotalMatches = data.maxTotalMatches as number
    return result
}

function parseShadowBlock(data: { [key: string]: YamlValue } | string | undefined): ShadowBlock | undefined {
    if (!data) return undefined
    if (typeof data === 'string') return { mode: data as ShadowMode }
    const result: ShadowBlock = { mode: (String(data.mode || 'none') as ShadowMode) }
    if (typeof data.allowHostAncestor === 'boolean') result.allowHostAncestor = data.allowHostAncestor as boolean
    if (typeof data.maxRootsPerCycle === 'number') result.maxRootsPerCycle = data.maxRootsPerCycle as number
    if (typeof data.observeMutations === 'boolean') result.observeMutations = data.observeMutations as boolean
    if (typeof data.observeRecursive === 'boolean') result.observeRecursive = data.observeRecursive as boolean
    return result
}

function parseRuntimeBlock(data: { [key: string]: YamlValue } | undefined): RuntimeBlock | undefined {
    if (!data) return undefined
    const result: RuntimeBlock = {}
    if (typeof data.reEvaluateOnPathChange === 'string') result.reEvaluateOnPathChange = data.reEvaluateOnPathChange as ReEvaluateOnPathChange
    if (typeof data.observeSubtree === 'boolean') result.observeSubtree = data.observeSubtree as boolean
    if (data.observeAttributes === 'auto') result.observeAttributes = 'auto'
    else if (data.observeAttributes === true || data.observeAttributes === false) result.observeAttributes = data.observeAttributes as boolean
    if (typeof data.observePathChanges === 'boolean') result.observePathChanges = data.observePathChanges as boolean
    if (typeof data.pathChangeDebounceMs === 'number') result.pathChangeDebounceMs = data.pathChangeDebounceMs as number
    if (typeof data.errorRecovery === 'string') result.errorRecovery = data.errorRecovery as RuntimeBlock['errorRecovery']
    if (typeof data.onBudgetExceeded === 'string') result.onBudgetExceeded = data.onBudgetExceeded as RuntimeBlock['onBudgetExceeded']
    return Object.keys(result).length > 0 ? result : undefined
}

function parseCacheBlock(data: { [key: string]: YamlValue } | undefined): CacheBlock | undefined {
    if (!data) return undefined
    const result: CacheBlock = {}
    if (typeof data.scope === 'string') result.scope = data.scope as CacheScope
    if (typeof data.maxEntries === 'number') result.maxEntries = data.maxEntries as number
    if (typeof data.maxAgeMs === 'number') result.maxAgeMs = data.maxAgeMs as number
    if (typeof data.evictionPolicy === 'string') result.evictionPolicy = data.evictionPolicy as EvictionPolicy
    return Object.keys(result).length > 0 ? result : undefined
}

function parsePerformanceBlock(data: { [key: string]: YamlValue } | undefined): PerformanceBlock | undefined {
    if (!data) return undefined
    const result: PerformanceBlock = {}
    if (typeof data.maxCandidates === 'number') result.maxCandidates = data.maxCandidates as number
    if (typeof data.maxEvaluationsPerCycle === 'number') result.maxEvaluationsPerCycle = data.maxEvaluationsPerCycle as number
    if (typeof data.maxAddedNodesPerCycle === 'number') result.maxAddedNodesPerCycle = data.maxAddedNodesPerCycle as number
    if (typeof data.maxRegexMsPerRuleCycle === 'number') result.maxRegexMsPerRuleCycle = data.maxRegexMsPerRuleCycle as number
    if (typeof data.dependencyPrefilter === 'boolean') result.dependencyPrefilter = data.dependencyPrefilter as boolean
    if (typeof data.dependencyDepth === 'number') result.dependencyDepth = data.dependencyDepth as number
    if (typeof data.debounceMs === 'number') result.debounceMs = data.debounceMs as number
    if (typeof data.preferCssPrefilter === 'boolean') result.preferCssPrefilter = data.preferCssPrefilter as boolean
    if (typeof data.maxRegexPatternLength === 'number') result.maxRegexPatternLength = data.maxRegexPatternLength as number
    if (typeof data.maxTextRegexInputChars === 'number') result.maxTextRegexInputChars = data.maxTextRegexInputChars as number
    if (typeof data.metrics === 'string') {
        result.metrics = data.metrics as MetricsMode
    } else if (data.metrics && typeof data.metrics === 'object' && !Array.isArray(data.metrics)) {
        const m = data.metrics as { [key: string]: YamlValue }
        if (typeof m.metrics === 'string') result.metrics = m.metrics as MetricsMode
        if (typeof m.sampleRate === 'number') result.sampleRate = m.sampleRate as number
    }
    if (typeof data.sampleRate === 'number') result.sampleRate = data.sampleRate as number
    return Object.keys(result).length > 0 ? result : undefined
}

function parseSafetyBlock(data: { [key: string]: YamlValue } | undefined): SafetyBlock | undefined {
    if (!data) return undefined
    const result: SafetyBlock = {}
    if (typeof data.preview === 'string') result.preview = data.preview as SafetyBlock['preview']
    if (typeof data.maxMatches === 'number') result.maxMatches = data.maxMatches as number
    if (typeof data.maxPagePercent === 'number') result.maxPagePercent = data.maxPagePercent as number
    if (typeof data.maxViewportAreaPercent === 'number') result.maxViewportAreaPercent = data.maxViewportAreaPercent as number
    if (typeof data.minFeatures === 'number') result.minFeatures = data.minFeatures as number
    if (typeof data.minLogicMatches === 'number') result.minLogicMatches = data.minLogicMatches as number
    if (typeof data.allowPartialApply === 'boolean') result.allowPartialApply = data.allowPartialApply as boolean
    if (typeof data.maxConsecutivePartial === 'number') result.maxConsecutivePartial = data.maxConsecutivePartial as number
    if (typeof data.partialCycleCount === 'number') result.partialCycleCount = data.partialCycleCount as number
    if (typeof data.warnIfScopeIsBody === 'boolean') result.warnIfScopeIsBody = data.warnIfScopeIsBody as boolean
    if (typeof data.warnIfNoWhereLogic === 'boolean') result.warnIfNoWhereLogic = data.warnIfNoWhereLogic as boolean
    if (typeof data.warnIfActionRemove === 'boolean') result.warnIfActionRemove = data.warnIfActionRemove as boolean
    if (typeof data.confirmPageRoot === 'boolean') result.confirmPageRoot = data.confirmPageRoot as boolean
    if (typeof data.warnIfWeakExactReference === 'boolean') result.warnIfWeakExactReference = data.warnIfWeakExactReference as boolean
    return Object.keys(result).length > 0 ? result : undefined
}

function parseRuleMetadata(data: { [key: string]: YamlValue } | undefined, now: string): { createdAt: string } | undefined {
    if (!data) return undefined
    const meta: { createdAt: string; updatedAt?: string; source?: RuleSource; title?: string; description?: string; createdBy?: string; history?: RuleHistoryEntry[]; originalSyntax?: string; originalId?: string } = { createdAt: now }
    if (typeof data.createdAt === 'string') meta.createdAt = data.createdAt
    if (typeof data.updatedAt === 'string') meta.updatedAt = data.updatedAt
    if (typeof data.source === 'string') meta.source = data.source as RuleSource
    if (typeof data.title === 'string') meta.title = data.title
    if (typeof data.description === 'string') meta.description = data.description
    if (typeof data.createdBy === 'string') meta.createdBy = data.createdBy
    if (typeof data.originalSyntax === 'string') meta.originalSyntax = data.originalSyntax
    if (typeof data.originalId === 'string') meta.originalId = data.originalId
    if (typeof data.history === 'object' && data.history !== null) {
        meta.history = Array.isArray(data.history) ? data.history as unknown as RuleHistoryEntry[] : undefined
    }
    return meta
}

function parseProvenance(data: { [key: string]: YamlValue } | undefined): RuleProvenance | undefined {
    if (!data) return undefined
    const result: RuleProvenance = {}
    if (typeof data.createdBy === 'string') result.createdBy = data.createdBy as string
    if (typeof data.createdFromHost === 'string') result.createdFromHost = data.createdFromHost as string
    if (typeof data.createdFromPath === 'string') result.createdFromPath = data.createdFromPath as string
    if (typeof data.originalRuleText === 'string') result.originalRuleText = data.originalRuleText as string
    if (typeof data.originalSource === 'string') result.originalSource = data.originalSource as string
    if (typeof data.source === 'string') result.source = data.source as string
    if (typeof data.originalRuleId === 'string') result.originalRuleId = data.originalRuleId as string
    if (typeof data.importTimestamp === 'string') result.importTimestamp = data.importTimestamp as string
    return Object.keys(result).length > 0 ? result : undefined
}

function parseActionOptions(data: { [key: string]: YamlValue } | undefined): ActionOptions | undefined {
    if (!data) return undefined
    const result: ActionOptions = {}
    if (typeof data.important === 'boolean') result.important = data.important as boolean
    return Object.keys(result).length > 0 ? result : undefined
}

function parsePreviewBlock(data: { [key: string]: YamlValue } | undefined): PreviewState | undefined {
    if (!data) return undefined
    const rawStatus = String(data.status || 'none')
    const validStatuses: PreviewStatus[] = ['none', 'required', 'previewed', 'confirmed', 'stale', 'forced-by-policy']
    const status = validStatuses.includes(rawStatus as PreviewStatus) ? rawStatus as PreviewStatus : 'none'
    const result: PreviewState = { status }
    if (typeof data.confirmationHash === 'string') result.confirmationHash = data.confirmationHash as string
    if (typeof data.confirmedAt === 'string') result.confirmedAt = data.confirmedAt as string
    if (typeof data.relaxedCapsUsed === 'boolean') result.relaxedCapsUsed = data.relaxedCapsUsed as boolean
    return result
}

function createRuleId(): string {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
    const seg = (len: number) => Array.from({ length: len }, hex).join('')
    return `${RULE_ID_PREFIX}${seg(4)}-${seg(2)}-${seg(2)}-${seg(2)}-${seg(6)}`
}

function intermediateToRule(intermediate: IntermediateRule): SmartCosmeticRule | null {
    const originalData = intermediate.data
    const typeKey = intermediate.type
    const camelKey = typeKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

    // data may be wrapped: { 'hide-exact': { targets: [...], ... } }
    let ruleBody: { [key: string]: YamlValue }
    if (originalData && typeof originalData === 'object') {
        if (typeKey in originalData && typeof originalData[typeKey] === 'object' && originalData[typeKey] !== null) {
            // Container format: data = { id: 'x', type: 'hide-exact', 'hide-exact': { targets: [...], ... } }
            ruleBody = originalData[typeKey] as { [key: string]: YamlValue }
        } else if (camelKey in originalData && typeof originalData[camelKey] === 'object' && originalData[camelKey] !== null) {
            ruleBody = originalData[camelKey] as { [key: string]: YamlValue }
        } else {
            // Single rule at root: data is the rule body itself
            ruleBody = originalData as { [key: string]: YamlValue }
        }
    } else {
        return null
    }

    ruleBody = normalizeKeys(ruleBody)

    const now = new Date().toISOString()
    const id = String((originalData && typeof originalData === 'object' && 'id' in originalData && typeof originalData['id'] === 'string') ? originalData['id'] : (ruleBody.id || createRuleId()))
    const rawState = typeof ruleBody.state === 'string' ? ruleBody.state : ''
    const state = rawState ? normalizeRuleState(rawState) : (intermediate.type === 'hide-exact' ? 'active' : 'needs-preview')
    const meta = parseRuleMetadata(ruleBody.metadata as { [key: string]: YamlValue } | undefined, now) || { createdAt: now }
    const provenance = ruleBody.provenance ? parseProvenance(ruleBody.provenance as { [key: string]: YamlValue }) : undefined
    const targets = parseTargets(ruleBody.targets)
    if (targets.length === 0) return null
    const priority = typeof ruleBody.priority === 'number' ? ruleBody.priority : undefined
    const actionObj = parseAction(ruleBody.action)
    const topLevelActionOptions = ruleBody.actionOptions ? parseActionOptions(ruleBody.actionOptions as { [key: string]: YamlValue }) : undefined
    if (topLevelActionOptions && !actionObj.options) actionObj.options = topLevelActionOptions
    const previewFromInput = ruleBody.preview ? parsePreviewBlock(ruleBody.preview as { [key: string]: YamlValue }) : undefined

    const commonBlocks = () => ({
    priority,
    frames: ruleBody.frames ? parseFrames(ruleBody.frames as { [key: string]: YamlValue }) : undefined,
    shadow: ruleBody.shadow ? parseShadowBlock(ruleBody.shadow as { [key: string]: YamlValue }) : undefined,
    runtime: ruleBody.runtime ? parseRuntimeBlock(ruleBody.runtime as { [key: string]: YamlValue }) : undefined,
    cache: ruleBody.cache ? parseCacheBlock(ruleBody.cache as { [key: string]: YamlValue }) : undefined,
    performance: ruleBody.performance ? parsePerformanceBlock(ruleBody.performance as { [key: string]: YamlValue }) : undefined,
    safety: ruleBody.safety ? parseSafetyBlock(ruleBody.safety as { [key: string]: YamlValue }) : undefined,
    metadata: meta,
    })

    switch (intermediate.type) {
    case 'hide-exact': {
        const selector = String(ruleBody.selector || ruleBody.selectors || '')
        if (!selector) return null
        const rule = {
        type: 'hide-exact',
        id, syntaxVersion: 1, state,
        targets,
        selector,
        action: actionObj,
        preview: previewFromInput || { status: 'confirmed' },
        ...commonBlocks(),
        } as HideExactRule
        if (ruleBody.paths) rule.paths = parsePaths(ruleBody.paths)
        if (ruleBody.scope) rule.scope = parseScope(ruleBody.scope)
        return rule
    }

    case 'hide-similar': {
        if (ruleBody.selector) return null
        const rule = {
        type: 'hide-similar',
        id, syntaxVersion: 1, state,
        targets,
        candidates: parseCandidates(ruleBody.candidates),
        boundary: ruleBody.boundary ? parseBoundary(ruleBody.boundary as { [key: string]: YamlValue }) : { ...DEFAULT_BOUNDARY, mode: 'repeated-card' },
        match: parseMatch(ruleBody.match as { [key: string]: YamlValue }) || { mode: 'similar' },
        action: actionObj,
        preview: previewFromInput || { status: 'required' },
        ...commonBlocks(),
        } as HideSimilarRule
        if (ruleBody.paths) rule.paths = parsePaths(ruleBody.paths)
        if (ruleBody.scope) rule.scope = parseScope(ruleBody.scope)
        if (ruleBody.where) rule.where = parseWhere(ruleBody, 'where')
        if (ruleBody.except) rule.except = parseWhere(ruleBody, 'except')
        return rule
    }

    case 'smart-hide': {
        if (ruleBody.selector) return null
        const candidates = parseCandidates(ruleBody.candidates)
        if (!candidates) return null
        const rule = {
        type: 'smart-hide',
        id, syntaxVersion: 1, state,
        targets,
        candidates,
        boundary: ruleBody.boundary ? parseBoundary(ruleBody.boundary as { [key: string]: YamlValue }) : { ...DEFAULT_BOUNDARY, mode: 'repeated-card' },
        match: parseMatch(ruleBody.match as { [key: string]: YamlValue }),
        action: actionObj,
        preview: previewFromInput || { status: 'required' },
        keywordMerge: ruleBody.keywordMerge === true,
        ...commonBlocks(),
        } as SmartHideRule
        if (ruleBody.paths) rule.paths = parsePaths(ruleBody.paths)
        if (ruleBody.scope) rule.scope = parseScope(ruleBody.scope)
        if (ruleBody.where) rule.where = parseWhere(ruleBody, 'where')
        if (ruleBody.except) rule.except = parseWhere(ruleBody, 'except')
        if (ruleBody.keywords) rule.keywords = parseKeywords(ruleBody.keywords as { [key: string]: YamlValue })
        return rule
    }

    case 'smart-allow': {
        if (ruleBody.selector) return null
        const rule = {
        type: 'smart-allow',
        id, syntaxVersion: 1, state,
        targets,
        candidates: parseCandidates(ruleBody.candidates),
        boundary: ruleBody.boundary ? parseBoundary(ruleBody.boundary as { [key: string]: YamlValue }) : undefined,
        match: parseMatch(ruleBody.match as { [key: string]: YamlValue }) || { mode: 'none' },
        allowBroad: ruleBody.allowBroad === true,
        logicOptions: ruleBody.logicOptions ? parseLogicOptions(ruleBody.logicOptions as { [key: string]: YamlValue }) : undefined,
        provenance,
        action: actionObj,
        preview: previewFromInput || { status: 'confirmed' },
        ...commonBlocks(),
        } as SmartAllowRule
        if (ruleBody.paths) rule.paths = parsePaths(ruleBody.paths)
        if (ruleBody.scope) rule.scope = parseScope(ruleBody.scope)
        if (ruleBody.where) rule.where = parseWhere(ruleBody, 'where')
        if (ruleBody.except) rule.except = parseWhere(ruleBody, 'except')
        if (ruleBody.keywords) rule.keywords = parseKeywords(ruleBody.keywords as { [key: string]: YamlValue })
        if (ruleBody.keywordMerge) rule.keywordMerge = ruleBody.keywordMerge === true
        return rule
    }

    default:
        return null
    }
}

export function parseSmartRules(yaml: string): { rules: SmartCosmeticRule[]; errors: string[] } {
    const errors: string[] = []
    const parseResult = parseYaml(yaml)
    for (const pe of parseResult.errors) {
    errors.push(`Parse error near line ${pe.line}: ${pe.message}`)
    }

    const { rules: intermediates } = extractRulesFromParsed(parseResult.value)
    if (intermediates.length === 0) {
    errors.push('No rules found in YAML input')
    return { rules: [], errors }
    }

    const rules: SmartCosmeticRule[] = []
    for (const inter of intermediates) {
        const rule = intermediateToRule(inter)
        if (rule) {
      rules.push(rule)
        } else {
      errors.push(`Failed to parse rule: type=${inter.type}`)
        }
    }

    return { rules, errors }
}
