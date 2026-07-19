/**
 * platform/chromium/js/dnr-decision-store.js
 *
 * DNR decision store for attribution and diagnostics.
 *
 * Every DNR install/update/remove decision is recorded with its action,
 * rule identifiers, source, and timestamp. The store supports querying
 * by rule ID, source, and time range for diagnostics, logger display,
 * and policy reconciliation.
 *
 * Usage:
 *   import { DnrDecisionStore } from "./dnr-decision-store.js";
 *   DnrDecisionStore.record({ action: "install", ruleIds: ["1"], source: "filter-list-a" });
 *   const decisions = DnrDecisionStore.query({ source: "filter-list-a" });
 */

const _decisions = [];

export const DnrDecisionStore = Object.freeze({
    /**
     * Record a DNR decision.
     * @param {{ action: string, ruleIds: string[], source: string, reason?: string, timestamp?: number }} entry
     */
    record(entry) {
        _decisions.push({
            action: entry.action,
            ruleIds: [...entry.ruleIds],
            source: entry.source,
            reason: entry.reason || "",
            timestamp: entry.timestamp || Date.now(),
        });
        if (_decisions.length > 1000) _decisions.shift();
    },

    /**
     * Query decisions by filter.
     * @param {{ source?: string, action?: string, since?: number }} filter
     * @returns {object[]}
     */
    query(filter = {}) {
        let results = _decisions;
        if (filter.source) results = results.filter(d => d.source === filter.source);
        if (filter.action) results = results.filter(d => d.action === filter.action);
        if (filter.since) results = results.filter(d => d.timestamp >= filter.since);
        return results;
    },

    /**
     * Get decisions for specific rule IDs.
     * @param {string[]} ruleIds
     * @returns {object[]}
     */
    forRules(ruleIds) {
        const idSet = new Set(ruleIds);
        return _decisions.filter(d => d.ruleIds.some(id => idSet.has(id)));
    },

    clear() {
        _decisions.length = 0;
    },
});
