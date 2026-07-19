import type { Diagnostic } from './smart-rule-diagnostics'
import { diagnostic, DIAGNOSTIC_CODES } from './smart-rule-diagnostics'
import type {
    TargetEntry, PathEntry, Boundary, MatchBlock,
    SafetyBlock, ShadowBlock, FramesBlock, RuntimeBlock, CacheBlock, PerformanceBlock, SmartCosmeticRule,
    HideExactRule, HideSimilarRule, SmartHideRule, SmartAllowRule,
    LogicExpression, LogicCondition, SmartRuleType,
} from './smart-rule-schema'
import { SAFE_STYLE_PROPERTIES } from './smart-rule-schema'

export interface ValidationResult {
  valid: boolean
  diagnostics: Diagnostic[]
}

const UNSAFE_SELECTOR_PATTERNS = [
  /:has\(/,
  /:has-text\(/,
  /:contains\(/,
  /:matches-css\(/,
  /:matches-property\(/,
  /:upward\(/,
  /:xpath\(/,
  /:host-context\(/,
  /::(before|after|part|slotted)/,
  /\\b/,
]

const ALLOWED_REGEX_FLAGS = new Set(['i', 'm', 'u', 's', 'g'])
const REJECTED_REGEX_FLAGS = new Set(['v', 'y', 'd'])

export function isSafeSelector(selector: string): boolean {
    return !UNSAFE_SELECTOR_PATTERNS.some(p => p.test(selector))
}

export function validateRegexFlags(flags: string): string[] {
    const errors: string[] = []
    for (const f of flags) {
        if (REJECTED_REGEX_FLAGS.has(f)) {
      errors.push(`Regex flag '${f}' is not allowed`)
        } else if (!ALLOWED_REGEX_FLAGS.has(f)) {
      errors.push(`Unknown regex flag '${f}'`)
        }
    }
    return errors
}

export function parseRegexLiteral(raw: string): { pattern: string; flags: string } | null {
    if (!raw.startsWith('/')) return null
    const lastSlash = raw.lastIndexOf('/')
    if (lastSlash <= 0) return null
    return {
    pattern: raw.slice(1, lastSlash),
    flags: raw.slice(lastSlash + 1),
    }
}

export function isStrongWhereLogic(expression: LogicExpression): boolean {
    if ('condition' in expression) {
        return isStrongCondition(expression.condition)
    }
    const group = expression as { all?: LogicExpression[]; any?: LogicExpression[]; none?: LogicExpression[] }
    if (group.all && group.all.some(e => isStrongWhereLogic(e))) return true
    if (group.any && group.any.some(e => isStrongWhereLogic(e))) return true
    return false
}

function isStrongCondition(cond: LogicCondition): boolean {
    const field = ('field' in cond) ? (cond as any).field : ''
    const operator = ('operator' in cond) ? (cond as any).operator : ''
    const value = ('value' in cond) ? String((cond as any).value || '') : ''
    const pattern = ('pattern' in cond) ? String((cond as any).pattern || '') : ''

    if (field === 'href' || field.startsWith('attr(href')) {
        return ['equals', 'contains', 'starts-with', 'ends-with', 'regex', 'regex-like'].includes(operator) && value.length >= 1
    }
    if (field.startsWith('aria-') || field.startsWith('attr(aria-')) {
        if (operator === 'regex' || operator === 'contains' || operator === 'equals') {
            return pattern.length >= 1 || value.length >= 1
        }
    }
    if (field.startsWith('data-') || field.startsWith('attr(data-')) {
        const val = value || pattern
        if (val.length > 0 && val.length < 40 && !/^[a-f0-9]{16,}$/i.test(val) && !/^[A-Za-z0-9+/]{20,}={0,2}$/.test(val)) {
            return operator === 'equals' || operator === 'contains' || operator === 'regex'
        }
    }
    if (field === 'text' || field === 'all-text' || field === 'own-text' || field === 'semantic-text') {
        if (operator === 'equals' && value.length >= 6) return true
        if (operator === 'contains' && value.length >= 8 && (/[\s,.;:!?\-'"(){}\[\]/]/.test(value) || /\s/.test(value))) return true
        if ((operator === 'regex' || operator === 'regex-like') && pattern.length >= 3) return true
    }
    if (operator === 'selector-matches') {
        const sel = ('selector' in cond) ? (cond as any).selector || '' : ''
        return (/^[a-z]+\[[a-z-]+[=*^$]/.test(sel) || /^[a-z]+\[(role|aria|data|href|id)/i.test(sel))
    }
    if (operator === 'has-descendant' || operator === 'has-ancestor') {
        const sel = ('selector' in cond) ? (cond as any).selector || '' : ''
        return (/^[a-z]+\[[a-z-]+[=*^$]/.test(sel) || /^[a-z]+\[(role|aria|data|href|id)/i.test(sel))
    }
    return false
}

const VALID_WEIGHT_PROFILES = new Set(['default-card', 'structural-heavy', 'content-heavy'])

export function getDefaultThreshold(ruleType: SmartRuleType, matchMode: string, hasStrongLogic: boolean): number | undefined {
    if (matchMode === 'none' || matchMode === 'exact') return undefined

    if (ruleType === 'hide-similar') {
        if (matchMode === 'structural') return 0.80
        return 0.82
    }

    if (ruleType === 'smart-hide') {
        if (matchMode === 'structural') {
            return hasStrongLogic ? 0.76 : 0.80
        }
        if (matchMode === 'similar') {
            return hasStrongLogic ? 0.74 : 0.82
        }
    }

    return 0.82
}

const MAX_REGEX_PATTERN_LENGTH = 256

const NESTED_QUANTIFIER_RE = /\([^)]+\)[?*+][?*+{]/;

const BACKREFERENCE_RE = /\\(\d+)/;

const NAMED_BACKREFERENCE_RE = /\\k<[^>]+>/;

const CATASTROPHIC_ALTERNATION_RE = /\(\s*[^)]+\|\s*[^)]+\|\s*[^)]*\)[+*]/;
const LOOKBEHIND_RE = /\(\?<[=!]/;

export function hasStyleVar(style: string): boolean {
    return /\bvar\(/.test(style)
}

const FILTER_FUNCTION_RE = /\bfilter\s*:\s*[^;]+/gi
const FILTER_PERCENTAGE_RE = /([a-z-]+)\s*\(\s*\d+(\.\d+)?%/i

export function hasFilterPercentage(style: string): boolean {
    const filterMatch = style.match(FILTER_FUNCTION_RE)
    if (!filterMatch) return false
    return FILTER_PERCENTAGE_RE.test(style)
}

export function isRegexPatternSafe(pattern: string): { safe: boolean; reason?: string } {
    if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
        return { safe: false, reason: `Pattern exceeds ${MAX_REGEX_PATTERN_LENGTH} characters` }
    }
    if (NESTED_QUANTIFIER_RE.test(pattern)) {
        return { safe: false, reason: 'Nested quantifier detected (potential ReDoS)' }
    }
    if (BACKREFERENCE_RE.test(pattern)) {
        return { safe: false, reason: 'Backreferences not allowed in static patterns' }
    }
    if (NAMED_BACKREFERENCE_RE.test(pattern)) {
        return { safe: false, reason: 'Named backreferences not allowed' }
    }
    if (CATASTROPHIC_ALTERNATION_RE.test(pattern)) {
        return { safe: false, reason: 'Ambiguous alternation with quantifier (potential ReDoS)' }
    }
    if (LOOKBEHIND_RE.test(pattern)) {
        return { safe: false, reason: 'Lookbehind assertions are not allowed' }
    }
    const altBranches = pattern.match(/\|/g)
    if (altBranches && altBranches.length > 50) {
        return { safe: false, reason: 'Pattern has more than 50 alternation branches' }
    }
    if (/\.\*\+?\s*\.\*\+?/.test(pattern)) {
        return { safe: false, reason: 'Unbounded dot-star before another unbounded repeat (potential ReDoS)' }
    }
    return { safe: true }
}

export function validateRule(rule: SmartCosmeticRule): ValidationResult {
    const diagnostics: Diagnostic[] = []

    if (rule.syntaxVersion !== 1) {
    diagnostics.push(diagnostic(DIAGNOSTIC_CODES.UNSUPPORTED_NEW_SYNTAX, `Unsupported syntax version ${rule.syntaxVersion}`))
    }

    if (rule.priority !== undefined && (rule.priority < -1000 || rule.priority > 1000)) {
    diagnostics.push(diagnostic(DIAGNOSTIC_CODES.DEPRECATED_FIELD, `priority ${rule.priority} is out of range (-1000 to 1000)`))
    }

    if (rule.action.action === 'style' && 'style' in rule.action) {
        const s = (rule.action as any).style
        if (typeof s === 'string') {
            if (hasStyleVar(s)) {
        diagnostics.push(diagnostic(DIAGNOSTIC_CODES.STYLE_VAR_NOT_ALLOWED, 'var() is not allowed in v1 style() values'))
            }
            if (hasFilterPercentage(s)) {
        diagnostics.push(diagnostic(DIAGNOSTIC_CODES.STYLE_FILTER_PERCENTAGE, 'filter functions must use numeric decimals, not percentages'))
            }
            const declarations = s.split(';').map(d => d.trim()).filter(Boolean)
            for (const decl of declarations) {
                const colonIdx = decl.indexOf(':')
                if (colonIdx === -1) {
          diagnostics.push(diagnostic(DIAGNOSTIC_CODES.STYLE_VAR_NOT_ALLOWED, `Malformed style declaration: "${decl}"`))
          continue
                }
                const prop = decl.slice(0, colonIdx).trim()
                const _val = decl.slice(colonIdx + 1).trim()
                if (!SAFE_STYLE_PROPERTIES.has(prop.replace(/^-(webkit|moz)-/i, ''))) {
          diagnostics.push(diagnostic(DIAGNOSTIC_CODES.STYLE_VAR_NOT_ALLOWED, `Style property "${prop}" is not in the allowed list`))
                }
            }
        }
    }

    if ('performance' in rule && rule.performance?.sampleRate !== undefined) {
        const sr = rule.performance.sampleRate
        if (sr < 0 || sr > 1) {
      diagnostics.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, `sample-rate ${sr} is out of range (0.0 to 1.0)`))
        }
    }

    if (rule.safety?.minFeatures !== undefined && (rule.safety.minFeatures < 0 || rule.safety.minFeatures > 10)) {
    diagnostics.push(diagnostic(DIAGNOSTIC_CODES.SAFETY_MIN_FEATURES_MODE_NONE, `min-features ${rule.safety.minFeatures} is out of range (0 to 10)`))
    }

    if (rule.targets.length === 0) {
    diagnostics.push(diagnostic(DIAGNOSTIC_CODES.TARGET_INVALID, 'At least one target is required'))
    }

    if ((rule as any).supersedes !== undefined) {
    diagnostics.push(diagnostic(DIAGNOSTIC_CODES.UNSUPPORTED_COMPOSITION, 'supersedes is not supported in v1', 'warning'))
    }
    if ((rule as any).overrides !== undefined) {
    diagnostics.push(diagnostic(DIAGNOSTIC_CODES.UNSUPPORTED_COMPOSITION, 'overrides is not supported in v1', 'warning'))
    }

    if (rule.action.action === 'style' && rule.action.options?.important) {
    // important is valid for style actions — only warn for built-in actions
    }
    if (rule.action.action !== 'style' && rule.action.options?.important) {
    diagnostics.push(diagnostic(DIAGNOSTIC_CODES.IMPORTANT_IGNORED_FOR_BUILT_IN, 'actionOptions.important is ignored for non-style actions', 'warning'))
    }

    validateSafety(rule.safety, diagnostics)
    validatePerformance(rule.performance, diagnostics)
    validateCache(rule.cache, diagnostics)

    switch (rule.type) {
    case 'hide-exact': validateHideExact(rule, diagnostics); break
    case 'hide-similar': validateHideSimilar(rule, diagnostics); break
    case 'smart-hide': validateSmartHide(rule, diagnostics); break
    case 'smart-allow': validateSmartAllow(rule, diagnostics); break
    }

    return {
    valid: diagnostics.every(d => d.severity !== 'error'),
    diagnostics,
    }
}

function validateHideExact(rule: HideExactRule, diag: Diagnostic[]) {
    validateTargets(rule.targets, diag)
    validatePaths(rule.paths, diag)
    if (!rule.selector) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.EXACT_MODE_SELECTOR_REQUIRED, 'hide-exact requires a selector'))
    }
    if ((rule as any).match) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.INVALID_RULE_ACTION_COMBINATION, 'hide-exact must not have a match block'))
    }
    if ((rule as any).candidates) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.CANDIDATE_REQUIRED, 'hide-exact must not have candidates'))
    }
    if ((rule as any).boundary) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.BOUNDARY_REQUIRED, 'hide-exact must not have a boundary block'))
    }
    if ((rule as any).where) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.LOGIC_INVALID, 'hide-exact must not have where logic'))
    }
    if ((rule as any).except) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.LOGIC_INVALID, 'hide-exact must not have except logic'))
    }
    if ((rule as any).keywords) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.KEYWORDS_INACTIVE, 'hide-exact must not have keywords'))
    }
    if (!rule.scope || rule.scope.length === 0) {
        const isUniqueId = rule.selector && rule.selector.startsWith('#') && !rule.selector.includes(' ') && !rule.selector.includes('>')
        if (!isUniqueId) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.EXACT_HIDE_BROAD_BOUNDARY, 'hide-exact without scope targets the full document', 'warning'))
        }
    }
    if (rule.frames) validateFrames(rule.frames, diag)
    if (rule.runtime) validateRuntime(rule.runtime, diag)
    if (rule.shadow) validateShadow(rule.shadow, diag)
    if (rule.action.action === 'unhide') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.INVALID_RULE_ACTION_COMBINATION, 'hide-exact does not support action: unhide'))
    }
    if (rule.action.action === 'remove') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.ACTION_REMOVE_WARNING, 'action: remove can break page scripts', 'warning'))
    }
    if (rule.metadata.originalSyntax && rule.metadata.originalSyntax !== rule.selector) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.ORIGINAL_SYNTAX_MISMATCH, 'originalSyntax does not match compiled selector', 'warning'))
    }
}

