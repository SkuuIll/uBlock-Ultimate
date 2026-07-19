/**
 * platform/chromium/js/network-retry-authority.js
 *
 * Network retry authority for transient failure handling.
 *
 * Controls when and how network operations (filter-list downloads,
 * asset fetches, cache updates) are retried after transient failures.
 * Enforces backoff, max retry counts, and jitter per operation type.
 *
 * Usage:
 *   import { NetworkRetryAuthority } from "./network-retry-authority.js";
 *   const decision = NetworkRetryAuthority.shouldRetry("filter-list-fetch", attemptCount);
 */

const _retryPolicies = Object.freeze({
    "filter-list-fetch": { maxRetries: 3, baseDelayMs: 5000, jitter: true },
    "asset-fetch": { maxRetries: 2, baseDelayMs: 1000, jitter: true },
    "cache-update": { maxRetries: 1, baseDelayMs: 10000, jitter: false },
    "cloud-sync": { maxRetries: 2, baseDelayMs: 2000, jitter: true },
});

export const NetworkRetryAuthority = Object.freeze({
    /**
     * Determine whether a network operation should be retried.
     * @param {string} operationType
     * @param {number} attemptCount - 0-based
     * @param {{ statusCode?: number, errorType?: string }} [context]
     * @returns {{ retry: boolean, delayMs: number }}
     */
    shouldRetry(operationType, attemptCount, context = {}) {
        const policy = _retryPolicies[operationType];
        if (!policy) return { retry: false, delayMs: 0 };

        if (attemptCount >= policy.maxRetries) return { retry: false, delayMs: 0 };

        let delay = policy.baseDelayMs * Math.pow(2, attemptCount);
        if (policy.jitter) {
            delay += Math.random() * (delay * 0.5);
        }

        return { retry: true, delayMs: Math.round(delay) };
    },

    /**
     * Get the retry policy for an operation type.
     * @param {string} operationType
     * @returns {object|null}
     */
    getPolicy(operationType) {
        return _retryPolicies[operationType] || null;
    },
});
