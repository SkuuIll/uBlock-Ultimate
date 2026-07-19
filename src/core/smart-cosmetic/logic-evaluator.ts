import type {
    LogicExpression, LogicCondition, LogicGroup, LogicExpressionItem,
    SimpleCondition, RegexCondition, ExistenceCondition,
    SelectorMatchCondition, HasDescendantCondition, HasAncestorCondition,
    NumericCondition, AttributeCondition, AttributeFamilyCondition,
    KeywordBlock, SmartHideRule, HideSimilarRule,
} from './smart-rule-schema'
import { DEFAULT_PERFORMANCE } from './smart-rule-schema'

export interface LogicDiagnostic {
  code: string
  message: string
  condition?: string
}

export interface MinLogicMatchOptions {
  minLogicMatches?: number
}

export interface LogicEvalResult {
  passed: boolean
  matchedCount: number
  diagnostics: LogicDiagnostic[]
}

const MAX_ANCESTOR_DEPTH = 100

export interface LogicEvalOptions extends MinLogicMatchOptions {
  scopeRoot?: Element | null
  stopAtScopeForAncestor?: boolean
}

export function evaluateWhereExcept(
    element: Element,
    where?: LogicExpression,
    except?: LogicExpression,
    options?: LogicEvalOptions,
): LogicEvalResult {
    const diagnostics: LogicDiagnostic[] = []
    let whereMatchedCount = 0
    let wherePassed = true
    let exceptPassed = false
    const evalOpts = options ?? {}

    if (where) {
        const whereResult = evaluateLogicExpression(element, where, 'where', diagnostics, evalOpts)
        wherePassed = whereResult.passed
        whereMatchedCount = whereResult.matchedCount
    }

    if (except) {
        const exceptResult = evaluateLogicExpression(element, except, 'except', diagnostics, evalOpts)
        exceptPassed = exceptResult.passed
    }

    const minMatches = options?.minLogicMatches ?? 1
    const matchCountOk = whereMatchedCount >= minMatches || !where

    const passed = wherePassed && matchCountOk && !exceptPassed

    return { passed, matchedCount: whereMatchedCount, diagnostics }
}

function evaluateLogicExpression(
    element: Element,
    expr: LogicExpression,
    context: 'where' | 'except',
    diagnostics: LogicDiagnostic[],
    options?: LogicEvalOptions,
): { passed: boolean; matchedCount: number } {
    if ('condition' in expr) {
        const item = expr as LogicExpressionItem
        const result = evaluateCondition(element, item.condition, diagnostics, options)
        return { passed: result, matchedCount: result ? 1 : 0 }
    }

    const group = expr as LogicGroup
    if (group.all) {
        let count = 0
        for (const sub of group.all) {
            const r = evaluateLogicExpression(element, sub, context, diagnostics, options)
            if (!r.passed) return { passed: false, matchedCount: count }
            count += r.matchedCount
        }
        return { passed: true, matchedCount: count }
    }

    if (group.any) {
        let count = 0
        let found = false
        for (const sub of group.any) {
            const r = evaluateLogicExpression(element, sub, context, diagnostics, options)
            if (r.passed) found = true
            if (found) count += r.matchedCount
        }
        if (found) return { passed: true, matchedCount: count }
        return { passed: false, matchedCount: 0 }
    }

    if (group.none) {
        let count = 0
        for (const sub of group.none) {
            const r = evaluateLogicExpression(element, sub, context, diagnostics, options)
            if (r.passed) return { passed: false, matchedCount: count }
            count += r.matchedCount
        }
        return { passed: true, matchedCount: 0 }
    }

    return { passed: false, matchedCount: 0 }
}

function evaluateCondition(
    element: Element,
    condition: LogicCondition,
    diagnostics: LogicDiagnostic[],
    options?: LogicEvalOptions,
): boolean {
    const start = performance.now()
    const timeout = DEFAULT_PERFORMANCE.maxRegexMsPerRuleCycle ?? 10
    try {
        const result = doEvaluateCondition(element, condition, diagnostics, options)
        const elapsed = performance.now() - start
        if (elapsed > timeout) {
      diagnostics.push({
        code: 'LOGIC_TIMEOUT',
        message: `Condition evaluation exceeded ${timeout}ms (${elapsed.toFixed(0)}ms)`,
      })
        }
        return result
    } catch (e) {
    diagnostics.push({
      code: 'LOGIC_ERROR',
      message: `Condition evaluation error: ${e instanceof Error ? e.message : String(e)}`,
    })
    return false
    }
}