function validateHideSimilar(rule: HideSimilarRule, diag: Diagnostic[]) {
    validateTargets(rule.targets, diag)
    validatePaths(rule.paths, diag)
    if (!rule.scope || rule.scope.length === 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.MISSING_SCOPE, 'hide-similar requires at least one scope selector'))
    }
    validateScope(rule.scope, diag, rule.safety?.warnIfScopeIsBody ?? true)
    if (!rule.candidates || rule.candidates.length === 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.MISSING_CANDIDATES, 'hide-similar requires at least one candidate selector'))
    }
    validateCandidates(rule.candidates, diag)
    if (!rule.boundary) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.BOUNDARY_REQUIRED, 'hide-similar requires a boundary block'))
    } else {
        validateBoundary(rule.boundary, diag)
    }
    if (rule.match) {
        const matchMode = (rule.match as any).mode
        if (matchMode === 'none') {
      diag.push(diagnostic(DIAGNOSTIC_CODES.INVALID_RULE_ACTION_COMBINATION, 'hide-similar does not support match.mode: none'))
        }
        validateMatch(rule.match, rule.type, rule.where, diag, rule.safety?.warnIfWeakExactReference ?? true)
        if (matchMode === 'exact' && rule.scope?.some(s => s === 'body' || s === 'html')) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.BROAD_RULE_WARNING, 'exact match with body/html scope may match too broadly', 'warning'))
        }
    } else {
    diag.push(diagnostic(DIAGNOSTIC_CODES.MATCH_MISSING_REFERENCE, 'hide-similar requires a match block with a reference'))
    }
    if (rule.frames) validateFrames(rule.frames, diag)
    if (rule.runtime) validateRuntime(rule.runtime, diag)
    if (rule.shadow) validateShadow(rule.shadow, diag)
    if (rule.where) validateRegexCondition(rule.where, diag, 'where')
    if (rule.except) validateRegexCondition(rule.except, diag, 'except')
    if ((rule.action as any).action === 'unhide') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.INVALID_RULE_ACTION_COMBINATION, 'hide-similar does not support action: unhide'))
    }
    const warnIfRemove = rule.safety?.warnIfActionRemove ?? true
    if (rule.action.action === 'remove' && warnIfRemove) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.ACTION_REMOVE_WARNING, 'action: remove can break page scripts', 'warning'))
    }
}

