/**
 * platform/chromium/js/dnr-install-decisions.js
 *
 * Compile rule evidence into install reports (P2.3).
 * Every installed dynamic/session DNR rule has a decision record.
 *
 * Usage:
 *   import { recordInstallDecision, getInstallDecisions, clearInstallDecisions }
 *     from "./dnr-install-decisions.js";
 */

const decisions = [];

export function recordInstallDecision(decision) {
    decisions.push({
        id: decision.id,
        action: decision.action,
        sourceList: decision.sourceList,
        rawFilter: decision.rawFilter,
        resourceTypes: decision.resourceTypes,
        risk: decision.risk,
        specificity: decision.specificity,
        decision: decision.decision,
        reason: decision.reason,
        timestamp: Date.now(),
    });
}

export function getInstallDecisions() {
    return [...decisions];
}

export function clearInstallDecisions() {
    decisions.length = 0;
}
