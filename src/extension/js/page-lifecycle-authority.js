/**
 * platform/chromium/js/page-lifecycle-authority.js
 *
 * Page lifecycle mode authority.
 *
 * Documents transition through lifecycle states (active, hidden,
 * prerendering, frozen, BFCache-suspended, discarded, revived).
 * Mutation-capable operations (DOM, click, CSS injection) are valid
 * only in active/revived documents.  Prerendering documents can collect
 * signals but cannot mutate.  BFCache-suspended documents invalidate
 * timers, observers, and bridge nonces until reconciliation.
 *
 * Usage:
 *   import { pageLifecycleAuthority } from "./page-lifecycle-authority.js";
 *   const mode = pageLifecycleAuthority.getMode(tabId, frameId);
 *   if (pageLifecycleAuthority.canMutate(mode)) { ... }
 *   pageLifecycleAuthority.transition(tabId, frameId, "active");
 */

// ---------------------------------------------------------------------------
// Lifecycle modes
// ---------------------------------------------------------------------------

const MODE = Object.freeze({
    ACTIVE: "active",
    HIDDEN: "hidden",
    PRERENDERING: "prerendering",
    FROZEN: "frozen",
    BFCACHE_SUSPENDED: "bfcache-suspended",
    DISCARDED: "discarded",
    RESTORING: "restoring",
    REVIVED: "revived",
});

// ---------------------------------------------------------------------------
// Capability matrix: what operations are allowed in each mode
// ---------------------------------------------------------------------------

const _CAN_MUTATE = new Set([
    MODE.ACTIVE,
    MODE.REVIVED,
]);

const _CAN_OBSERVE = new Set([
    MODE.ACTIVE,
    MODE.HIDDEN,
    MODE.PRERENDERING,
    MODE.REVIVED,
]);

const _CAN_INJECT_CSS = new Set([
    MODE.ACTIVE,
    MODE.REVIVED,
    MODE.HIDDEN,
]);

const _CAN_COLLECT_SIGNALS = new Set([
    MODE.PRERENDERING,
    MODE.ACTIVE,
    MODE.HIDDEN,
    MODE.REVIVED,
]);

// ---------------------------------------------------------------------------
// Valid transitions (oldMode → set of allowed new modes)
// ---------------------------------------------------------------------------

const _TRANSITIONS = new Map([
    [MODE.ACTIVE, new Set([MODE.HIDDEN, MODE.FROZEN, MODE.BFCACHE_SUSPENDED, MODE.DISCARDED])],
    [MODE.HIDDEN, new Set([MODE.ACTIVE, MODE.FROZEN, MODE.BFCACHE_SUSPENDED, MODE.DISCARDED])],
    [MODE.PRERENDERING, new Set([MODE.ACTIVE, MODE.HIDDEN, MODE.DISCARDED])],
    [MODE.FROZEN, new Set([MODE.ACTIVE, MODE.HIDDEN, MODE.DISCARDED])],
    [MODE.BFCACHE_SUSPENDED, new Set([MODE.RESTORING, MODE.DISCARDED])],
    [MODE.DISCARDED, new Set()],   // terminal
    [MODE.RESTORING, new Set([MODE.REVIVED, MODE.ACTIVE])],
    [MODE.REVIVED, new Set([MODE.ACTIVE, MODE.HIDDEN, MODE.FROZEN, MODE.DISCARDED])],
]);

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _states = new Map();  // key: `${tabId}:${frameId}` → mode

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _key(tabId, frameId) {
    return `${tabId}:${frameId}`;
}

function _assertValidMode(mode) {
    if (!Object.values(MODE).includes(mode)) {
        throw new Error(`Invalid lifecycle mode: ${mode}`);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const pageLifecycleAuthority = {
    MODE,

    /**
     * Get the current lifecycle mode for a (tabId, frameId).
     * Returns "active" by default (assumes active page if unknown).
     */
    getMode(tabId, frameId) {
        return _states.get(_key(tabId, frameId)) || MODE.ACTIVE;
    },

    /**
     * Transition a (tabId, frameId) to a new lifecycle mode.
     * Validates that the transition is allowed.  Returns
     * { ok: true } on success, or { ok: false, reason } on failure.
     */
    transition(tabId, frameId, newMode) {
        _assertValidMode(newMode);

        const k = _key(tabId, frameId);
        const oldMode = _states.get(k) || MODE.ACTIVE;

        if (oldMode === newMode) {
            return { ok: true, reason: "no-change" };
        }

        const allowed = _TRANSITIONS.get(oldMode);
        if (!allowed || !allowed.has(newMode)) {
            return {
                ok: false,
                reason: `Cannot transition from "${oldMode}" to "${newMode}"`,
            };
        }

        _states.set(k, newMode);

        // If discarded, clean up state entry
        if (newMode === MODE.DISCARDED) {
            _states.delete(k);
        }

        return { ok: true };
    },

    /**
     * Remove all state for a tab (all frames).  Called on tab removal.
     */
    removeTab(tabId) {
        for (const [k] of _states) {
            if (k.startsWith(`${tabId}:`)) {
                _states.delete(k);
            }
        }
    },

    /**
     * Check whether a mode allows DOM mutation (hide, remove, click, etc.).
     */
    canMutate(mode) {
        return _CAN_MUTATE.has(mode);
    },

    /**
     * Check whether a mode allows DOM observation (MutationObserver, etc.).
     */
    canObserve(mode) {
        return _CAN_OBSERVE.has(mode);
    },

    /**
     * Check whether a mode allows CSS injection.
     */
    canInjectCSS(mode) {
        return _CAN_INJECT_CSS.has(mode);
    },

    /**
     * Check whether a mode allows signal collection (for prerendering).
     */
    canCollectSignals(mode) {
        return _CAN_COLLECT_SIGNALS.has(mode);
    },

    /**
     * Return a diagnostic snapshot of all tracked lifecycle states.
     */
    getSnapshot() {
        const entries = [];
        for (const [k, mode] of _states) {
            const [tabId, frameId] = k.split(":");
            entries.push({
                tabId: parseInt(tabId, 10),
                frameId: parseInt(frameId, 10),
                mode,
                canMutate: _CAN_MUTATE.has(mode),
                canObserve: _CAN_OBSERVE.has(mode),
                canInjectCSS: _CAN_INJECT_CSS.has(mode),
            });
        }
        return {
            trackedCount: entries.length,
            entries,
        };
    },
};