function validateSmartHide(rule: SmartHideRule, diag: Diagnostic[]) {
    validateTargets(rule.targets, diag)
    validatePaths(rule.paths, diag)
    if (!rule.scope || rule.scope.length === 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.MISSING_SCOPE, 'smart-hide requires at least one scope selector'))
    }
    validateScope(rule.scope, diag, rule.safety?.warnIfScopeIsBody ?? true)
    if (!rule.candidates || rule.candidates.length === 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.MISSING_CANDIDATES, 'smart-hide requires at least one candidate selector'))
    }
    validateCandidates(rule.candidates, diag)
    if (!rule.boundary) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.BOUNDARY_REQUIRED, 'smart-hide requires a boundary block'))
    } else {
        validateBoundary(rule.boundary, diag)
    }
    if (rule.match) {
        validateMatch(rule.match, rule.type, rule.where, diag, rule.safety?.warnIfWeakExactReference ?? true)
        if (rule.match.mode === 'none' && rule.safety?.minFeatures !== undefined) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.MIN_FEATURES_INVALID_WITH_NONE, 'min-features is invalid with match mode none'))
        }
        if (rule.match.mode === 'exact' && rule.safety?.minFeatures !== undefined) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.MIN_FEATURES_UNUSED_EXACT, 'min-features is unused with match mode exact', 'warning'))
        }
        if (rule.match.mode === 'exact' && rule.scope?.some(s => s === 'body' || s === 'html')) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.BROAD_RULE_WARNING, 'exact match with body/html scope may match too broadly', 'warning'))
        }
    }
    if (!rule.where && !rule.keywords) {
        const warnIfNoWhere = rule.safety?.warnIfNoWhereLogic ?? true
        if (rule.match?.mode === 'none' && rule.safety?.minLogicMatches !== 0) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.MATCH_MODE_NONE_NO_WHERE, 'match mode none without where logic or keywords is too broad; set safety.min-logic-matches: 0 to bypass'))
        } else if (warnIfNoWhere) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.WHERE_MISSING_SMART, 'smart-hide without where logic or keywords may be too broad', 'warning'))
        }
    }
    if (rule.frames) validateFrames(rule.frames, diag)
    if (rule.runtime) validateRuntime(rule.runtime, diag)
    if (rule.shadow) validateShadow(rule.shadow, diag)
    if (rule.keywords?.wordBoundary && rule.keywords?.matchMode === 'regex') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.KEYWORD_WORD_BOUNDARY_IGNORED, 'word-boundary is ignored for regex match mode', 'warning'))
    }
    if (rule.keywords?.wordBoundary && rule.keywords?.matchMode === 'word') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.WORD_BOUNDARY_REDUNDANT, 'word-boundary is redundant for word match mode', 'warning'))
    }
    if (rule.keywords && !rule.keywords.matchMode) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.KEYWORDS_INACTIVE, 'keywords block requires match-mode', 'warning'))
    }
    const VALID_KEYWORD_MODES = new Set(['phrase', 'word', 'regex'])
    if (rule.keywords?.matchMode && !VALID_KEYWORD_MODES.has(rule.keywords.matchMode)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.INVALID_KEYWORD_WORD_MODE, `Invalid keyword match-mode "${rule.keywords.matchMode}"`))
    }
    if (rule.keywords?.matchMode === 'regex') {
        const allKw = [...(rule.keywords.includeAny || []), ...(rule.keywords.includeAll || []), ...(rule.keywords.excludeAny || []), ...(rule.keywords.excludeAll || [])]
        for (const kw of allKw) {
            try { new RegExp(kw) } catch { diag.push(diagnostic(DIAGNOSTIC_CODES.REGEX_UNCOMPILABLE, `Invalid regex keyword: "${kw}"`)) }
        }
    }
    if (rule.keywords?.matchMode === 'word') {
        const allKw = [...(rule.keywords.includeAny || []), ...(rule.keywords.includeAll || []), ...(rule.keywords.excludeAny || []), ...(rule.keywords.excludeAll || [])]
        for (const kw of allKw) {
            if (/[\s,.;:!?\-'"(){}\[\]/]/.test(kw)) {
        diag.push(diagnostic(DIAGNOSTIC_CODES.INVALID_KEYWORD_WORD_MODE, `Word-mode keyword "${kw}" contains whitespace or punctuation`, 'warning'))
            }
        }
    }
    if (rule.boundary?.includeSelf && rule.boundary.mode !== 'selector') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.INCLUDE_SELF_NOT_SELECTOR_MODE, 'includeSelf requires selector boundary mode'))
    }
    if (rule.boundary?.allowPageRoot && !rule.safety?.confirmPageRoot) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.ALLOW_PAGE_ROOT_WITHOUT_CONFIRM, 'allowPageRoot requires safety.confirmPageRoot'))
    }
    if (rule.where) validateRegexCondition(rule.where, diag, 'where')
    if (rule.except) validateRegexCondition(rule.except, diag, 'except')
    if (rule.keywords && rule.where) {
        if (!rule.keywordMerge) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.KEYWORDS_INACTIVE, 'keywords block not merged because explicit where/except exists', 'warning'))
        }
    }
    if (rule.keywordMerge && !rule.keywords) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.KEYWORD_MERGE_CONFLICT, 'keywordMerge is true but no keywords block provided', 'warning'))
    }
    if (rule.action.action === 'unhide') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.INVALID_RULE_ACTION_COMBINATION, 'smart-hide does not support action: unhide'))
    }
    const warnIfRemove = rule.safety?.warnIfActionRemove ?? true
    if (rule.action.action === 'remove' && warnIfRemove) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.ACTION_REMOVE_WARNING, 'action: remove can break page scripts', 'warning'))
    }
}

