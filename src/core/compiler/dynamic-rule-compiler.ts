/**
 * src/core/compiler/dynamic-rule-compiler.ts
 *
 * Compiles user-created dynamic/firewall rules into DNR-compatible
 * rules using the centralised priority system.
 *
 * Each rule is a simplified representation of a cell in the popup's
 * firewall matrix:
 *   { src: "example.com", dst: "doubleclick.net", type: "script", action: "block" }
 *
 * Output: a SafeDnrRule with the appropriate condition fields and
 * priority from the centralised policy.
 */

import { priorityFor } from './dnr-priority'
import type { SafeDnrRule } from './safe-network-rule-compiler'

export type FirewallAction = 'block' | 'allow' | 'noop'

export interface FirewallRuleInput {
  /** Source hostname (the page that makes the request). */
  src: string
  /** Destination hostname (the target of the request). */
  dst: string
  /** Resource type, or '*' for all. */
  type: '*' | 'script' | 'image' | 'stylesheet' | 'xmlhttprequest' | 'main_frame' | 'font' | 'media' | 'websocket' | 'ping' | 'sub_frame' | 'object' | 'other'
  /** The firewall action. */
  action: FirewallAction
  /** True if this is a session-only (temporary) rule. */
  session?: boolean
}

export interface CompiledFirewallRule {
  ok: boolean
  rule?: SafeDnrRule
  reason?: string
}

const FIREWALL_TYPE_TO_DNR: Record<string, string[]> = {
  '*': [],
  script: ['script'],
  image: ['image'],
  stylesheet: ['stylesheet'],
  xmlhttprequest: ['xmlhttprequest'],
  'main_frame': ['main_frame'],
  font: ['font'],
  media: ['media'],
  websocket: ['websocket'],
  ping: ['ping'],
  'sub_frame': ['sub_frame'],
  object: ['object'],
  other: ['other'],
}

/**
 * Compile a single firewall rule to a DNR rule.
 * Returns the rule or an error reason.
 */
export function compileFirewallRule(input: FirewallRuleInput): CompiledFirewallRule {
    const { src, dst, type, action, session } = input

    if (!src || !dst) {
        return { ok: false, reason: 'Missing src or dst hostname' }
    }

    // Determine the priority band.
    const kind = (() => {
        if (session) {
            return action === 'allow' ? 'session-allow' as const : 'session-block' as const
        }
        return action === 'allow' ? 'user-allow' as const : 'user-block' as const
    })()

    const priority = priorityFor({ kind })

    // Build condition.
    const condition: SafeDnrRule['condition'] = {
        urlFilter: `||${dst}^`,
    }

    // Apply initiator (source) domain constraint. Only set when
    // the source is a specific hostname (not '*').
    if (src !== '*') {
        condition.initiatorDomains = [src]
    }

    // Apply resource type constraint.
    const resourceTypes = FIREWALL_TYPE_TO_DNR[type]
    if (resourceTypes && resourceTypes.length > 0) {
        condition.resourceTypes = resourceTypes as any
    }

    // noop cannot be represented as a standalone DNR rule. Emitting an
    // allow rule here would bypass lower static filtering layers, which is
    // not uBlock Origin semantics. Callers that need noop behavior must use
    // the canonical dynamic-filtering runtime, which carves broader dynamic
    // blocks with exclusions.
    if (action === 'noop') {
        return { ok: false, reason: 'noop requires canonical dynamic firewall compilation' }
    }

    return {
        ok: true,
        rule: {
            id: 0, // Caller assigns the ID.
            priority,
            action: { type: action },
            condition,
        },
    }
}

/**
 * Compile a batch of firewall rules to DNR rules with sequential
 * IDs starting at `idStart`.
 */
export function compileFirewallRuleBatch(
    inputs: FirewallRuleInput[],
    idStart = 1,
): { rules: SafeDnrRule[]; errors: string[] } {
    const rules: SafeDnrRule[] = []
    const errors: string[] = []
    let nextId = idStart

    for (const input of inputs) {
        const result = compileFirewallRule(input)
        if (result.ok && result.rule) {
            rules.push({ ...result.rule, id: nextId++ })
        } else {
            errors.push(`${input.src}->${input.dst}(${input.type}): ${result.reason}`)
        }
    }

    return { rules, errors }
}
