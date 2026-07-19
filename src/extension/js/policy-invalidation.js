/**
 * platform/chromium/js/policy-invalidation.js
 *
 * Policy/config invalidation bus.
 *
 * Every policy-affecting mutation (profile reload, browser capability
 * change, whitelist update, setting toggle, filter-list change, user
 * rule update, compatibility debt removal, safe mode entry/exit) emits
 * one invalidation event.  Runtime layers, caches, badge, popup, logger,
 * and content scripts subscribe to invalidations.
 *
 * Usage:
 *   import { policyInvalidation } from "./policy-invalidation.js";
 *   policyInvalidation.emit({ reason: "whitelist-update", ... });
 *   policyInvalidation.on((event) => { ... });
 *   const unsub = policyInvalidation.on((event) => { ... });
 */

// ---------------------------------------------------------------------------
// Required action constants
// ---------------------------------------------------------------------------

const ACTION = Object.freeze({
    STOP_LAYERS: "stop-layers",
    RELOAD_POLICY: "reload-policy",
    CLEAR_CSS: "clear-css",
    RESIMULATE: "resimulate",
    REFRESH_POPUP: "refresh-popup",
});

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _revision = 0;
const _listeners = new Set();
let _lastEvent = null;

function _nextRevision() {
    return ++_revision;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const policyInvalidation = {
    ACTION,

    /**
     * Emit a policy invalidation event.
     *
     * @param {object} event
     * @param {string} event.reason
     * @param {number[]} [event.affectedTabs]
     * @param {string[]} [event.affectedProfiles]
     * @param {string[]} [event.requiredActions]
     */
    emit(event) {
        const ev = {
            reason: event.reason,
            oldRevision: _revision,
            newRevision: _nextRevision(),
            affectedTabs: event.affectedTabs,
            affectedProfiles: event.affectedProfiles,
            requiredActions: event.requiredActions || [ACTION.RELOAD_POLICY],
            timestamp: Date.now(),
        };

        _lastEvent = ev;

        // Notify all listeners
        for (const listener of _listeners) {
            try {
                listener(ev);
            } catch (_) {
                // Listener errors are non-fatal
            }
        }

        // Autobump PolicySnapshot revision
        import("./policy-snapshot.js").then(mod => {
            mod.PolicySnapshot.invalidateAll({ reason: event.reason });
        }).catch(reason => {
            console.warn('[uBlock Ultimate] policy-invalidation: PolicySnapshot.invalidateAll failed', reason);
        });
    },

    /**
     * Subscribe to invalidation events.
     * Returns an unsubscribe function.
     */
    on(listener) {
        _listeners.add(listener);
        return () => { _listeners.delete(listener); };
    },

    /**
     * Remove a previously subscribed listener.
     */
    off(listener) {
        _listeners.delete(listener);
    },

    /**
     * Get the current policy revision.
     */
    getCurrentRevision() {
        return _revision;
    },

    /**
     * Get the last emitted event (for late subscribers).
     */
    getLastEvent() {
        return _lastEvent;
    },

    /**
     * Return diagnostic snapshot.
     */
    getSnapshot() {
        return {
            currentRevision: _revision,
            listenerCount: _listeners.size,
            lastEvent: _lastEvent,
        };
    },
};
