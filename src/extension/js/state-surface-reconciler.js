/**
 * platform/chromium/js/state-surface-reconciler.js
 *
 * State-surface reconciler for badge, icon, title, and popup state.
 *
 * Ensures that the browser action (badge, icon, title), popup state,
 * side-panel state, and repair banners all reflect the same effective
 * extension status. Prevents stale or contradictory writes from
 * scattered code paths.
 *
 * Usage:
 *   import { StateSurfaceReconciler } from "./state-surface-reconciler.js";
 *   StateSurfaceReconciler.sync({ policyReady: true, dnrReady: true, phase: "ready" });
 */

let _lastSyncedState = null;

export const StateSurfaceReconciler = Object.freeze({
    /**
     * Sync all visible state surfaces to reflect the given health/policy state.
     * @param {{ phase?: string, policyReady?: boolean, dnrReady?: boolean, degraded?: boolean, mode?: string }} state
     */
    async sync(state = {}) {
        const prev = _lastSyncedState;
        _lastSyncedState = { ...state };

        if (prev && prev.phase === state.phase && prev.policyReady === state.policyReady) {
            return; // no change
        }

        const ready = state.policyReady && state.dnrReady;

        try {
            if (ready) {
                await chrome.action.setBadgeBackgroundColor({ color: "#4688F1" });
                await chrome.action.setBadgeText({ text: "" });
                await chrome.action.setTitle({ title: "uBlock Origin" });
            } else if (state.degraded) {
                await chrome.action.setBadgeBackgroundColor({ color: "#F1A846" });
                await chrome.action.setBadgeText({ text: "!" });
                await chrome.action.setTitle({ title: "uBlock Origin — Degraded" });
            } else {
                await chrome.action.setBadgeBackgroundColor({ color: "#888" });
                await chrome.action.setBadgeText({ text: "..." });
                await chrome.action.setTitle({ title: "uBlock Origin — Starting" });
            }
        } catch (_) {
            // badge set may fail during early startup
        }
    },

    /**
     * Force a full resync (e.g. after popup opens).
     */
    async resync() {
        const prev = _lastSyncedState;
        _lastSyncedState = null;
        if (prev) await this.sync(prev);
    },
});
