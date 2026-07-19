/**
 * platform/chromium/js/action-trace.js
 *
 * Action trace for debugging policy and DNR decisions.
 *
 * Records a trace of every policy-resolver call, DNR decision, and
 * logger attribution with enough context to replay or explain the
 * decision chain. Traces are bounded in size and support export.
 *
 * Usage:
 *   import { ActionTrace } from "./action-trace.js";
 *   const traceId = ActionTrace.begin("resolvePagePolicy", { tabId: 5 });
 *   ActionTrace.addStep(traceId, "profile-match", profile);
 *   ActionTrace.end(traceId, policy);
 */

let _nextTraceId = 1;
const _traces = new Map();

export const ActionTrace = Object.freeze({
    /**
     * Begin a new action trace.
     * @param {string} action
     * @param {object} [context]
     * @returns {number} trace ID
     */
    begin(action, context = {}) {
        const id = _nextTraceId++;
        _traces.set(id, {
            id,
            action,
            context: JSON.parse(JSON.stringify(context)),
            steps: [],
            startTime: Date.now(),
            endTime: 0,
        });
        if (_traces.size > 200) {
            const first = _traces.keys().next().value;
            _traces.delete(first);
        }
        return id;
    },

    /**
     * Add a step to an existing trace.
     * @param {number} traceId
     * @param {string} name
     * @param {*} [data]
     */
    addStep(traceId, name, data) {
        const trace = _traces.get(traceId);
        if (!trace) return;
        trace.steps.push({
            name,
            data: data !== undefined ? JSON.parse(JSON.stringify(data)) : undefined,
            timestamp: Date.now(),
        });
    },

    /**
     * End a trace with its final result.
     * @param {number} traceId
     * @param {*} [result]
     */
    end(traceId, result) {
        const trace = _traces.get(traceId);
        if (!trace) return;
        trace.endTime = Date.now();
        trace.result = result !== undefined ? JSON.parse(JSON.stringify(result)) : undefined;
    },

    /**
     * Get a completed trace.
     * @param {number} traceId
     * @returns {object|null}
     */
    get(traceId) {
        return _traces.get(traceId) || null;
    },

    /**
     * Get all traces for a given action.
     * @param {string} action
     * @returns {object[]}
     */
    forAction(action) {
        return [..._traces.values()].filter(t => t.action === action);
    },

    /**
     * Export all traces for diagnostics.
     * @returns {object[]}
     */
    export() {
        return [..._traces.values()];
    },

    clear() {
        _traces.clear();
    },
});
