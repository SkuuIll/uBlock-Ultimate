/**
 * platform/chromium/js/policy-reasons.js
 *
 * Policy-downgrade reason codes for every disabled or reduced layer.
 *
 * Every policy field that is `false`, `off`, `limited`, `observe-only`,
 * or `specific-only` must include a reason code and source. The reason
 * is carried alongside the policy so the UI, logger, and diagnostics
 * can explain why a layer is downgraded.
 *
 * Usage:
 *   import { policyReason } from "./policy-reasons.js";
 *   return { ...policy, cosmeticFiltering: policyReason(false, "profile", "app-shell-profile") };
 */

/**
 * Create a policy decision reason object.
 * @param {boolean|string} state - enabled/disabled/observe-only/specific-only/limited
 * @param {"profile"|"setting"|"managed"|"browser-capability"|"trust-tier"|"safe-mode"|"compatibility"} source
 * @param {string} reasonCode
 * @param {string} [explanation]
 * @returns {{ enabled: boolean, state: string, reasonCode: string, explanation: string, source: string }}
 */
export function policyReason(state, source, reasonCode, explanation) {
    let resolved;
    if (typeof state === "boolean") {
        resolved = state ? "enabled" : "disabled";
    } else {
        resolved = state;
    }
    return {
        enabled: resolved === "enabled",
        state: resolved,
        reasonCode: reasonCode || "unspecified",
        explanation: explanation || "",
        source: source || "profile",
    };
}

/**
 * Convenience wrappers for common downgrade patterns.
 */
export const Reasons = Object.freeze({
    disabledByProfile(mode) {
        return policyReason(false, "profile", `disabled-by-profile:${mode}`);
    },
    disabledBySetting(setting) {
        return policyReason(false, "setting", `disabled-by-setting:${setting}`);
    },
    disabledByBrowserCapability(cap) {
        return policyReason(false, "browser-capability", `unsupported-capability:${cap}`);
    },
    disabledByTrustTier(tier) {
        return policyReason(false, "trust-tier", `trust-tier:${tier}`);
    },
    safeMode() {
        return policyReason(false, "safe-mode", "safe-mode-active");
    },
    observeOnly() {
        return policyReason("observe-only", "profile", "observe-only-default");
    },
    compatibility(reason) {
        return policyReason(false, "compatibility", `compatibility:${reason}`);
    },
});
