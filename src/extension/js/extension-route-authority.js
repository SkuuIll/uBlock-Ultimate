/**
 * platform/chromium/js/extension-route-authority.js
 *
 * Extension route authority for privileged page access.
 *
 * Controls access to extension-internal pages (dashboard, logger,
 * popup, asset viewer, code viewer, settings, etc.) by verifying
 * that only known routes can be opened and that callers have the
 * required permission scope.
 *
 * Usage:
 *   import { ExtensionRouteAuthority } from "./extension-route-authority.js";
 *   if (ExtensionRouteAuthority.canOpen("dashboard.html", sender)) { ... }
 */

const _knownRoutes = new Map([
    ["dashboard.html", { allowedSenders: ["popup", "command", "context-menu"], requiresPolicyReady: false }],
    ["logger-ui.html", { allowedSenders: ["popup", "dashboard", "command"], requiresPolicyReady: false }],
    ["popup-fenix.html", { allowedSenders: ["browser-action", "command"], requiresPolicyReady: true }],
    ["asset-viewer.html", { allowedSenders: ["dashboard"], requiresPolicyReady: false }],
    ["code-viewer.html", { allowedSenders: ["dashboard"], requiresPolicyReady: false }],
    ["settings.html", { allowedSenders: ["popup", "dashboard"], requiresPolicyReady: false }],
    ["3p-filters.html", { allowedSenders: ["dashboard"], requiresPolicyReady: true }],
    ["1p-filters.html", { allowedSenders: ["dashboard"], requiresPolicyReady: true }],
    ["whitelist.html", { allowedSenders: ["dashboard"], requiresPolicyReady: true }],
]);

export const ExtensionRouteAuthority = Object.freeze({
    /**
     * Check whether a sender can open an extension route.
     * @param {string} route - e.g., "dashboard.html"
     * @param {{ origin?: string, tab?: object }} sender
     * @param {{ policyReady?: boolean }} [context]
     * @returns {{ ok: boolean, reason?: string }}
     */
    canOpen(route, sender, context = {}) {
        const entry = _knownRoutes.get(route);
        if (!entry) return { ok: false, reason: "unknown-route" };

        const senderType = sender?.origin === "chrome://extensions" ? "browser-action"
            : sender?.origin?.startsWith("chrome-extension://") ? "extension-page"
            : "content";

        if (entry.allowedSenders.length > 0 && !entry.allowedSenders.includes(senderType)) {
            return { ok: false, reason: `sender-not-allowed: ${senderType}` };
        }

        if (entry.requiresPolicyReady && !context.policyReady) {
            return { ok: false, reason: "policy-not-ready" };
        }

        return { ok: true };
    },

    /**
     * Get the policy entry for a route.
     * @param {string} route
     * @returns {object|null}
     */
    get(route) {
        return _knownRoutes.get(route) || null;
    },

    /**
     * Register or override a route authority entry.
     * @param {string} route
     * @param {object} policy
     */
    define(route, policy) {
        _knownRoutes.set(route, policy);
    },
});
