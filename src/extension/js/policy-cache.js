/**
 * platform/chromium/js/policy-cache.js
 *
 * Policy snapshot caching with explicit invalidation.
 * Cache page policy by tab/frame/document lifecycle.
 *
 * Usage:
 *   import { getCachedPolicy, setCachedPolicy, invalidateTabPolicy,
 *            invalidateAllPolicy, getPolicyRevision, bumpPolicyRevision }
 *     from "./policy-cache.js";
 */

let currentRevision = 1;
const tabCache = new Map();

function tabKey(tabId, frameId) {
    return `${tabId}:${frameId || 0}`;
}

export function getPolicyRevision() {
    return currentRevision;
}

export function bumpPolicyRevision() {
    currentRevision++;
    return currentRevision;
}

export function getCachedPolicy(tabId, frameId) {
    const key = tabKey(tabId, frameId);
    return tabCache.get(key) || null;
}

export function setCachedPolicy(tabId, frameId, policy) {
    const key = tabKey(tabId, frameId);
    tabCache.set(key, {
        tabId,
        frameId,
        url: policy.url || "",
        hostname: policy.hostname || "",
        revision: currentRevision,
        policy,
    });
}

export function invalidateTabPolicy(tabId) {
    for (const key of tabCache.keys()) {
        if (key.startsWith(`${tabId}:`)) {
            tabCache.delete(key);
        }
    }
}

export function invalidateAllPolicy() {
    tabCache.clear();
    bumpPolicyRevision();
}