function validateSmartAllow(rule: SmartAllowRule, diag: Diagnostic[]) {
    validateTargets(rule.targets, diag)
    validatePaths(rule.paths, diag)
    if (!rule.scope || rule.scope.length === 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.MISSING_SCOPE, 'smart-allow requires at least one scope selector'))
    }
    validateScope(rule.scope, diag, rule.safety?.warnIfScopeIsBody ?? true)
    if (!rule.candidates || rule.candidates.length === 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.MISSING_CANDIDATES, 'smart-allow requires at least one candidate selector'))
    }
    validateCandidates(rule.candidates, diag)
    if (!rule.boundary) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.MISSING_BOUNDARY, 'smart-allow requires a boundary block'))
    } else {
        validateBoundary(rule.boundary, diag)
    }
    if (rule.action.action !== 'unhide') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.ACTION_SMART_ALLOW_INVALID, 'smart-allow must use action: unhide'))
    }
    if (rule.match && rule.match.mode !== 'none' && rule.match.mode !== 'exact') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.MATCH_MODE_SMART_ALLOW_INVALID, 'smart-allow must use match mode none or exact'))
    }
    if (rule.match) validateMatch(rule.match, rule.type, rule.where, diag, rule.safety?.warnIfWeakExactReference ?? true)
    if ((!rule.where && !rule.keywords) && (!rule.match || rule.match.mode === 'none')) {
        if (!rule.allowBroad) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.CATCH_ALL_ALLOW, 'smart-allow with no where/keywords and match mode none is a catch-all; requires allowBroad + enterprise + preview'))
        } else {
      diag.push(diagnostic(DIAGNOSTIC_CODES.ALLOW_BROAD_EXPECTED, 'broad smart-allow with allowBroad requires enterprise policy', 'warning'))
        }
    }
    if (rule.frames) validateFrames(rule.frames, diag)
    if (rule.runtime) validateRuntime(rule.runtime, diag)
    if (rule.shadow) validateShadow(rule.shadow, diag)
    if (rule.keywords?.wordBoundary && rule.keywords?.matchMode === 'regex') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.KEYWORD_WORD_BOUNDARY_IGNORED, 'word-boundary is ignored for regex match mode', 'warning'))
    }
    if (rule.keywords?.wordBoundary && rule.keywords?.matchMode === 'word') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.WORD_BOUNDARY_REDUNDANT, 'word-boundary is redundant for word match mode', 'warning'))
    }
    if (rule.keywords && !rule.keywords.matchMode) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.KEYWORDS_INACTIVE, 'keywords block requires match-mode', 'warning'))
    }
    const VALID_KEYWORD_MODES = new Set(['phrase', 'word', 'regex'])
    if (rule.keywords?.matchMode && !VALID_KEYWORD_MODES.has(rule.keywords.matchMode)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.INVALID_KEYWORD_WORD_MODE, `Invalid keyword match-mode "${rule.keywords.matchMode}"`))
    }
    if (rule.keywords?.matchMode === 'regex') {
        const allKw = [...(rule.keywords.includeAny || []), ...(rule.keywords.includeAll || []), ...(rule.keywords.excludeAny || []), ...(rule.keywords.excludeAll || [])]
        for (const kw of allKw) {
            try { new RegExp(kw) } catch { diag.push(diagnostic(DIAGNOSTIC_CODES.REGEX_UNCOMPILABLE, `Invalid regex keyword: "${kw}"`)) }
        }
    }
    if (rule.where) validateRegexCondition(rule.where, diag, 'where')
    if (rule.except) validateRegexCondition(rule.except, diag, 'except')
}

