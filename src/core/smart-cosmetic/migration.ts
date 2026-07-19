import { smartRuleStore } from './smart-rule-store'
import type { SmartCosmeticRule } from './smart-rule-schema'
import { isSafeSelector } from './smart-rule-validator'

export interface MigrationResult {
  converted: number
  skipped: number
  errors: string[]
  rules: SmartCosmeticRule[]
  classicFilters: string[]
}

export function convertLegacyFilter(rawFilter: string): SmartCosmeticRule | null {
    const line = rawFilter.trim()
    if (!line || line.startsWith('!') || line.startsWith('# ')) return null

    // Exception cosmetic filter: example.com#@#selector
    const exceptionIdx = line.indexOf('#@#')
    if (exceptionIdx >= 0) {
        const domainPart = line.slice(0, exceptionIdx)
        const selector = line.slice(exceptionIdx + 3)
        const targets = parseDomains(domainPart)
        if (selector && targets.length > 0) {
            return {
        id: `ubr:smart:migrated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        syntaxVersion: 1,
        type: 'smart-allow',
        state: 'active',
        targets,
        scope: ['body'],
        allowBroad: true,
        candidates: [selector],
        boundary: { mode: 'semantic-block' },
        match: { mode: 'none' },
        action: { action: 'unhide' },
        metadata: { createdAt: new Date().toISOString(), migrated: true },
            }
        }
    }

    // Procedural cosmetic filter: example.com#$#selector { style }
    const proceduralIdx = line.indexOf('#$#')
    if (proceduralIdx >= 0) {
        const domainPart = line.slice(0, proceduralIdx)
        const ruleContent = line.slice(proceduralIdx + 3)
        const targets = parseDomains(domainPart)
        if (ruleContent && targets.length > 0) {
            const selector = ruleContent.replace(/\s*\{[^}]*\}\s*$/, '').trim()
            const styleMatch = ruleContent.match(/\{([^}]*)\}/)
            const style = styleMatch ? styleMatch[1].trim() : undefined
            return {
        id: `ubr:smart:migrated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        syntaxVersion: 1,
        type: 'hide-exact',
        state: 'active',
        targets,
        selector,
        action: style ? { action: 'style', style } as any : { action: 'hide' },
        metadata: { createdAt: new Date().toISOString(), migrated: true },
            }
        }
    }

    // Standard cosmetic filter: domain##selector or ##selector (global)
    if (line.startsWith('##')) {
        const selector = line.slice(2)
        return {
      id: `ubr:smart:migrated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      syntaxVersion: 1,
      type: 'hide-exact',
      state: 'enabled',
      targets: [{ form: 'host', value: '*' }],
      selector,
      action: { action: 'hide' },
      metadata: { createdAt: new Date().toISOString(), migrated: true },
        }
    }

    const hashIdx = line.indexOf('##')
    if (hashIdx > 0) {
        const domainPart = line.slice(0, hashIdx)
        const selector = line.slice(hashIdx + 2)
        const targets = parseDomains(domainPart)
        if (selector && targets.length > 0) {
            return {
        id: `ubr:smart:migrated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        syntaxVersion: 1,
        type: 'hide-exact',
        state: 'active',
        targets,
        selector,
        action: { action: 'hide' },
        metadata: { createdAt: new Date().toISOString(), migrated: true },
            }
        }
    }

    return null
}

export function convertToClassicLine(rule: SmartCosmeticRule): string | null {
    if (rule.type === 'hide-exact' && rule.selector) {
        const domainPart = targetsToDomainPart(rule.targets)
        return `${domainPart}##${rule.selector}`
    }

    if (rule.type === 'smart-allow') {
        if (rule.action.action === 'unhide' && !rule.where && !rule.except && !rule.keywords &&
        (!rule.match || rule.match.mode === 'none') && rule.candidates?.length === 1) {
            const domainPart = targetsToDomainPart(rule.targets)
            return `${domainPart}#@#${rule.candidates[0]}`
        }
    }

    return null
}

