/**
 * platform/chromium/js/dnr-rule-key.js
 *
 * Stable canonical-key generator for DNR rules.  Used by
 * compileFilterTextToDNR, syncFilterListDnrRules, static ruleset
 * validation, user-rule validation, and simulator snapshots.
 *
 * Two rules with identical canonical keys are treated as duplicate
 * regardless of ID or priority differences.
 *
 * Usage:
 *   import { dnrRuleKey } from "./dnr-rule-key.js";
 *   const key = dnrRuleKey(rule);
 *   const map = new Map();
 *   map.set(key, rule);   // deduplicates by key
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sorted(arr) {
    if (!arr || arr.length === 0) { return arr; }
    const copy = arr.slice();
    copy.sort();
    return copy;
}

function stableJson(value) {
    // deterministic JSON: sorted object keys, no extra whitespace
    return JSON.stringify(value, (k, v) => {
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
            const keys = Object.keys(v).sort();
            const acc = {};
            for (let i = 0; i < keys.length; i++) {
                acc[keys[i]] = v[keys[i]];
            }
            return acc;
        }
        return v;
    });
}

// ---------------------------------------------------------------------------
// Canonical key for a DNR rule's "identity" (action + condition).
// Priority, id, and source metadata are intentionally excluded.
// ---------------------------------------------------------------------------

export function dnrRuleKey(rule) {
    const c = rule.condition || {};
    const a = rule.action || {};

    const key = {
        action: { type: a.type },
        condition: {
            urlFilter: c.urlFilter,
            regexFilter: c.regexFilter,
            resourceTypes: sorted(c.resourceTypes),
            excludedResourceTypes: sorted(c.excludedResourceTypes),
            initiatorDomains: sorted(c.initiatorDomains),
            excludedInitiatorDomains: sorted(c.excludedInitiatorDomains),
            requestDomains: sorted(c.requestDomains),
            excludedRequestDomains: sorted(c.excludedRequestDomains),
            domainType: c.domainType,
            requestMethods: sorted(c.requestMethods),
            excludedRequestMethods: sorted(c.excludedRequestMethods),
            tabIds: sorted(c.tabIds),
            excludedTabIds: sorted(c.excludedTabIds),
        },
    };

    // Include action redirect/upgrade details only when present
    if (a.type === "redirect") {
        if (a.redirect) {
            if (a.redirect.url) key.action.redirectUrl = a.redirect.url;
            if (a.redirect.extensionPath) key.action.redirectPath = a.redirect.extensionPath;
            if (a.redirect.transform) key.action.transform = a.redirect.transform;
        }
        key.action.redirect = undefined; // strip partial
    }

    if (a.type === "modifyHeaders") {
        key.action.requestHeaders = a.requestHeaders
            ? a.requestHeaders.map(h => ({ header: h.header, operation: h.operation, value: h.value }))
            : undefined;
        key.action.responseHeaders = a.responseHeaders
            ? a.responseHeaders.map(h => ({ header: h.header, operation: h.operation, value: h.value }))
            : undefined;
    }

    // Include priorityBand and sourceTrustTier for deduplication within
    // the same compilation pass — these are set by the compiler, not user input.
    if (rule._priorityBand !== undefined) key._b = rule._priorityBand;
    if (rule._sourceTrustTier !== undefined) key._t = rule._sourceTrustTier;

    return stableJson(key);
}

// ---------------------------------------------------------------------------
// Convenience wrapper: accept an array of rules and return a Map
// keyed by canonical key.  Later rules with the same key overwrite
// earlier ones.
// ---------------------------------------------------------------------------

export function buildDedupedRuleMap(rules) {
    const map = new Map();
    for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        map.set(dnrRuleKey(rule), rule);
    }
    return map;
}

// ---------------------------------------------------------------------------
// Check whether two rules are duplicates (same canonical key).
// ---------------------------------------------------------------------------

export function areRulesDuplicate(a, b) {
    return dnrRuleKey(a) === dnrRuleKey(b);
}