function validateRegexPattern(pattern: string, diag: Diagnostic[], context: string) {
    try {
        new RegExp(pattern)
    } catch (e) {
    console.warn('[uBR] smart-rule-validator: invalid regex in', context, pattern, e)
    diag.push(diagnostic(DIAGNOSTIC_CODES.REGEX_UNCOMPILABLE, `Invalid regex in ${context}: ${pattern}`))
    return
    }
    const safe = isRegexPatternSafe(pattern)
    if (!safe.safe) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.REGEX_STATIC_REJECTED, `Unsafe regex in ${context}: ${safe.reason}`))
    }
}

function validateRegexCondition(expr: LogicExpression, diag: Diagnostic[], context: string) {
    if ('condition' in expr && 'operator' in expr.condition) {
        const cond = expr.condition as any
        if (cond.operator === 'regex' && cond.pattern) {
            validateRegexPattern(cond.pattern, diag, context)
            if (cond.flags) {
                for (const err of validateRegexFlags(cond.flags)) {
          diag.push(diagnostic(DIAGNOSTIC_CODES.REGEX_UNSUPPORTED_FLAG, err, 'warning'))
                }
            }
        }
        return
    }
    const group = expr as { all?: LogicExpression[]; any?: LogicExpression[]; none?: LogicExpression[] }
    for (const key of ['all', 'any', 'none'] as const) {
        const arr = group[key]
        if (arr) {
            for (const child of arr) {
                validateRegexCondition(child, diag, context)
            }
        }
    }
}

