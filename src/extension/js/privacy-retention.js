/**
 * platform/chromium/js/privacy-retention.js
 *
 * Privacy retention policy for diagnostic and log data.
 *
 * Defines retention limits for different data classes based on privacy
 * sensitivity and profile mode. Automatically prunes expired entries
 * from diagnostic bundles, error logs, action traces, and mutation
 * journals.
 *
 * Usage:
 *   import { PrivacyRetention } from "./privacy-retention.js";
 *   const ttl = PrivacyRetention.getRetentionMs("diagnostic", "normal");
 *   if (entry.timestamp < Date.now() - ttl) { /* prune *\/ }
 */

const _retentionByClass = Object.freeze({
    diagnostic: { normal: 7 * 86400000, incognito: 3600000, private: 3600000 },
    error: { normal: 30 * 86400000, incognito: 86400000, private: 86400000 },
    trace: { normal: 86400000, incognito: 600000, private: 600000 },
    journal: { normal: 7 * 86400000, incognito: 3600000, private: 3600000 },
});

export const PrivacyRetention = Object.freeze({
    /**
     * Get retention period in milliseconds for a data class and mode.
     * @param {"diagnostic"|"error"|"trace"|"journal"} dataClass
     * @param {"normal"|"incognito"|"private"} mode
     * @returns {number}
     */
    getRetentionMs(dataClass, mode) {
        const policies = _retentionByClass[dataClass];
        if (!policies) return 86400000;
        return policies[mode] || policies.normal;
    },

    /**
     * Check whether a timestamp has expired under the retention policy.
     * @param {number} timestamp
     * @param {"diagnostic"|"error"|"trace"|"journal"} dataClass
     * @param {"normal"|"incognito"|"private"} mode
     * @returns {boolean}
     */
    isExpired(timestamp, dataClass, mode) {
        const ttl = this.getRetentionMs(dataClass, mode);
        return Date.now() - timestamp > ttl;
    },
});
