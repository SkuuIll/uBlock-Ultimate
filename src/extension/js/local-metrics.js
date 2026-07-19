/**
 * platform/chromium/js/local-metrics.js
 *
 * Local metrics collector for performance and diagnostic counters.
 *
 * Collects runtime metrics (rule count, memory estimates, API call
 * counts, error rates, cache hit ratios) for diagnostic export and
 * health monitoring. Metrics are bounded in size and periodically
 * pruned based on privacy retention policy.
 *
 * Usage:
 *   import { LocalMetrics } from "./local-metrics.js";
 *   LocalMetrics.increment("dnr.decision.count");
 *   const snapshot = LocalMetrics.getSnapshot();
 */

const _counters = new Map();
const _gauges = new Map();

export const LocalMetrics = Object.freeze({
    /**
     * Increment a counter metric.
     * @param {string} name
     * @param {number} [by=1]
     */
    increment(name, by = 1) {
        _counters.set(name, (_counters.get(name) || 0) + by);
    },

    /**
     * Set a gauge metric.
     * @param {string} name
     * @param {number} value
     */
    gauge(name, value) {
        _gauges.set(name, value);
    },

    /**
     * Get a snapshot of all metrics.
     * @returns {{ counters: object, gauges: object }}
     */
    getSnapshot() {
        const counters = {};
        for (const [key, value] of _counters) counters[key] = value;
        const gauges = {};
        for (const [key, value] of _gauges) gauges[key] = value;
        return { counters, gauges };
    },

    /**
     * Reset all metrics.
     */
    reset() {
        _counters.clear();
        _gauges.clear();
    },
});
