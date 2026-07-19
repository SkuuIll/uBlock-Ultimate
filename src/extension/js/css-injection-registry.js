/**
 * platform/chromium/js/css-injection-registry.js
 *
 * CSS injection registry for tracking injected stylesheets.
 *
 * Records every CSS injection (cosmetic filters, procedural filters,
 * element hiding, etc.) per tab/frame so they can be removed on
 * policy change, navigation, or cleanup. Prevents double-injection
 * and supports rollback.
 *
 * Usage:
 *   import { CssInjectionRegistry } from "./css-injection-registry.js";
 *   CssInjectionRegistry.register(tabId, frameId, styleId);
 *   CssInjectionRegistry.removeForTab(tabId);
 */

const _injections = new Map();

function _key(tabId, frameId) {
    return `${tabId}:${frameId}`;
}

export const CssInjectionRegistry = Object.freeze({
    /**
     * Register a CSS injection.
     * @param {number} tabId
     * @param {number} frameId
     * @param {string} styleId
     * @param {{ selector?: string, type?: string }} [info]
     */
    register(tabId, frameId, styleId, info = {}) {
        const k = _key(tabId, frameId);
        if (!_injections.has(k)) _injections.set(k, []);
        _injections.get(k).push({
            styleId,
            selector: info.selector || "",
            type: info.type || "cosmetic",
            injectedAt: Date.now(),
        });
    },

    /**
     * Get all injections for a frame.
     * @param {number} tabId
     * @param {number} frameId
     * @returns {object[]}
     */
    get(tabId, frameId) {
        return _injections.get(_key(tabId, frameId)) || [];
    },

    /**
     * Remove all injections for a specific frame.
     * @param {number} tabId
     * @param {number} frameId
     * @returns {string[]} removed style IDs
     */
    remove(tabId, frameId) {
        const k = _key(tabId, frameId);
        const entries = _injections.get(k) || [];
        _injections.delete(k);
        return entries.map(e => e.styleId);
    },

    /**
     * Remove all injections for a tab.
     * @param {number} tabId
     */
    removeForTab(tabId) {
        for (const [key] of _injections) {
            if (key.startsWith(`${tabId}:`)) _injections.delete(key);
        }
    },

    /**
     * Remove all injections.
     */
    clear() {
        _injections.clear();
    },
});