function targetsToDomainPart(targets: { form: string; value: string }[]): string {
    const parts = targets
    .filter(t => t.form !== 'entity' || !t.value.includes('*'))
    .map(t => t.value)
    if (parts.length === 0) return ''
    return parts.join(',')
}

function parseDomains(domainStr: string): { form: string; value: string }[] {
    if (!domainStr || domainStr === '') return [{ form: 'host', value: '*' }]

    return domainStr.split(',').map(d => {
        const domain = d.trim()
        if (!domain) return null
        if (domain.startsWith('~')) {
            return { form: 'domain', value: domain.slice(1) }
        }
        if (domain.startsWith('*.')) {
            return { form: 'entity', value: domain.slice(2) }
        }
        if (domain.includes('.')) {
            return { form: 'domain', value: domain }
        }
        return { form: 'host', value: domain }
    }).filter((t): t is { form: string; value: string } => t !== null)
}

export async function migrateLegacyFilters(filters: string[], options?: { preserveClassic?: boolean; mode?: 'preserve-classic' | 'normalize-classic' | 'convert' }): Promise<MigrationResult> {
    const mode = options?.mode ?? (options?.preserveClassic ? 'preserve-classic' : 'convert')
    const errors: string[] = []
    const rules: SmartCosmeticRule[] = []
    const classicFilters: string[] = []
    let skipped = 0

    for (const raw of filters) {
        try {
            const rule = convertLegacyFilter(raw)
            if (!rule) {
                skipped++
                continue
            }

            if (mode === 'preserve-classic') {
        classicFilters.push(raw.trim())
        continue
            }
            if (mode === 'normalize-classic') {
        classicFilters.push(raw.trim())
        continue
            }

            if (rule.type === 'hide-exact' && rule.selector && !isSafeSelector(rule.selector)) {
        errors.push(`Unsafe selector skipped: ${rule.selector}`)
        skipped++
        continue
            }

            const result = await smartRuleStore.addRule(rule)
            if (result.ok) {
        rules.push(rule)
            } else {
        errors.push(`Failed to add rule: ${raw.slice(0, 60)}`)
        skipped++
            }
        } catch (err) {
      console.warn('[uBR] migration: rule conversion failed', err)
      errors.push(`Error converting "${raw.slice(0, 60)}": ${err}`)
      skipped++
        }
    }

    return { converted: rules.length, skipped, errors, rules, classicFilters }
}

export function checkSyntaxVersion(rule: { syntaxVersion?: number }): { compatible: boolean; reason?: string } {
    const version = rule.syntaxVersion ?? 1
    if (version === 1) return { compatible: true }
    if (version > 1) {
        return { compatible: false, reason: `Syntax version ${version} is not supported by this engine` }
    }
    return { compatible: true }
}

export async function importYamlRules(yamlText: string): Promise<MigrationResult> {
    const { parseSmartRules } = await import('./smart-rule-parser')
    const parsed = parseSmartRules(yamlText)
    if (parsed.errors.length > 0) {
        return { converted: 0, skipped: 0, errors: parsed.errors, rules: [], classicFilters: [] }
    }

    const rules: SmartCosmeticRule[] = []
    const errors: string[] = []

    for (const rule of parsed.rules) {
        try {
            const meta = rule.metadata || { createdAt: new Date().toISOString() } as any
      ;(meta as any).importedAt = new Date().toISOString()
            ;(rule as any).metadata = meta
            const result = await smartRuleStore.addRule(rule)
            if (result.ok) {
        rules.push(rule)
            } else {
        errors.push(`Validation failed for rule: ${JSON.stringify(result.validation?.diagnostics)}`)
            }
        } catch (err) {
      console.warn('[uBR] migration: rule import failed', err)
      errors.push(`Error importing rule: ${err}`)
        }
    }

    return { converted: rules.length, skipped: parsed.rules.length - rules.length, errors, rules, classicFilters: [] }
}

export * as Migration from './migration'
