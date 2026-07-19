/**
 * platform/chromium/js/quota-manager.js
 *
 * Quota manager for DNR rule counts and storage limits.
 *
 * Tracks DNR rule consumption per source (static, dynamic, session,
 * user), monitors storage usage, and provides quota checks before
 * install/update operations.
 *
 * Usage:
 *   import { QuotaManager } from "./quota-manager.js";
 *   const ok = QuotaManager.checkDnrQuota("session", 50);
 *   QuotaManager.recordDnrUsage("session", 50);
 */

const DNR_GLOBAL_LIMIT = 30000;
const DNR_SESSION_LIMIT = 5000;
const DNR_STATIC_LIMIT = 30000;

let _dnrUsage = { static: 0, dynamic: 0, session: 0 };
let _storageEstimate = 0;

export const QuotaManager = Object.freeze({
    /**
     * Check whether adding `count` DNR rules of the given type would
     * exceed quota.
     * @param {"static"|"dynamic"|"session"} type
     * @param {number} count
     * @returns {{ ok: boolean, current: number, limit: number, reason?: string }}
     */
    checkDnrQuota(type, count) {
        const current = _dnrUsage[type] || 0;
        const limits = { static: DNR_STATIC_LIMIT, dynamic: DNR_GLOBAL_LIMIT, session: DNR_SESSION_LIMIT };
        const limit = limits[type] || DNR_GLOBAL_LIMIT;

        if (current + count > limit) {
            return { ok: false, current, limit, reason: `dnr-${type}-quota-exceeded` };
        }

        const total = Object.values(_dnrUsage).reduce((a, b) => a + b, 0);
        if (type !== "static" && total + count > DNR_GLOBAL_LIMIT) {
            return { ok: false, current: total, limit: DNR_GLOBAL_LIMIT, reason: "dnr-global-quota-exceeded" };
        }

        return { ok: true, current, limit };
    },

    /**
     * Record DNR rule usage after successful install.
     * @param {"static"|"dynamic"|"session"} type
     * @param {number} count
     */
    recordDnrUsage(type, count) {
        _dnrUsage[type] = (_dnrUsage[type] || 0) + count;
    },

    /**
     * Set DNR usage directly (e.g. after startup sync).
     * @param {{ static: number, dynamic: number, session: number }} usage
     */
    setDnrUsage(usage) {
        _dnrUsage = { ..._dnrUsage, ...usage };
    },

    /**
     * Get current DNR usage snapshot.
     * @returns {{ static: number, dynamic: number, session: number, total: number }}
     */
    getDnrUsage() {
        return {
            ..._dnrUsage,
            total: Object.values(_dnrUsage).reduce((a, b) => a + b, 0),
        };
    },
});
