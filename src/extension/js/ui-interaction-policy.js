/**
 * platform/chromium/js/ui-interaction-policy.js
 *
 * UI interaction policy for extension page and popup actions.
 *
 * Defines which UI interactions are allowed based on the caller route,
 * policy readiness, and user intent. Controls access to high-risk UI
 * operations like backup/restore, filter list management, and user
 * rule editing.
 *
 * Usage:
 *   import { UiInteractionPolicy } from "./ui-interaction-policy.js";
 *   const ok = UiInteractionPolicy.can("restore-backup", { route: "dashboard", policyReady: true });
 */

const _interactionGates = new Map([
    ["restore-backup", { allowedRoutes: ["dashboard", "popup"], requirePolicyReady: true, requireUserIntent: true }],
    ["import-filters", { allowedRoutes: ["dashboard"], requirePolicyReady: true, requireUserIntent: true }],
    ["export-backup", { allowedRoutes: ["dashboard", "popup"], requirePolicyReady: false, requireUserIntent: false }],
    ["toggle-filter-list", { allowedRoutes: ["dashboard", "popup"], requirePolicyReady: true, requireUserIntent: false }],
    ["edit-user-filters", { allowedRoutes: ["dashboard", "popup"], requirePolicyReady: true, requireUserIntent: false }],
    ["clear-all-data", { allowedRoutes: ["dashboard"], requirePolicyReady: false, requireUserIntent: true }],
    ["enable-advanced-mode", { allowedRoutes: ["dashboard", "popup"], requirePolicyReady: false, requireUserIntent: true }],
]);

export const UiInteractionPolicy = Object.freeze({
    /**
     * Check whether a UI interaction is allowed.
     * @param {string} interaction
     * @param {{ route: string, policyReady?: boolean, userIntentToken?: string }} context
     * @returns {{ ok: boolean, reason?: string }}
     */
    can(interaction, context) {
        const gate = _interactionGates.get(interaction);
        if (!gate) return { ok: false, reason: `unknown-interaction: ${interaction}` };

        if (gate.allowedRoutes.length > 0 && !gate.allowedRoutes.includes(context.route)) {
            return { ok: false, reason: `route-not-allowed: ${context.route}` };
        }
        if (gate.requirePolicyReady && !context.policyReady) {
            return { ok: false, reason: "policy-not-ready" };
        }
        if (gate.requireUserIntent && !context.userIntentToken) {
            return { ok: false, reason: "user-intent-required" };
        }
        return { ok: true };
    },
});
