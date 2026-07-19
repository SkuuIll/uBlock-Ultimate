/**
 * platform/chromium/js/rule-provenance.js
 *
 * Rule provenance tracker for filter-list and user rules.
 *
 * Tracks the origin of every active rule: which filter list, user
 * action, or internal process created it, when, and under which
 * policy revision. Supports "where did this rule come from?" queries
 * from the logger and diagnostic UI.
 *
 * Usage:
 *   import { RuleProvenance } from "./rule-provenance.js";
 *   RuleProvenance.record("rule-42", { source: "filter-list-a", listId: "list-a" });
 *   const info = RuleProvenance.get("rule-42");
 */

const _provenance = new Map();

export const RuleProvenance = Object.freeze({
    /**
     * Record the provenance of a rule.
     * @param {string} ruleId
     * @param {{ source: string, listId?: string, action?: string, policyRevision?: number, timestamp?: number }} info
     */
    record(ruleId, info) {
        _provenance.set(ruleId, {
            ruleId,
            source: info.source,
            listId: info.listId || "",
            action: info.action || "",
            policyRevision: info.policyRevision || 0,
            timestamp: info.timestamp || Date.now(),
        });
    },

    /**
     * Get provenance for a rule.
     * @param {string} ruleId
     * @returns {object|null}
     */
    get(ruleId) {
        return _provenance.get(ruleId) || null;
    },

    /**
     * Get all provenance entries from a given source.
     * @param {string} source
     * @returns {object[]}
     */
    forSource(source) {
        return [..._provenance.values()].filter(p => p.source === source);
    },

    /**
     * Remove provenance entries for a source.
     * @param {string} source
     */
    removeBySource(source) {
        for (const [key, p] of _provenance) {
            if (p.source === source) _provenance.delete(key);
        }
    },

    clear() {
        _provenance.clear();
    },
});
