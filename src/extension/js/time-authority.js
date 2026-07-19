/**
 * platform/chromium/js/time-authority.js
 *
 * Centralized time, expiry, and freshness decisions.
 *
 * Every subsystem that needs timestamps, expiry checks, or freshness
 * decisions goes through this module so tests remain deterministic
 * and expiration rules stay consistent.
 *
 * Usage:
 *   import { timeAuthority } from "./time-authority.js";
 *   const now = timeAuthority.nowMs();
 *   const expired = timeAuthority.isExpired(timestamp, "filter-list-cache");
 *   const freshness = timeAuthority.freshnessState(timestamp, "filter-list-cache");
 */

// ---------------------------------------------------------------------------
// Freshness policies (TTL in ms)
// ---------------------------------------------------------------------------

const _defaultPolicies = {
    "filter-list-cache": { ttl: 4 * 60 * 60 * 1000 },          // 4 hours
    "compatibility-entry": { ttl: 24 * 60 * 60 * 1000 },        // 24 hours
    "diagnostic-bundle": { ttl: 7 * 24 * 60 * 60 * 1000 },      // 7 days
    "capability-token": { ttl: 60 * 60 * 1000 },                 // 1 hour
    "operation-token": { ttl: 30 * 1000 },                       // 30 seconds
    "local-recorder": { ttl: 24 * 60 * 60 * 1000 },              // 24 hours
    "smart-rule-metadata": { ttl: 12 * 60 * 60 * 1000 },         // 12 hours
    "session": { ttl: 30 * 60 * 1000 },                          // 30 minutes
    "popup-state": { ttl: 5 * 60 * 1000 },                       // 5 minutes
};

let _policies = new Map(Object.entries(_defaultPolicies));
let _nowOverride = null;  // for testing

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const timeAuthority = {
    /**
     * Current time in milliseconds.
     * Returns the overridden time in test mode, Date.now() otherwise.
     */
    nowMs() {
        return _nowOverride !== null ? _nowOverride : Date.now();
    },

    /**
     * Current time as ISO 8601 string.
     */
    nowIso() {
        return new Date(timeAuthority.nowMs()).toISOString();
    },

    /**
     * Monotonic operation ID within a scope.
     * Uses a simple incrementing counter per scope.
     */
    monotonicOperationId(scope) {
        if (!_monotonicCounters.has(scope)) {
            _monotonicCounters.set(scope, 0);
        }
        const id = _monotonicCounters.get(scope) + 1;
        _monotonicCounters.set(scope, id);
        return `${scope}-${id}-${timeAuthority.nowMs()}`;
    },

    /**
     * Check whether a timestamp or ISO string is expired under a TTL policy.
     *
     * @param {number|string} value - timestamp (ms) or ISO string
     * @param {string} ttlPolicy - key into freshness policy config
     * @returns {boolean}
     */
    isExpired(value, ttlPolicy) {
        return timeAuthority.freshnessState(value, ttlPolicy) === "expired";
    },

    /**
     * Check freshness state: "fresh", "stale", or "expired".
     *
     * - "fresh": within TTL
     * - "stale": beyond TTL but within 2x TTL
     * - "expired": beyond 2x TTL
     */
    freshnessState(value, ttlPolicy) {
        if (value == null) return "expired";

        const ts = typeof value === "string" ? new Date(value).getTime() : Number(value);
        if (Number.isNaN(ts)) return "expired";

        const policy = _policies.get(ttlPolicy);
        if (!policy) return "fresh";  // unknown policy — assume fresh

        const age = timeAuthority.nowMs() - ts;
        if (age < policy.ttl) return "fresh";
        if (age < policy.ttl * 2) return "stale";
        return "expired";
    },

    /**
     * Define or override a freshness policy.
     */
    definePolicy(name, opts) {
        _policies.set(name, { ttl: opts.ttl });
    },

    /**
     * Override the clock for testing.
     */
    setNow(ms) {
        _nowOverride = ms;
    },

    /**
     * Reset the clock override (restore real time).
     */
    resetClock() {
        _nowOverride = null;
    },

    /**
     * Reset all policies to defaults.
     */
    resetPolicies() {
        _policies = new Map(Object.entries(_defaultPolicies));
    },

    /**
     * Return a diagnostic snapshot.
     */
    getSnapshot() {
        const policies = {};
        for (const [name, policy] of _policies) {
            policies[name] = { ttlMs: policy.ttl };
        }
        return {
            now: timeAuthority.nowMs(),
            nowIso: timeAuthority.nowIso(),
            policies,
            clockOverridden: _nowOverride !== null,
        };
    },
};

// ---------------------------------------------------------------------------
// Internal monotonic counter storage
// ---------------------------------------------------------------------------

const _monotonicCounters = new Map();
