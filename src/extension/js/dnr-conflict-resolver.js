/**
 * platform/chromium/js/dnr-conflict-resolver.js
 *
 * DNR conflict resolver for cross-source rule priorities.
 *
 * When multiple sources (static rulesets, dynamic rules, session rules,
 * user rules) define overlapping or conflicting rules, this resolver
 * establishes precedence and produces a merged effective rule set.
 *
 * Precedence (highest to lowest):
 *   session rules > dynamic rules > static rulesets > user allow/block
 *
 * Usage:
 *   import { DnrConflictResolver } from "./dnr-conflict-resolver.js";
 *   const merged = DnrConflictResolver.merge([staticRules, dynamicRules, sessionRules]);
 */

function _priority(source) {
    const order = { session: 4, dynamic: 3, static: 2, user: 1 };
    return order[source] || 0;
}

export const DnrConflictResolver = Object.freeze({
    /**
     * Merge rules from multiple sources, resolving conflicts by source
     * priority. Within the same priority, later rules win.
     * @param {object[]} ruleSets - [{ source: string, rules: object[] }]
     * @returns {object[]}
     */
    merge(ruleSets) {
        const sorted = [...ruleSets].sort((a, b) => _priority(b.source) - _priority(a.source));
        const seen = new Set();
        const merged = [];

        for (const { rules = [] } of sorted) {
            for (const rule of rules) {
                const key = rule.id != null ? rule.id : `${rule.action?.type}:${rule.condition?.urlFilter}`;
                if (seen.has(key)) continue;
                seen.add(key);
                merged.push(rule);
            }
        }

        return merged;
    },

    /**
     * Detect conflicts between rule sets without merging.
     * @param {object[]} ruleSets
     * @returns {object[]} conflict descriptors
     */
    detectConflicts(ruleSets) {
        const conflicts = [];
        const ruleMap = new Map();

        for (const { source, rules = [] } of ruleSets) {
            for (const rule of rules) {
                const key = rule.id != null ? rule.id : `${rule.action?.type}:${rule.condition?.urlFilter}`;
                if (ruleMap.has(key)) {
                    conflicts.push({
                        ruleId: key,
                        sources: [ruleMap.get(key).source, source],
                    });
                }
                ruleMap.set(key, { source });
            }
        }

        return conflicts;
    },
});