function doEvaluateCondition(
    element: Element,
    condition: LogicCondition,
    diagnostics: LogicDiagnostic[],
    options?: LogicEvalOptions,
): boolean {
    if ('attrName' in condition && !('operator' in condition)) {
        const c = condition as AttributeCondition
        return evaluateAttributeCondition(element, c)
    }

    if ('attrFamily' in condition) {
        const c = condition as AttributeFamilyCondition
        return evaluateAttributeFamilyCondition(element, c)
    }

    if ('field' in condition && 'operator' in condition) {
        const op = (condition as any).operator
        if (op === '>=' || op === '<=' || op === '>' || op === '<' || op === '==') {
            return evaluateNumericCondition(element, condition as NumericCondition)
        }
    }

    if ('operator' in condition) {
        if (condition.operator === 'count') {
            try {
                return (condition as any).value && element.querySelectorAll((condition as any).value).length > 0
            } catch(e) { console.warn('[uBR] logic-evaluator: count querySelectorAll failed', e); return false }
        }
        if (condition.operator === 'density') {
            try {
                const total = element.children.length
                if (total === 0) return false
                const matching = element.querySelectorAll((condition as any).value).length
                return matching / total > 0
            } catch(e) { console.warn('[uBR] logic-evaluator: density querySelectorAll failed', e); return false }
        }
        switch (condition.operator) {
        case 'equals':
        case 'not-equals':
        case 'contains':
        case 'starts-with':
        case 'ends-with': {
            const c = condition as SimpleCondition
            return evaluateSimpleCondition(element, c, condition.operator === 'not-equals')
        }
        case 'regex': {
            const c = condition as RegexCondition
            return evaluateRegexCondition(element, c, diagnostics)
        }
        case 'exists':
        case 'not-exists': {
            const c = condition as ExistenceCondition
            return evaluateExistenceCondition(element, c)
        }
        case 'selector-matches': {
            const c = condition as SelectorMatchCondition
            return element.matches?.(c.selector) ?? false
        }
        case 'has-descendant': {
            const c = condition as HasDescendantCondition
            return evaluateHasDescendant(element, c, diagnostics)
        }
        case 'has-ancestor': {
            const c = condition as HasAncestorCondition
            return evaluateHasAncestor(element, c, diagnostics, options?.scopeRoot, options?.stopAtScopeForAncestor)
        }
        default:
            return false
        }
    }

    return false
}

function getFieldValue(element: Element, field: string): string {
    switch (field) {
    case 'text': {
        if (element.shadowRoot) {
            return (element.shadowRoot.textContent ?? '').trim()
        }
        return (element.textContent ?? '').trim()
    }
    case 'all-text': {
        if (element.shadowRoot) {
            return element.shadowRoot.textContent ?? ''
        }
        return element.textContent ?? ''
    }
    case 'own-text': {
        let text = ''
        for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent ?? ''
            }
        }
        return text.trim()
    }
    case 'semantic-text': {
        const clone = element.cloneNode(true) as Element
        for (const el of clone.querySelectorAll('script, style, template, [aria-hidden="true"]')) {
        el.remove()
        }
        return (clone.textContent ?? '').trim()
    }
    case 'aria-label':
        return element.getAttribute('aria-label') ?? ''
    case 'alt':
        return (element as HTMLElement).getAttribute?.('alt') ?? ''
    case 'href':
        return (element as HTMLAnchorElement).href ?? ''
    case 'role':
        return element.getAttribute('role') ?? ''
    case 'tag':
        return element.tagName.toLowerCase()
    default:
        if (field.startsWith('data-') || field.startsWith('aria-')) {
            return element.getAttribute(field) ?? ''
        }
        return element.getAttribute(field) ?? ''
    }
}

function getNumericFieldValue(element: Element, field: string): number {
    switch (field) {
    case 'text-length':
        return (element.textContent ?? '').trim().length
    case 'link-count':
        return element.querySelectorAll('a[href]').length
    case 'link-density': {
        const textLen = (element.textContent ?? '').trim().length
        if (textLen === 0) return 0
        const linkTextLen = Array.from(element.querySelectorAll('a[href]'))
        .reduce((s, a) => s + ((a.textContent ?? '').trim().length), 0)
        return linkTextLen / textLen
    }
    case 'child-count':
        return element.children.length
    default:
        return 0
    }
}