const VALID_TARGET_FORMS = new Set(['host', 'domain', 'entity', 'regex'])
const VALID_PATH_FORMS = new Set(['exact', 'glob', 'regex'])

function validateTargets(targets: TargetEntry[], diag: Diagnostic[]) {
    for (const t of targets) {
        if (!VALID_TARGET_FORMS.has(t.form)) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.TARGET_INVALID, `Invalid target form "${t.form}"`))
        }
        if (t.form === 'regex') {
            validateRegexPattern(t.value, diag, `target ${t.value}`)
        }
    }
}

function validatePaths(paths: PathEntry[] | undefined, diag: Diagnostic[]) {
    if (!paths) return
    for (const p of paths) {
        if (!VALID_PATH_FORMS.has(p.form)) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.PATH_INVALID, `Invalid path form "${p.form}"`))
        }
        if (p.form === 'regex') {
            validateRegexPattern(p.value, diag, `path ${p.value}`)
        }
    }
}

function validateScope(scope: string[] | undefined, diag: Diagnostic[], warnIfScopeIsBody = true) {
    if (!scope) return
    for (const s of scope) {
        if (s === 'body' || s === 'html') {
            if (warnIfScopeIsBody) {
        diag.push(diagnostic(DIAGNOSTIC_CODES.SCOPE_IS_BODY, `Scope "${s}" is risky for generalized rules`, 'warning'))
            }
      diag.push(diagnostic(DIAGNOSTIC_CODES.BROAD_EXACT_SCOPE, `Scope "${s}" is broad`, 'warning'))
        }
        if (!isSafeSelector(s)) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.UNSAFE_SCOPE_SELECTOR, `Unsafe selector in scope: ${s}`))
        }
    }
}

function validateCandidates(candidates: string[] | undefined, diag: Diagnostic[]) {
    if (!candidates) return
    for (const c of candidates) {
        if (!isSafeSelector(c)) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.UNSAFE_CANDIDATE_SELECTOR, `Unsafe candidate selector: ${c}`))
        }
    }
}

function validateBoundary(boundary: Boundary, diag: Diagnostic[]) {
    const validModes = new Set(['exact', 'nearest-card', 'repeated-card', 'semantic-block', 'visual-block', 'ancestor-depth', 'selector'])
    if (!validModes.has(boundary.mode)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.BOUNDARY_INVALID, `Invalid boundary mode "${boundary.mode}"`))
    }
    if (boundary.stopAtScope !== false && boundary.allowCrossScope === true) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.BOUNDARY_CROSS_SCOPE_CONFLICT, 'allow-cross-scope: true overrides stop-at-scope to false', 'warning'))
    }
    if (boundary.mode === 'ancestor-depth' && boundary.depth === undefined) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.BOUNDARY_MODE_MISMATCH, "ancestor-depth mode requires depth field", 'error'))
    }
    if (boundary.mode === 'selector' && !boundary.selector) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.BOUNDARY_MODE_MISMATCH, "selector mode requires a selector field", 'error'))
    }
    if (boundary.depth !== undefined && boundary.depth < 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.INVALID_BOUNDARY_DEPTH, "depth must not be negative"))
    }
    if (boundary.maxDepth !== undefined && boundary.maxDepth < 1) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.BOUNDARY_INVALID, "maxDepth must be a positive integer"))
    }
    if (boundary.depth !== undefined && boundary.maxDepth !== undefined && boundary.depth >= boundary.maxDepth) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.INVALID_BOUNDARY_DEPTH, "depth must be less than maxDepth"))
    }
    if (boundary.mode === 'exact') {
        if (boundary.selector || boundary.depth !== undefined || boundary.maxDepth !== undefined) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.BOUNDARY_MODE_MISMATCH, "exact boundary mode does not use selector, depth, or maxDepth"))
        }
    }
    if (boundary.allowScopeRoot === true && boundary.stopAtScope === undefined) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.ALLOW_SCOPE_ROOT_WITHOUT_STOP, 'allow-scope-root requires explicit stop-at-scope: true'))
    }
    if (boundary.allowScopeRoot === true && boundary.stopAtScope === false) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.ALLOW_SCOPE_ROOT_WITHOUT_STOP, 'allow-scope-root requires stop-at-scope: true'))
    }
}

