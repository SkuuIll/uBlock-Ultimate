/**
 * platform/chromium/js/decision-explainer.js
 *
 * Decision explainer for policy, DNR, and logger decisions.
 *
 * Takes a decision trace or policy output and produces human-readable
 * explanations that can be displayed in the logger, popup, or
 * diagnostic UI. Each explanation includes the reason, source, and
 * action taken.
 *
 * Usage:
 *   import { DecisionExplainer } from "./decision-explainer.js";
 *   const explanation = DecisionExplainer.explain(trace);
 */

export const DecisionExplainer = Object.freeze({
    /**
     * Produce a human-readable explanation from a decision trace.
     * @param {object} trace - { action, context, steps, result }
     * @returns {{ summary: string, details: string[], source: string }}
     */
    explain(trace) {
        if (!trace) return { summary: "no-trace", details: [], source: "unknown" };

        const details = trace.steps?.map(s =>
            `${s.name}: ${s.data ? JSON.stringify(s.data).slice(0, 100) : ""}`
        ) || [];

        const source = trace.context?.source || trace.action || "unknown";

        return {
            summary: `${trace.action}: ${trace.result?.enabled !== undefined ? (trace.result.enabled ? "enabled" : "disabled") : "done"}`,
            details,
            source,
        };
    },

    /**
     * Explain a policy decision.
     * @param {string} layer
     * @param {object} decision - { enabled, state, reasonCode, explanation, source }
     * @returns {string}
     */
    explainPolicy(layer, decision) {
        if (!decision) return `${layer}: no-decision`;
        return `${layer}: ${decision.state} (${decision.reasonCode})`;
    },
});
