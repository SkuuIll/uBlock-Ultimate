import { smartRuleStore } from './smart-rule-store'
import { DIAGNOSTIC_CODES } from './smart-rule-diagnostics'
import { normalizeRuleState } from './smart-rule-schema'
import type { SmartCosmeticRule, SmartRuleCollection } from './smart-rule-schema'

export interface DiagnosticReport {
  timestamp: string
  summary: {
    totalRules: number
    enabledRules: number
    disabledRules: number
    collections: number
    byType: Record<string, number>
  }
  issues: DiagnosticIssue[]
  performance: {
    avgSelectorsPerTab: number
    tabsActive: number
    pendingFetches: number
  }
}

export interface DiagnosticIssue {
  severity: 'error' | 'warning' | 'info'
  message: string
  ruleId?: string
  code: string
}

export function generateReport(tabSelectors: Map<number, number>): DiagnosticReport {
    const allRules = smartRuleStore.getAllRules()
    const collections = smartRuleStore.getAllCollections()
    const byType: Record<string, number> = {}

    for (const rule of allRules) {
        byType[rule.type] = (byType[rule.type] || 0) + 1
    }

    const issues: DiagnosticIssue[] = []

    for (const rule of allRules) {
        if (rule.state === 'disabled') continue
        const ruleIssues = inspectRule(rule)
    issues.push(...ruleIssues)
    }

    for (const col of collections) {
        if (col.updateError) {
      issues.push({
        severity: 'warning',
        message: `Collection "${col.metadata?.listId || col.id}" has update error: ${col.updateError}`,
        code: 'collection-update-error',
      })
        }
    }

    const selectorsPerTab = Array.from(tabSelectors.values())

    return {
    timestamp: new Date().toISOString(),
    summary: {
      totalRules: allRules.length,
      enabledRules: allRules.filter(r => r.state === 'active').length,
      disabledRules: allRules.filter(r => r.state === 'disabled').length,
      collections: collections.length,
      byType,
    },
    issues,
    performance: {
      avgSelectorsPerTab: selectorsPerTab.length > 0
          ? selectorsPerTab.reduce((a, b) => a + b, 0) / selectorsPerTab.length
          : 0,
      tabsActive: selectorsPerTab.length,
      pendingFetches: 0,
    },
    }
}

function inspectRule(rule: SmartCosmeticRule): DiagnosticIssue[] {
    const issues: DiagnosticIssue[] = []

    if (rule.type === 'hide-exact' && !rule.selector) {
    issues.push({
      severity: 'error',
      message: 'Hide-exact rule is missing a selector',
      ruleId: rule.id,
      code: DIAGNOSTIC_CODES.EXACT_MODE_SELECTOR_REQUIRED,
    })
    }

    if (rule.type === 'smart-hide' && (!rule.candidates || rule.candidates.length === 0)) {
    issues.push({
      severity: 'error',
      message: 'Smart-hide rule has no candidates',
      ruleId: rule.id,
      code: DIAGNOSTIC_CODES.CANDIDATE_REQUIRED,
    })
    }

    if (rule.type === 'hide-similar' && rule.match) {
        if (!rule.match.reference && rule.match.mode !== 'none') {
      issues.push({
        severity: 'warning',
        message: `Hide-similar rule uses match mode "${rule.match.mode}" but no reference element`,
        ruleId: rule.id,
        code: DIAGNOSTIC_CODES.MATCH_MISSING_REFERENCE,
      })
        }
    }

    const collection = rule.collectionId ? smartRuleStore.getCollection(rule.collectionId) : undefined
    if (rule.collectionId && !collection) {
    issues.push({
      severity: 'warning',
      message: `Rule references collection "${rule.collectionId}" which does not exist`,
      ruleId: rule.id,
      code: 'orphan-collection',
    })
    }

    return issues
}

export function countTargetOverlap(rules: SmartCosmeticRule[]): Map<string, number> {
    const counts = new Map<string, number>()
    for (const rule of rules) {
        if (normalizeRuleState(rule.state) !== 'active') continue
        for (const target of rule.targets) {
            const key = `${target.form}:${target.value}`
      counts.set(key, (counts.get(key) || 0) + 1)
        }
    }
    return counts
}

export function listUnusedCollections(collections: SmartRuleCollection[], rules: SmartCosmeticRule[]): SmartRuleCollection[] {
    const usedIds = new Set<string>()
    for (const rule of rules) {
        if (rule.collectionId) usedIds.add(rule.collectionId)
    }
    return collections.filter(c => !usedIds.has(c.id))
}

export * as Diagnostics from './diagnostics'
