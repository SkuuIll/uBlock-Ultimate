import type { Diagnostic } from './smart-rule-diagnostics'
import type {
    TargetEntry, PathEntry, SmartCosmeticRule,
    LogicExpression, KeywordBlock,
} from './smart-rule-schema'
import {
    RULE_ID_PREFIX,
} from './smart-rule-schema'
import { createConfirmationHash } from './canonical-hash'

export interface NormalizedRule {
  rule: SmartCosmeticRule
  diagnostics: Diagnostic[]
}

export function normalizeTarget(raw: string): TargetEntry | null {
    const colonIdx = raw.indexOf(':')
    if (colonIdx > 0) {
        const prefix = raw.slice(0, colonIdx)
        const value = raw.slice(colonIdx + 1)
        if (prefix === 'host' || prefix === 'domain' || prefix === 'entity' || prefix === 'regex') {
            return { form: prefix, value }
        }
    }
    if (raw.includes('.') && raw.split('.').length >= 3) {
        return { form: 'host', value: raw }
    }
    if (raw.includes('.')) {
        return { form: 'domain', value: raw }
    }
    return null
}

export function normalizePaths(raw: string[]): PathEntry[] {
    return raw.map(p => normalizePath(p)).filter((p): p is PathEntry => p !== null)
}

export function normalizePath(raw: string): PathEntry | null {
    const colonIdx = raw.indexOf(':')
    if (colonIdx > 0) {
        const prefix = raw.slice(0, colonIdx)
        const value = raw.slice(colonIdx + 1)
        if (prefix === 'exact' || prefix === 'glob' || prefix === 'regex') {
            return { form: prefix, value }
        }
    }
    if (raw.includes('*') || raw.includes('?')) {
        return { form: 'glob', value: raw }
    }
    return { form: 'glob', value: raw }
}

export function normalizeKeywords(kw: KeywordBlock): { where?: LogicExpression; except?: LogicExpression } {
    const result: { where?: LogicExpression; except?: LogicExpression } = {}

    const fields = kw.fields || ['text']

    function buildCondition(keyword: string, mode: string): LogicExpression {
        const conditions: LogicExpression[] = fields.map(f => {
            if (mode === 'regex') {
                return { condition: { field: f, operator: 'regex', pattern: keyword, flags: 'i' as const } }
            }
            return { condition: { field: f, operator: 'contains', value: keyword } }
        })
        return { any: conditions }
    }

    function buildIncludeAll(keywords: string[], mode: string): LogicExpression {
        const perKeyword = keywords.map(k => buildCondition(k, mode))
        return { all: perKeyword }
    }

    function buildExcludeAll(keywords: string[], mode: string): LogicExpression {
        const perKeyword = keywords.map(k => buildCondition(k, mode))
        return { all: perKeyword }
    }

    const whereParts: LogicExpression[] = []

    if (kw.includeAny && kw.includeAny.length > 0) {
        const groups = kw.includeAny.map(k => buildCondition(k, kw.matchMode))
    whereParts.push({ any: groups })
    }

    if (kw.includeAll && kw.includeAll.length > 0) {
    whereParts.push(buildIncludeAll(kw.includeAll, kw.matchMode))
    }

    if (whereParts.length === 1) {
        result.where = whereParts[0]
    } else if (whereParts.length > 1) {
        result.where = { all: whereParts }
    }

    const exceptParts: LogicExpression[] = []

    if (kw.excludeAny && kw.excludeAny.length > 0) {
        const groups = kw.excludeAny.map(k => buildCondition(k, kw.matchMode))
    exceptParts.push({ any: groups })
    }

    if (kw.excludeAll && kw.excludeAll.length > 0) {
    exceptParts.push(buildExcludeAll(kw.excludeAll, kw.matchMode))
    }

    if (exceptParts.length === 1) {
        result.except = exceptParts[0]
    } else if (exceptParts.length > 1) {
        result.except = { any: exceptParts }
    }

    return result
}

export function createRuleId(): string {
    const hex = () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
    const seg = (len: number) => Array.from({ length: len }, hex).join('')
    return `${RULE_ID_PREFIX}${seg(4)}-${seg(2)}-${seg(2)}-${seg(2)}-${seg(6)}`
}

export function nowISO(): string {
    return new Date().toISOString()
}

export function normalizePreviewState(rule: SmartCosmeticRule): void {
    const hash = createConfirmationHash(rule)
    if (!rule.preview) {
        rule.preview = { status: 'none', confirmationHash: hash }
    } else if (rule.preview.status === 'none' || !rule.preview.confirmationHash) {
        rule.preview.confirmationHash = hash
    }
}