function getAllMatchingAttributeValues(
    element: Element,
    prefix: string,
): Map<string, string> {
    const result = new Map<string, string>()
    const prefixLen = prefix.length
    if (element.hasAttributes?.()) {
        for (let i = 0; i < element.attributes.length; i++) {
            const attr = element.attributes[i]
            if (attr.name.startsWith(prefix) && attr.name.length > prefixLen) {
        result.set(attr.name, attr.value)
            }
        }
    }
    return result
}

function evaluateSimpleCondition(
    element: Element,
    cond: SimpleCondition,
    negate: boolean,
): boolean {
    const value = getFieldValue(element, cond.field)
    if (cond.field === 'all-text') {
        const match = applySimpleMatch(value, cond.operator, cond.value, cond.caseSensitive)
        return negate ? !match : match
    }

    switch (cond.operator) {
    case 'equals':
        return compareText(value, cond.value, !negate, cond.caseSensitive)
    case 'contains':
        return compareTextContains(value, cond.value, !negate, cond.caseSensitive)
    case 'starts-with':
        return compareTextStartsWith(value, cond.value, !negate, cond.caseSensitive)
    case 'ends-with':
        return compareTextEndsWith(value, cond.value, !negate, cond.caseSensitive)
    default:
        return false
    }
}

function applySimpleMatch(
    text: string,
    operator: string,
    value: string,
    caseSensitive?: boolean,
): boolean {
    const a = caseSensitive ? text : text.toLowerCase()
    const b = caseSensitive ? value : value.toLowerCase()
    switch (operator) {
    case 'equals': return a === b
    case 'contains': return a.includes(b)
    case 'starts-with': return a.startsWith(b)
    case 'ends-with': return a.endsWith(b)
    default: return false
    }
}

function compareText(
    value: string,
    expected: string,
    shouldEqual: boolean,
    caseSensitive?: boolean,
): boolean {
    const a = caseSensitive ? value : value.toLowerCase()
    const b = caseSensitive ? expected : expected.toLowerCase()
    return shouldEqual ? a === b : a !== b
}

function compareTextContains(
    haystack: string,
    needle: string,
    shouldContain: boolean,
    caseSensitive?: boolean,
): boolean {
    const a = caseSensitive ? haystack : haystack.toLowerCase()
    const b = caseSensitive ? needle : needle.toLowerCase()
    return shouldContain ? a.includes(b) : !a.includes(b)
}

function compareTextStartsWith(
    text: string,
    prefix: string,
    shouldStart: boolean,
    caseSensitive?: boolean,
): boolean {
    const a = caseSensitive ? text : text.toLowerCase()
    const b = caseSensitive ? prefix : prefix.toLowerCase()
    return shouldStart ? a.startsWith(b) : !a.startsWith(b)
}

function compareTextEndsWith(
    text: string,
    suffix: string,
    shouldEnd: boolean,
    caseSensitive?: boolean,
): boolean {
    const a = caseSensitive ? text : text.toLowerCase()
    const b = caseSensitive ? suffix : suffix.toLowerCase()
    return shouldEnd ? a.endsWith(b) : !a.endsWith(b)
}

const MAX_TEXT_REGEX_INPUT_CHARS = 4096

function evaluateRegexCondition(
    element: Element,
    cond: RegexCondition,
    diagnostics: LogicDiagnostic[],
): boolean {
    let value = getFieldValue(element, cond.field)
    if (value.length > MAX_TEXT_REGEX_INPUT_CHARS) {
        value = value.slice(0, MAX_TEXT_REGEX_INPUT_CHARS)
    diagnostics.push({ code: 'TEXT_TRUNCATED', message: `Regex input truncated to ${MAX_TEXT_REGEX_INPUT_CHARS} chars` })
    }
    try {
        const flags = cond.flags ?? ''
        const re = new RegExp(cond.pattern, flags.includes('i') ? 'i' : '')
        return re.test(value)
    } catch (e) {
    console.warn('[uBR] logic-evaluator: regex test failed', cond.pattern, e)
    return false
    }
}

