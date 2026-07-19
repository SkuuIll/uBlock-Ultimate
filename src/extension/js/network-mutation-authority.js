/**
 * platform/chromium/js/network-mutation-authority.js
 *
 * Network-mutation authority for DNR action decisions.
 *
 * Every DNR action that mutates network behavior (block, redirect,
 * modifyHeaders, allow, upgradeScheme) must pass through this authority
 * which validates it against the filter-list trust tier, profile mode,
 * and policy revision.
 *
 * Usage:
 *   import { NetworkMutationAuthority } from "./network-mutation-authority.js";
 *   const result = NetworkMutationAuthority.authorize({ action: "redirect", tierId: "user-imported" });
 */

const _highRiskActions = ["redirect", "modifyHeaders", "csp", "scriptlet"];

const _tierActionCheck = {
    "built-in": { redirect: true, modifyHeaders: true, csp: true, scriptlet: true },
    bundled: { redirect: true, modifyHeaders: false, csp: false, scriptlet: false },
    "remote-stock": { redirect: false, modifyHeaders: false, csp: false, scriptlet: false },
    "user-imported": { redirect: false, modifyHeaders: false, csp: false, scriptlet: false },
    "trusted-user": { redirect: true, modifyHeaders: true, csp: true, scriptlet: true },
    experimental: { redirect: false, modifyHeaders: false, csp: false, scriptlet: false },
};

export const NetworkMutationAuthority = Object.freeze({
    /**
     * Authorize a network mutation action.
     * @param {{
     *   action: string,
     *   tierId?: string,
     *   profileMode?: string,
     *   policyReady?: boolean,
     * }} request
     * @returns {{ ok: boolean, reason?: string, downgradeTo?: string }}
     */
    authorize(request) {
        if (request.policyReady === false) {
            return { ok: false, reason: "policy-not-ready", downgradeTo: "observe-only" };
        }

        if (request.profileMode === "incognito" || request.profileMode === "private") {
            if (_highRiskActions.includes(request.action)) {
                return { ok: false, reason: `blocked-in-${request.profileMode}`, downgradeTo: "observe-only" };
            }
        }

        if (request.tierId && _highRiskActions.includes(request.action)) {
            const tierCheck = _tierActionCheck[request.tierId];
            if (!tierCheck) return { ok: false, reason: `unknown-tier: ${request.tierId}`, downgradeTo: "block" };
            if (!tierCheck[request.action]) {
                return { ok: false, reason: `action-not-allowed-by-tier: ${request.tierId}`, downgradeTo: "block" };
            }
        }

        return { ok: true };
    },
});
