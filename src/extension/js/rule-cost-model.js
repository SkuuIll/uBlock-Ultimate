/**
 * platform/chromium/js/rule-cost-model.js
 *
 * Rule cost model for DNR and filter-list rules.
 *
 * Estimates the runtime cost of a rule based on its action type,
 * condition complexity, regular expression use, header operations,
 * and resource type scope. Used to cap expensive rules and produce
 * diagnostics when rules exceed cost thresholds.
 *
 * Usage:
 *   import { RuleCostModel } from "./rule-cost-model.js";
 *   const cost = RuleCostModel.estimate(rule);
 *   if (cost > 100) { /* warn or reject *\/ }
 */

function _conditionComplexity(rule) {
    const c = rule.condition || {};
    let cost = 0;
    if (c.regexFilter) cost += 50;
    if (c.urlFilter) cost += 5;
    if (c.domains?.length > 10) cost += c.domains.length;
    if (c.initiatorDomains?.length > 10) cost += c.initiatorDomains.length;
    if (c.requestDomains?.length > 10) cost += c.requestDomains.length;
    if (c.excludedDomains?.length > 10) cost += c.excludedDomains.length;
    return cost;
}

export const RuleCostModel = Object.freeze({
    /**
     * Estimate the runtime cost of a DNR rule.
     * @param {object} rule
     * @returns {{ cost: number, reason?: string, expensive: boolean }}
     */
    estimate(rule) {
        let cost = 0;

        if (rule.action?.type === "redirect") cost += 15;
        if (rule.action?.type === "modifyHeaders") cost += 20;

        cost += _conditionComplexity(rule);

        return {
            cost,
            expensive: cost > 100,
            reason: cost > 100 ? "high-complexity-rule" : undefined,
        };
    },
});
