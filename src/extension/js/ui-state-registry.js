/**
 * platform/chromium/js/ui-state-registry.js
 *
 * UI state registry for popup, dashboard, and logger state.
 *
 * Tracks the active state of extension UI surfaces (popup, dashboard
 * panels, logger visibility, side panel) so that state changes can
 * be synchronized and stale entries cleaned up on service worker
 * restart or suspension.
 *
 * Usage:
 *   import { UiStateRegistry } from "./ui-state-registry.js";
 *   UiStateRegistry.set("popup", { open: true, tabId: 5 });
 *   const state = UiStateRegistry.get("popup");
 */

const _state = new Map();

export const UiStateRegistry = Object.freeze({
    /**
     * Set UI state for a surface.
     * @param {"popup"|"dashboard"|"logger"|"side-panel"} surface
     * @param {object} data
     */
    set(surface, data) {
        _state.set(surface, { ...data, updatedAt: Date.now() });
    },

    /**
     * Get UI state for a surface.
     * @param {"popup"|"dashboard"|"logger"|"side-panel"} surface
     * @returns {object|null}
     */
    get(surface) {
        return _state.get(surface) || null;
    },

    /**
     * Remove state for a surface.
     * @param {string} surface
     */
    remove(surface) {
        _state.delete(surface);
    },

    /**
     * Get all UI state.
     * @returns {object}
     */
    getAll() {
        const result = {};
        for (const [key, value] of _state) result[key] = value;
        return result;
    },

    clear() {
        _state.clear();
    },
});
