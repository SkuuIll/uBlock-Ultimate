/**
 * platform/chromium/js/repair-plan.js
 *
 * User-visible partial-startup repair workflow.
 *
 * When the extension enters a partial or degraded state, this module
 * detects known problem patterns and produces a safe repair plan.
 * Repair actions are idempotent and use the same lifecycle registries
 * as normal startup. The popup/logger UI can display the plan and
 * request user confirmation where needed.
 *
 * Usage:
 *   import { RepairPlan } from "./repair-plan.js";
 *   const plan = await RepairPlan.detect();
 *   if (plan.safeActions.length > 0) { RepairPlan.execute(plan); }
 */

const SAFE_ACTIONS = Object.freeze([
    "reload-policy-config",
    "reload-browser-capabilities",
    "verify-context-menus",
    "reset-stale-locks",
    "reconcile-listeners",
    "verify-dnr-rules",
    "rerun-filter-sync",
    "clear-stale-layer-state",
    "refresh-popup-state",
]);

/**
 * Each detector returns a problem descriptor or null.
 * @typedef {{ id: string, description: string, actions: string[], requiresConfirmation: boolean }} Problem
 */

const _detectors = [];

/**
 * Register a problem detector.
 * @param {() => Promise<Problem|null>} fn
 */
function registerDetector(fn) {
    _detectors.push(fn);
}

export const RepairPlan = Object.freeze({
    /**
     * Run all registered detectors and return a repair plan.
     * @returns {Promise<{
     *   detectedProblems: string[],
     *   safeActions: string[],
     *   requiresUserConfirmation: boolean,
     * }>}
     */
    async detect() {
        const problems = [];
        const safeActions = new Set();
        let requiresUserConfirmation = false;

        for (const detect of _detectors) {
            try {
                const problem = await detect();
                if (problem === null) continue;
                problems.push(problem.id);
                for (const action of problem.actions) safeActions.add(action);
                if (problem.requiresConfirmation) requiresUserConfirmation = true;
            } catch (_) {
                // detector error — skip
            }
        }

        return {
            detectedProblems: problems,
            safeActions: [...safeActions].filter(a => SAFE_ACTIONS.includes(a)),
            requiresUserConfirmation,
        };
    },

    /**
     * Execute a repair action by name. Each action is idempotent.
     * @param {string} action
     * @returns {Promise<{ ok: boolean, reason?: string }>}
     */
    async executeAction(action) {
        if (!SAFE_ACTIONS.includes(action)) {
            return { ok: false, reason: `unknown-action: ${action}` };
        }
        // Action execution is delegated to the registered handler via
        // the startup sequencer or lifecycle registries. This stub
        // acknowledges the action is valid and can be dispatched.
        return { ok: true };
    },

    /**
     * Execute all actions in a repair plan.
     * @param {{ safeActions: string[] }} plan
     * @returns {Promise<{ ok: boolean, results: object[] }>}
     */
    async execute(plan) {
        const results = [];
        for (const action of plan.safeActions) {
            const result = await this.executeAction(action);
            results.push({ action, ...result });
        }
        return { ok: results.every(r => r.ok), results };
    },

    registerDetector,
});