function validateFrames(frames: FramesBlock | undefined, diag: Diagnostic[]) {
    if (!frames) return
    const validModes = new Set(['top-only', 'same-origin', 'accessible'])
    if (!validModes.has(frames.mode)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.FRAMES_INVALID, `Invalid frames mode "${frames.mode}"`))
    }
    if (frames.accounting && frames.accounting !== 'per-frame' && frames.accounting !== 'aggregate') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.FRAMES_INVALID, `Invalid frames accounting "${frames.accounting}"`))
    }
    if (frames.maxTotalMatches !== undefined && frames.maxTotalMatches < 1) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.FRAMES_INVALID, 'maxTotalMatches must be a positive integer'))
    }
}

function validateRuntime(runtime: RuntimeBlock | undefined, diag: Diagnostic[]) {
    if (!runtime) return
    if (runtime.reEvaluateOnPathChange && !['never', 'always', 'smart'].includes(runtime.reEvaluateOnPathChange)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.RUNTIME_INVALID, `Invalid reEvaluateOnPathChange "${runtime.reEvaluateOnPathChange}"`))
    }
    if (runtime.errorRecovery && !['continue', 'fail-safe'].includes(runtime.errorRecovery)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.RUNTIME_INVALID, `Invalid errorRecovery "${runtime.errorRecovery}"`))
    }
    if (runtime.onBudgetExceeded && !['stop-cycle', 'warn', 'pause-rule'].includes(runtime.onBudgetExceeded)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.RUNTIME_INVALID, `Invalid onBudgetExceeded "${runtime.onBudgetExceeded}"`))
    }
    if (runtime.onBudgetExceeded === 'warn') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.RUNTIME_INVALID, 'onBudgetExceeded: warn is restricted to preview mode', 'warning'))
    }
    if (runtime.observePathChanges !== undefined && typeof runtime.observePathChanges !== 'boolean') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.RUNTIME_INVALID, 'observePathChanges must be a boolean'))
    }
    if (runtime.observeSubtree !== undefined && typeof runtime.observeSubtree !== 'boolean') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.RUNTIME_INVALID, 'observeSubtree must be a boolean'))
    }
    if (runtime.observeAttributes !== undefined && runtime.observeAttributes !== 'auto' && runtime.observeAttributes !== true && runtime.observeAttributes !== false) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.RUNTIME_INVALID, 'observeAttributes must be auto, true, or false'))
    }
    if (runtime.pathChangeDebounceMs !== undefined && runtime.pathChangeDebounceMs < 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.RUNTIME_INVALID, 'pathChangeDebounceMs must not be negative'))
    }
}

function validateShadow(shadow: ShadowBlock, diag: Diagnostic[]) {
    const validModes = new Set(['none', 'open', 'open-recursive'])
    if (!validModes.has(shadow.mode)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.UNSAFE_SHADOW_SELECTOR, `Invalid shadow mode "${shadow.mode}"`))
    return
    }
    if (shadow.mode === 'none') {
        if (shadow.observeRecursive === true) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.SHADOW_INVALID, 'observeRecursive is unused when shadow mode is none', 'warning'))
        }
        if (shadow.allowHostAncestor === true) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.SHADOW_INVALID, 'allowHostAncestor is unused when shadow mode is none', 'warning'))
        }
    }
    if (shadow.mode === 'open-recursive' && shadow.observeRecursive === false) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.SHADOW_INVALID, 'observeRecursive conflicts with open-recursive mode', 'warning'))
    }
    if (shadow.mode !== 'none' && shadow.mode !== 'open-recursive' && shadow.observeRecursive === true) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.SHADOW_INVALID, 'observeRecursive requires open-recursive mode', 'warning'))
    }
    if (shadow.observeMutations !== undefined && typeof shadow.observeMutations !== 'boolean') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.SHADOW_INVALID, 'observeMutations must be a boolean'))
    }
    if (shadow.allowHostAncestor !== undefined && typeof shadow.allowHostAncestor !== 'boolean') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.SHADOW_INVALID, 'allowHostAncestor must be a boolean'))
    }
}

function validateCache(cache: CacheBlock | undefined, diag: Diagnostic[]) {
    if (!cache) return
    if (cache.scope && cache.scope !== 'per-rule' && cache.scope !== 'per-page') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, `Invalid cache scope "${cache.scope}"`))
    }
    if (cache.evictionPolicy && cache.evictionPolicy !== 'LRU') {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, `Invalid cache evictionPolicy "${cache.evictionPolicy}"`))
    }
    if (cache.maxEntries !== undefined && cache.maxEntries < 1) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'cache maxEntries must be a positive integer'))
    }
    if (cache.maxAgeMs !== undefined && cache.maxAgeMs < 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'cache maxAgeMs must not be negative'))
    }
}

