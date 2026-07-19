/**
 * platform/chromium/js/feature-flag-authority.js
 *
 * Feature-flag, experiment, and kill-switch authority.
 *
 * Every runtime feature flag, experiment toggle, emergency disable, and
 * temporary compatibility setting is declared in one authority. Flags
 * have expiry dates, kill-switch support, rollout stages, and policy
 * profile restrictions. Release builds reject dev-only or expired flags.
 *
 * Usage:
 *   import { FeatureFlagAuthority } from "./feature-flag-authority.js";
 *   FeatureFlagAuthority.define("my-experiment", { defaultState: "off", owner: "team-x", reason: "..." });
 *   if (FeatureFlagAuthority.isEnabled("my-experiment")) { ... }
 */

const _flags = new Map();

/**
 * @typedef {{
 *   id: string,
 *   owner: string,
 *   defaultState: "off"|"observe-only"|"on",
 *   allowedInRelease: boolean,
 *   policyProfiles: string[],
 *   requiredCapabilities: string[],
 *   expiresAt?: string,
 *   killSwitch?: boolean,
 *   rollout?: "none"|"local-dev"|"manual"|"stable",
 *   reason: string,
 *   fixtures: string[],
 * }} FeatureFlag
 */

export const FeatureFlagAuthority = Object.freeze({
    /**
     * Define a feature flag.
     * @param {string} id
     * @param {FeatureFlag} spec
     */
    define(id, spec) {
        if (_flags.has(id)) throw new Error(`Duplicate feature flag: ${id}`);
        _flags.set(id, {
            id,
            owner: spec.owner || "unknown",
            defaultState: spec.defaultState || "off",
            allowedInRelease: spec.allowedInRelease || false,
            policyProfiles: spec.policyProfiles || [],
            requiredCapabilities: spec.requiredCapabilities || [],
            expiresAt: spec.expiresAt || "",
            killSwitch: spec.killSwitch || false,
            rollout: spec.rollout || "none",
            reason: spec.reason || "",
            fixtures: spec.fixtures || [],
        });
    },

    /**
     * Check whether a flag is currently enabled.
     * @param {string} id
     * @param {{ profile?: string, release?: boolean }} [context]
     * @returns {boolean}
     */
    isEnabled(id, context = {}) {
        const flag = _flags.get(id);
        if (!flag) return false;

        if (context.release === true && !flag.allowedInRelease) return false;
        if (flag.killSwitch) return false;

        if (flag.expiresAt) {
            const expiry = new Date(flag.expiresAt).getTime();
            if (Date.now() > expiry) return false;
        }

        if (flag.defaultState === "off") return false;
        if (flag.defaultState === "observe-only") return false;

        return flag.defaultState === "on";
    },

    /**
     * Check whether a flag permits observe-only behavior (logging/diagnostics
     * without mutation).
     * @param {string} id
     * @param {object} [context]
     * @returns {boolean}
     */
    canObserve(id, context = {}) {
        const flag = _flags.get(id);
        if (!flag) return false;
        if (context.release === true && !flag.allowedInRelease) return false;
        if (flag.killSwitch) return false;
        return flag.defaultState === "observe-only" || flag.defaultState === "on";
    },

    /**
     * Check whether a kill-switch is active for the given flag.
     * @param {string} id
     * @returns {boolean}
     */
    isKillSwitched(id) {
        const flag = _flags.get(id);
        return flag ? flag.killSwitch || false : false;
    },

    /**
     * Get a flag's declaration.
     * @param {string} id
     * @returns {FeatureFlag|undefined}
     */
    get(id) {
        return _flags.get(id);
    },

    entries() {
        return _flags.entries();
    },
});
