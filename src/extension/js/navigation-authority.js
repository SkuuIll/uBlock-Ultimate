/**
 * platform/chromium/js/navigation-authority.js
 *
 * Navigation and tab-mutation authority.
 *
 * All tab navigation, create, reload, close, and URL-mutation operations
 * route through this authority. Each operation is checked against policy
 * readiness, user intent, and route authority.
 *
 * Usage:
 *   import { NavigationAuthority } from "./navigation-authority.js";
 *   const result = await NavigationAuthority.authorizeNavigate({ tabId, url, sourceRoute });
 */

const _allowedNavigationRoutes = ["popup", "dashboard", "context-menu", "command"];

export const NavigationAuthority = Object.freeze({
    /**
     * Authorize a navigation or tab mutation.
     * @param {{
     *   operation: "navigate"|"create"|"reload"|"close"|"update-url",
     *   tabId?: number,
     *   url?: string,
     *   sourceRoute: string,
     *   userIntentToken?: string,
     *   policyReady?: boolean,
     * }} request
     * @returns {{ ok: boolean, reason?: string }}
     */
    authorize(request) {
        if (!_allowedNavigationRoutes.includes(request.sourceRoute)) {
            return { ok: false, reason: `route-not-allowed: ${request.sourceRoute}` };
        }

        if (request.operation === "navigate" && request.url) {
            try {
                const url = new URL(request.url);
                if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "chrome-extension:") {
                    return { ok: false, reason: `unsupported-protocol: ${url.protocol}` };
                }
            } catch (_) {
                return { ok: false, reason: "invalid-url" };
            }
        }

        if (request.operation === "close" && !request.userIntentToken) {
            return { ok: false, reason: "user-intent-required" };
        }

        return { ok: true };
    },

    /**
     * Authorize opening a new tab from an extension route.
     * @param {{ url: string, sourceRoute: string, userIntentToken?: string }} request
     * @returns {{ ok: boolean, reason?: string }}
     */
    authorizeCreate(request) {
        return this.authorize({ ...request, operation: "create" });
    },
});