function evaluateExistenceCondition(
    element: Element,
    cond: ExistenceCondition,
): boolean {
    const value = getFieldValue(element, cond.field)
    const exists = value.length > 0
    return cond.operator === 'exists' ? exists : !exists
}

function evaluateHasDescendant(
    element: Element,
    cond: HasDescendantCondition,
    diagnostics: LogicDiagnostic[],
): boolean {
    try {
        const descendants = element.querySelectorAll(cond.selector)
        if (descendants.length > 0) return true

        if (element.shadowRoot) {
            const shadowResult = element.shadowRoot.querySelector(cond.selector)
            if (shadowResult) return true
        }

        return false
    } catch {
    diagnostics.push({
      code: 'INVALID_SELECTOR',
      message: `Invalid has-descendant selector: ${cond.selector}`,
    })
    return false
    }
}

function evaluateHasAncestor(
    element: Element,
    cond: HasAncestorCondition,
    diagnostics: LogicDiagnostic[],
    scopeRoot?: Element | null,
    stopAtScopeForAncestor?: boolean,
): boolean {
    let current = element.parentElement
    let depth = 0
    try {
        while (current && depth < MAX_ANCESTOR_DEPTH) {
            if (stopAtScopeForAncestor && scopeRoot && current === scopeRoot) return false
            if (current.matches?.(cond.selector)) return true
            current = current.parentElement
            depth++
        }
    } catch {
    diagnostics.push({
      code: 'INVALID_SELECTOR',
      message: `Invalid has-ancestor selector: ${cond.selector}`,
    })
    }
    return false
}

function evaluateNumericCondition(
    element: Element,
    cond: NumericCondition,
): boolean {
    const value = getNumericFieldValue(element, cond.field)
    switch (cond.operator) {
    case '>=': return value >= cond.value
    case '<=': return value <= cond.value
    case '>': return value > cond.value
    case '<': return value < cond.value
    case '==': return value === cond.value
    default: return false
    }
}

function evaluateAttributeCondition(
    element: Element,
    cond: AttributeCondition,
): boolean {
    const attrName = cond.attrName
    if (cond.family === 'data' || cond.family === 'aria') {
        const prefix = cond.family === 'data' ? 'data-' : 'aria-'
        const attrs = getAllMatchingAttributeValues(element, prefix)
        return attrs.size > 0
    }
    const val = element.getAttribute(attrName) ?? ''
    return val.length > 0
}

function applyAttributeValueMatch(
    value: string,
    operator: string,
    cond: AttributeFamilyCondition,
): boolean {
    const pattern = cond.pattern
    switch (operator) {
    case 'equals':
        return value.toLowerCase() === pattern.toLowerCase()
    case 'contains':
        return value.toLowerCase().includes(pattern.toLowerCase())
    case 'regex': {
        try {
            return new RegExp(pattern, 'i').test(value)
        } catch (e) {
        console.warn('[uBR] logic-evaluator: applyAttributeValueMatch regex failed', pattern, e)
        return false
        }
    }
    default:
        return value.length > 0
    }
}

function evaluateAttributeFamilyCondition(
    element: Element,
    cond: AttributeFamilyCondition,
): boolean {
    const prefix = cond.attrFamily === 'data-*' ? 'data-' : 'aria-'
    const attrs = getAllMatchingAttributeValues(element, prefix)
    for (const [, val] of attrs) {
        if (applyAttributeValueMatch(val, cond.operator, cond)) return true
    }
    return false
}

