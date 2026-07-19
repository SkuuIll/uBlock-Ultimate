/**
 * platform/chromium/js/frame-policy.js
 *
 * Per-frame resolved policy authority.
 *
 * After page-policy resolution, each frame in a tab gets a resolved
 * frame policy that is the merge of the profile-level page policy,
 * tab-level overrides, and frame-level characteristics (sandbox,
 * opaque origin, inherited origin, about:blank parent).
 *
 * Usage:
 *   import { FramePolicy } from "./frame-policy.js";
 *   FramePolicy.set(tabId, frameId, resolvedPolicy);
 *   const policy = FramePolicy.get(tabId, frameId);
 */

const _framePolicies = new Map();

function _key(tabId, frameId) {
    return `${tabId}:${frameId}`;
}

export const FramePolicy = Object.freeze({
    /**
     * Set the resolved policy for a frame.
     * @param {number} tabId
     * @param {number} frameId
     * @param {object} policy
     */
    set(tabId, frameId, policy) {
        _framePolicies.set(_key(tabId, frameId), policy);
    },

    /**
     * Get the resolved policy for a frame.
     * @param {number} tabId
     * @param {number} frameId
     * @returns {object|null}
     */
    get(tabId, frameId) {
        return _framePolicies.get(_key(tabId, frameId)) || null;
    },

    /**
     * Remove policy for a frame or all frames for a tab.
     * @param {number} tabId
     * @param {number} [frameId]
     */
    remove(tabId, frameId) {
        if (frameId !== undefined) {
            _framePolicies.delete(_key(tabId, frameId));
        } else {
            for (const [key] of _framePolicies) {
                if (key.startsWith(`${tabId}:`)) _framePolicies.delete(key);
            }
        }
    },

    /**
     * Check whether a frame has a policy set.
     * @param {number} tabId
     * @param {number} frameId
     * @returns {boolean}
     */
    has(tabId, frameId) {
        return _framePolicies.has(_key(tabId, frameId));
    },

    /**
     * Iterate all frame policies.
     */
    entries() {
        return _framePolicies.entries();
    },
});
