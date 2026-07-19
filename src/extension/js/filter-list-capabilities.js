/**
 * platform/chromium/js/filter-list-capabilities.js
 *
 * Filter-list trust tiers and capability caps.
 *
 * Every filter-list source (built-in, bundled, remote, user-imported,
 * manual, experimental) belongs to a trust tier that defines which
 * actions, resource types, and risk levels are allowed. Imported or
 * untrusted lists cannot silently gain access to high-risk transforms
 * such as redirects, header mutation, CSP mutation, or scriptlets.
 *
 * Usage:
 *   import { FilterListCapabilities } from "./filter-list-capabilities.js";
 *   const tier = FilterListCapabilities.getTier("user-imported");
 *   if (!tier.allowRedirect) { /* downgrade redirect rules *\/ }
 */

const _tiers = new Map();

/**
 * Define a trust tier.
 * @param {string} id
 * @param {{
 *   allowedActions?: string[],
 *   allowedResourceTypes?: string[],
 *   allowRedirect?: boolean,
 *   allowHeaderMutation?: boolean,
 *   allowScriptlets?: boolean,
 *   allowCspMutation?: boolean,
 *   allowRemoveParam?: boolean,
 *   maxRuleRisk?: "low"|"medium"|"high",
 * }} spec
 */
function defineTier(id, spec) {
    if (_tiers.has(id)) throw new Error(`Duplicate tier: ${id}`);
    _tiers.set(id, {
        id,
        allowedActions: spec.allowedActions || ["block"],
        allowedResourceTypes: spec.allowedResourceTypes || [],
        allowRedirect: spec.allowRedirect || false,
        allowHeaderMutation: spec.allowHeaderMutation || false,
        allowScriptlets: spec.allowScriptlets || false,
        allowCspMutation: spec.allowCspMutation || false,
        allowRemoveParam: spec.allowRemoveParam || false,
        maxRuleRisk: spec.maxRuleRisk || "low",
    });
}

// --- Built-in tiers ---

defineTier("built-in", {
    allowedActions: ["block", "redirect", "modifyHeaders", "allow"],
    allowedResourceTypes: ["main_frame", "sub_frame", "script", "stylesheet", "image", "font", "media", "websocket", "xhr", "other"],
    allowRedirect: true,
    allowHeaderMutation: true,
    allowScriptlets: true,
    allowCspMutation: true,
    allowRemoveParam: true,
    maxRuleRisk: "high",
});

defineTier("bundled", {
    allowedActions: ["block", "redirect"],
    allowedResourceTypes: ["script", "image", "stylesheet", "font", "media", "xhr", "other"],
    allowRedirect: true,
    allowHeaderMutation: false,
    allowScriptlets: false,
    allowCspMutation: false,
    allowRemoveParam: true,
    maxRuleRisk: "medium",
});

defineTier("remote-stock", {
    allowedActions: ["block"],
    allowedResourceTypes: ["script", "image", "stylesheet", "font", "xhr"],
    allowRedirect: false,
    allowHeaderMutation: false,
    allowScriptlets: false,
    allowCspMutation: false,
    allowRemoveParam: false,
    maxRuleRisk: "low",
});

defineTier("user-imported", {
    allowedActions: ["block"],
    allowedResourceTypes: ["script", "image", "stylesheet", "xhr"],
    allowRedirect: false,
    allowHeaderMutation: false,
    allowScriptlets: false,
    allowCspMutation: false,
    allowRemoveParam: false,
    maxRuleRisk: "low",
});

defineTier("trusted-user", {
    allowedActions: ["block", "redirect", "modifyHeaders"],
    allowedResourceTypes: ["main_frame", "sub_frame", "script", "stylesheet", "image", "font", "media", "websocket", "xhr", "other"],
    allowRedirect: true,
    allowHeaderMutation: true,
    allowScriptlets: true,
    allowCspMutation: true,
    allowRemoveParam: true,
    maxRuleRisk: "high",
});

defineTier("experimental", {
    allowedActions: ["block"],
    allowedResourceTypes: ["script", "image", "xhr"],
    allowRedirect: false,
    allowHeaderMutation: false,
    allowScriptlets: false,
    allowCspMutation: false,
    allowRemoveParam: false,
    maxRuleRisk: "low",
});

export const FilterListCapabilities = Object.freeze({
    /**
     * Get the trust tier for a given list source.
     * @param {string} tierId
     * @returns {object|undefined}
     */
    getTier(tierId) {
        return _tiers.get(tierId);
    },

    /**
     * Check whether a specific action is allowed for a tier.
     * @param {string} tierId
     * @param {string} action
     * @returns {boolean}
     */
    isActionAllowed(tierId, action) {
        const tier = _tiers.get(tierId);
        if (!tier) return false;

        if (action === "redirect") return tier.allowRedirect;
        if (action === "modifyHeaders") return tier.allowHeaderMutation;
        if (action === "scriptlet") return tier.allowScriptlets;
        if (action === "csp") return tier.allowCspMutation;
        if (action === "removeParam") return tier.allowRemoveParam;
        return tier.allowedActions.includes(action);
    },

    /**
     * Check whether a risk level is within the tier's cap.
     * @param {string} tierId
     * @param {"low"|"medium"|"high"} risk
     * @returns {boolean}
     */
    isRiskAllowed(tierId, risk) {
        const tier = _tiers.get(tierId);
        if (!tier) return false;
        const levels = ["low", "medium", "high"];
        return levels.indexOf(risk) <= levels.indexOf(tier.maxRuleRisk);
    },

    defineTier,
});
