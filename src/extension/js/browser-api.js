/**
 * platform/chromium/js/browser-api.js
 *
 * Browser API wrapper with error taxonomy integration.
 *
 * Every browser API call that can fail in high-risk paths should route
 * through this wrapper, which maps errors through the browser API error
 * taxonomy and ensures consistent fallback behavior.
 *
 * Usage:
 *   import { BrowserApi } from "./browser-api.js";
 *   const [tab] = await BrowserApi.safeCall("tabs", "query", { active: true });
 */

import { BrowserApiError } from "./browser-api-errors.js";

const _apiDefaults = {
    tabs: { query: [], get: null, create: null, update: null, remove: null, reload: null },
    scripting: { executeScript: [], insertCSS: [], removeCSS: [] },
    dnr: { updateSessionRules: null, updateDynamicRules: null, getSessionRules: [], getDynamicRules: [] },
    contextMenus: { create: null, update: null, remove: null, removeAll: null },
    storage: { local: { get: null, set: null, remove: null, clear: null } },
    webRequest: { onBeforeRequest: null, onBeforeSendHeaders: null, onHeadersReceived: null },
    permissions: { request: null, contains: null, remove: null, getAll: null },
};

export const BrowserApi = Object.freeze({
    /**
     * Safely call a browser API with error taxonomy integration.
     * @param {string} api - e.g., "tabs", "scripting"
     * @param {string} method - e.g., "query", "executeScript"
     * @param {...any} args
     * @returns {Promise<{ ok: boolean, result?: any, error?: object }>}
     */
    async safeCall(api, method, ...args) {
        try {
            const chromeApi = chrome[api];
            if (!chromeApi) return { ok: false, error: { reason: "api-unavailable" } };

            const fn = chromeApi[method];
            if (!fn) return { ok: false, error: { reason: `method-unavailable: ${method}` } };

            const result = await fn.call(chromeApi, ...args);
            return { ok: true, result };
        } catch (err) {
            const classified = BrowserApiError.classify(api, method, err);
            return { ok: false, error: classified };
        }
    },

    /**
     * Call a browser API and return the default value on failure.
     * @param {string} api
     * @param {string} method
     * @param {...any} args
     * @returns {Promise<any>}
     */
    async safeCallWithDefault(api, method, ...args) {
        const result = await this.safeCall(api, method, ...args);
        if (result.ok) return result.result;
        const defaults = _apiDefaults[api]?.[method];
        return defaults !== undefined ? defaults : null;
    },
});
