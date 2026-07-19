/**
 * src/core/dynamic-rule-sync.ts
 *
 * Defines the synchronisation contract for writing user-created
 * firewall rules into Chrome's DNR dynamic/session rule stores.
 *
 * Callers (sw.js) must provide the actual `chrome.declarativeNetRequest`
 * surface. This module validates the payload and generates the
 * correct add/remove rule sets.
 *
 * Usage (in sw.js):
 *   import { planDynamicRuleSync } from '@/core/dynamic-rule-sync'
 *
 *   const plan = planDynamicRuleSync({
 *     sessionFirewallRules: [...],
 *     permanentFirewallRules: [...],
 *     knownSessionRuleIds: [300001, 300002, ...],
 *   })
 *   await chrome.declarativeNetRequest.updateSessionRules({
 *     removeRuleIds: plan.removeSessionIds,
 *     addRules: plan.addSessionRules,
 *   })
 *   await chrome.declarativeNetRequest.updateDynamicRules({
 *     removeRuleIds: plan.removeDynamicIds,
 *     addRules: plan.addDynamicRules,
 *   })
 */

import {
    compileFirewallRuleBatch,
    type FirewallRuleInput,
} from './compiler/dynamic-rule-compiler'
import type { SafeDnrRule } from './compiler/safe-network-rule-compiler'

/**
 * Reserved DNR rule ID ranges for dynamic firewall rules.
 * These must not overlap with any other DNR rule producers
 * (static rulesets, filter-list compiler, whitelister, etc.).
 */
export const DYNAMIC_FIREWALL_RULE_BASE = 400000
export const SESSION_FIREWALL_RULE_BASE = 450000
export const DYNAMIC_URL_RULE_BASE = 500000
export const SESSION_URL_RULE_BASE = 550000

export interface DynamicRuleSyncInput {
  sessionFirewallRules: FirewallRuleInput[]
  permanentFirewallRules: FirewallRuleInput[]
  knownSessionRuleIds: number[]
  knownDynamicRuleIds: number[]
}

export interface DynamicRuleSyncPlan {
  removeSessionIds: number[]
  addSessionRules: SafeDnrRule[]
  removeDynamicIds: number[]
  addDynamicRules: SafeDnrRule[]
  errors: string[]
}

/**
 * Compute the add/remove plan for synchronising in-memory firewall
 * rules with DNR dynamic/session rules. Idempotent — calling it
 * with the same inputs produces the same plan.
 */
export function planDynamicRuleSync(input: DynamicRuleSyncInput): DynamicRuleSyncPlan {
    // --- Session rules ---
    const sessionCompiled = compileFirewallRuleBatch(input.sessionFirewallRules, SESSION_FIREWALL_RULE_BASE)

    // Determine which session rule IDs to remove: any known ID that
    // is not in the newly compiled set.
    const newSessionIds = new Set(sessionCompiled.rules.map(r => r.id))
    const removeSessionIds = input.knownSessionRuleIds.filter(id => !newSessionIds.has(id))

    // --- Permanent (dynamic) rules ---
    const dynamicCompiled = compileFirewallRuleBatch(input.permanentFirewallRules, DYNAMIC_FIREWALL_RULE_BASE)

    const newDynamicIds = new Set(dynamicCompiled.rules.map(r => r.id))
    const removeDynamicIds = input.knownDynamicRuleIds.filter(id => !newDynamicIds.has(id))

    return {
        removeSessionIds,
        addSessionRules: sessionCompiled.rules,
        removeDynamicIds,
        addDynamicRules: dynamicCompiled.rules,
        errors: [...sessionCompiled.errors, ...dynamicCompiled.errors],
    }
}