function validateSafety(safety: SafetyBlock | undefined, diag: Diagnostic[]) {
    if (!safety) return
    if (safety.preview && !['required', 'recommended', 'optional', 'skip'].includes(safety.preview)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.SAFETY_PREVIEW_REQUIRED, `Invalid safety preview "${safety.preview}"`))
    }
    if (safety.maxMatches !== undefined && safety.maxMatches < 1) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'safety maxMatches must be a positive integer'))
    }
    if (safety.maxPagePercent !== undefined && (safety.maxPagePercent < 1 || safety.maxPagePercent > 100)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'safety maxPagePercent must be 1-100'))
    }
    if (safety.maxViewportAreaPercent !== undefined && (safety.maxViewportAreaPercent < 1 || safety.maxViewportAreaPercent > 100)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'safety maxViewportAreaPercent must be 1-100'))
    }
    if (safety.minLogicMatches !== undefined && safety.minLogicMatches < 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.SAFETY_MIN_LOGIC_MATCHES_IMPOSSIBLE, 'safety minLogicMatches must not be negative'))
    }
}

function validatePerformance(performance: PerformanceBlock | undefined, diag: Diagnostic[]) {
    if (!performance) return
    if (performance.maxCandidates !== undefined && performance.maxCandidates < 1) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'performance maxCandidates must be a positive integer'))
    }
    if (performance.maxEvaluationsPerCycle !== undefined && performance.maxEvaluationsPerCycle < 1) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'performance maxEvaluationsPerCycle must be a positive integer'))
    }
    if (performance.maxAddedNodesPerCycle !== undefined && performance.maxAddedNodesPerCycle < 1) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'performance maxAddedNodesPerCycle must be a positive integer'))
    }
    if (performance.maxRegexMsPerRuleCycle !== undefined && performance.maxRegexMsPerRuleCycle < 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'performance maxRegexMsPerRuleCycle must not be negative'))
    }
    if (performance.maxRegexPatternLength !== undefined && performance.maxRegexPatternLength < 1) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'performance maxRegexPatternLength must be a positive integer'))
    }
    if (performance.maxTextRegexInputChars !== undefined && performance.maxTextRegexInputChars < 1) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'performance maxTextRegexInputChars must be a positive integer'))
    }
    if (performance.debounceMs !== undefined && performance.debounceMs < 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'performance debounceMs must not be negative'))
    }
    if (performance.dependencyDepth !== undefined && performance.dependencyDepth < 0) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, 'performance dependencyDepth must not be negative'))
    }
    if (performance.metrics && !['none', 'collect'].includes(performance.metrics)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.PERFORMANCE_INVALID, `Invalid metrics mode "${performance.metrics}"`))
    }
}

function validateMatch(match: MatchBlock, ruleType: string, where: LogicExpression | undefined, diag: Diagnostic[], warnIfWeakExactReference = true) {
    if (match.mode === 'none') {
        if (match.threshold !== undefined) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.THRESHOLD_NOT_VALID_FOR_MODE_NONE, 'match.mode: none must not have threshold'))
        }
        if (match.reference !== undefined && match.reference !== 'none') {
      diag.push(diagnostic(DIAGNOSTIC_CODES.MATCH_MODE_NONE_WITH_REFERENCE, 'match.mode: none must not have reference'))
        }
        if (match.weights !== undefined) {
      diag.push(diagnostic(DIAGNOSTIC_CODES.MATCH_MODE_NONE_WITH_WEIGHTS, 'match.mode: none must not have weights'))
        }
        return
    }



    if (match.mode === 'similar' || match.mode === 'structural') {
        if (!match.reference || match.reference === 'none') {
      diag.push(diagnostic(
          match.mode === 'structural' ? DIAGNOSTIC_CODES.MATCH_STRUCTURAL_WITHOUT_REFERENCE : DIAGNOSTIC_CODES.MATCH_SIMILAR_WITHOUT_REFERENCE,
          `match.mode: ${match.mode} requires a reference`,
      ))
        }
    }

    if (match.referenceSelection && (match.reference === 'picked' || match.reference === 'none' || (typeof match.reference === 'string' && match.reference.startsWith('fingerprint:')))) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.REFERENCE_SELECTION_UNUSED, 'reference-selection is unused for this reference type', 'warning'))
    }

    if (match.mode === 'exact' && match.threshold !== undefined) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.MATCH_MODE_EXACT_WITH_THRESHOLD, 'match.mode: exact must not have threshold'))
    }
    if (match.mode === 'exact' && (!match.reference || match.reference === 'none') && warnIfWeakExactReference) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.MATCH_WEAK_EXACT_REFERENCE, 'exact match mode requires a reference (picked or custom selector)', 'warning'))
    }

    if (match.weights && !VALID_WEIGHT_PROFILES.has(match.weights)) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.CUSTOM_WEIGHTS_NOT_SUPPORTED_V1, `Custom weight profile "${match.weights}" is not supported in v1`))
    }

    if (match.threshold !== undefined && match.threshold < 0.65) {
    diag.push(diagnostic(DIAGNOSTIC_CODES.LOW_SIMILARITY_THRESHOLD, `Low similarity threshold ${match.threshold} requires preview`, 'warning'))
    }
}