export function evaluateKeywordBlock(
    element: Element,
    keywords: KeywordBlock,
): LogicEvalResult {
    const diagnostics: LogicDiagnostic[] = []
    const fields = keywords.fields ?? ['text']
    const text = fields.map(f => getFieldValue(element, f)).join(' ')

    const matchMode = keywords.matchMode ?? 'phrase'
    const caseSensitive = keywords.caseSensitive ?? false
    const wordBoundary = keywords.wordBoundary ?? false

    let matchedCount = 0

    function matchesKeyword(text: string, keyword: string): boolean {
        const t = caseSensitive ? text : text.toLowerCase()
        const k = caseSensitive ? keyword : keyword.toLowerCase()

        switch (matchMode) {
        case 'phrase':
            return t.includes(k)
        case 'word': {
            const pattern = wordBoundary
                ? new RegExp(`\\b${escapeRegex(k)}\\b`, caseSensitive ? '' : 'i')
                : new RegExp(escapeRegex(k), caseSensitive ? '' : 'i')
            return pattern.test(t)
        }
        case 'regex': {
            try {
                return new RegExp(keyword, caseSensitive ? '' : 'i').test(text)
            } catch (e) {
          console.warn('[uBR] logic-evaluator: matchesKeyword regex failed', keyword, e)
          return false
            }
        }
        default:
            return false
        }
    }

    if (keywords.includeAny && keywords.includeAny.length > 0) {
        const anyPass = keywords.includeAny.some(kw => matchesKeyword(text, kw))
        if (!anyPass) {
            return { passed: false, matchedCount: 0, diagnostics }
        }
        matchedCount++
    }

    if (keywords.includeAll && keywords.includeAll.length > 0) {
        const allPass = keywords.includeAll.every(kw => matchesKeyword(text, kw))
        if (!allPass) {
            return { passed: false, matchedCount: 0, diagnostics }
        }
        matchedCount++
    }

    if (keywords.excludeAny && keywords.excludeAny.length > 0) {
        const anyExcluded = keywords.excludeAny.some(kw => matchesKeyword(text, kw))
        if (anyExcluded) {
            return { passed: false, matchedCount: 0, diagnostics }
        }
    }

    if (keywords.excludeAll && keywords.excludeAll.length > 0) {
        const allExcluded = keywords.excludeAll.every(kw => matchesKeyword(text, kw))
        if (allExcluded) {
            return { passed: false, matchedCount: 0, diagnostics }
        }
    }

    return { passed: true, matchedCount, diagnostics }
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function evaluateRuleLogic(
    element: Element,
    rule: SmartHideRule | HideSimilarRule,
): LogicEvalResult {
    const isSmartHide = rule.type === 'smart-hide'
    const smartHide = isSmartHide ? rule as SmartHideRule : null

    if (isSmartHide && smartHide.keywords) {
        if (smartHide.keywordMerge) {
            if (smartHide.where) {
                const whereResult = evaluateWhereExcept(element, smartHide.where)
                if (!whereResult.passed) return whereResult
            }
            const kwResult = evaluateKeywordBlock(element, smartHide.keywords)
            if (!kwResult.passed) return kwResult
            if (rule.except) {
                const exceptResult = evaluateWhereExcept(element, undefined, rule.except)
                if (exceptResult.passed) return { passed: false, matchedCount: 0, diagnostics: exceptResult.diagnostics }
            }
            return { passed: true, matchedCount: 1, diagnostics: [] }
        }

        if (smartHide.where) {
            return evaluateWhereExcept(element, smartHide.where, rule.except, { minLogicMatches: rule.safety?.minLogicMatches })
        }
        const kwResult = evaluateKeywordBlock(element, smartHide.keywords)
        if (!kwResult.passed) return kwResult
        if (rule.except) {
            const exceptResult = evaluateWhereExcept(element, undefined, rule.except)
            if (exceptResult.passed) return { passed: false, matchedCount: 0, diagnostics: exceptResult.diagnostics }
        }
        return { passed: true, matchedCount: 1, diagnostics: [] }
    }

    return evaluateWhereExcept(
        element,
    rule.where,
    rule.except,
    { minLogicMatches: rule.safety?.minLogicMatches },
    )
}

export function getDependencySelectors(expr: LogicExpression): string[] {
    const selectors: string[] = []
    collectDependencySelectors(expr, selectors)
    return selectors
}

function collectDependencySelectors(expr: LogicExpression, out: string[]): void {
    if ('condition' in expr) {
        const item = expr as LogicExpressionItem
        const c = item.condition
        if ('operator' in c) {
            if (c.operator === 'has-descendant') out.push((c as HasDescendantCondition).selector)
            if (c.operator === 'selector-matches') out.push((c as SelectorMatchCondition).selector)
            if (c.operator === 'has-ancestor') out.push((c as HasAncestorCondition).selector)
        }
        return
    }
    const group = expr as LogicGroup
    for (const sub of group.all ?? []) collectDependencySelectors(sub, out)
    for (const sub of group.any ?? []) collectDependencySelectors(sub, out)
    for (const sub of group.none ?? []) collectDependencySelectors(sub, out)
}

export * as LogicEvaluator from "./logic-evaluator"
