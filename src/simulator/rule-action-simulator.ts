/**
 * src/simulator/rule-action-simulator.ts
 *
 * Rule/action simulator (P2.9).
 * Simulates what would happen before DNR rules, cosmetics, video actions,
 * or scriptlets are activated.
 *
 * Usage:
 *   const result = simulateActions({ profile, policy, dnrCandidates, ... });
 *   console.log(result.allowed, result.rejected, result.observeOnly);
 */

import { classifyPageProfile } from "../js/runtime/page-classifier.js";

export function simulateActions({ profile, policy, dnrCandidates, cosmeticCandidates, videoDetections, smartRules, scriptlets }) {
    const allowed = [];
    const rejected = [];
    const observeOnly = [];

    // Simulate DNR rules against policy
    for (const rule of (dnrCandidates || [])) {
        const risk = rule.risk || (rule.action?.type === "allow" ? "low" : "medium");
        if (risk === "high" && policy?.network?.highRiskResources === "specific-only") {
            if (rule.specificity !== "site-specific") {
                rejected.push({ type: "dnr", rule, reason: "High-risk broad rule rejected by policy" });
                continue;
            }
        }
        if (risk === "critical") {
            rejected.push({ type: "dnr", rule, reason: "Critical risk rule rejected" });
            continue;
        }
        allowed.push({ type: "dnr", rule });
    }

    // Simulate cosmetic selectors against policy
    for (const sel of (cosmeticCandidates || [])) {
        if (sel.procedural && (policy?.proceduralCosmetic === false || policy?.cosmetic?.procedural === false)) {
            rejected.push({ type: "cosmetic", selector: sel.selector, reason: "Procedural cosmetic disabled by policy" });
            continue;
        }
        if (sel.generic && (policy?.genericCosmetic === false || policy?.cosmetic?.generic === false)) {
            rejected.push({ type: "cosmetic", selector: sel.selector, reason: "Generic cosmetic disabled by policy" });
            continue;
        }
        allowed.push({ type: "cosmetic", selector: sel.selector });
    }

    // Simulate video mutations against policy
    for (const vd of (videoDetections || [])) {
        if (policy?.video?.allowMutation === false) {
            observeOnly.push({ type: "video", detection: vd, reason: "Video mutation disabled by policy" });
            continue;
        }
        if (policy?.video?.allowMutation === "known-adapter-only" && !vd.knownAdapter) {
            observeOnly.push({ type: "video", detection: vd, reason: "Unknown video adapter" });
            continue;
        }
        allowed.push({ type: "video", detection: vd });
    }

    // Simulate scriptlet injection
    for (const s of (scriptlets || [])) {
        if (policy?.mainWorldHooks === "off" || policy?.scriptlets?.mainWorldHooks === false) {
            rejected.push({ type: "scriptlet", name: s.name, reason: "Scriptlet disabled by policy" });
            continue;
        }
        allowed.push({ type: "scriptlet", name: s.name });
    }

    return {
        allowed,
        rejected,
        observeOnly,
        riskSummary: {
            totalActions: allowed.length + rejected.length + observeOnly.length,
            allowedCount: allowed.length,
            rejectedCount: rejected.length,
            observeOnlyCount: observeOnly.length,
        },
    };
}
