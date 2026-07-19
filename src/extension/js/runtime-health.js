/**
 * platform/chromium/js/runtime-health.js
 *
 * Runtime-health schema and transition contract.
 *
 * All runtime health writes go through setHealth() which enforces valid
 * phase transitions, tracks revision, and logs illegal transitions.
 *
 * Usage:
 *   import { runtimeHealth } from "./runtime-health.js";
 *   runtimeHealth.setHealth({ phase: "ready", policyReady: true });
 *   const state = runtimeHealth.getHealth();
 */

const PHASES = Object.freeze(["booting", "ready", "degraded", "recovering", "error"]);
const _VALID_TRANSITIONS = Object.freeze({
    booting: ["ready", "degraded", "error"],
    ready: ["degraded", "recovering", "error"],
    degraded: ["recovering", "error"],
    recovering: ["ready", "error"],
    error: ["recovering"],
});

let _state = {
    phase: "booting",
    policyReady: false,
    dnrReady: false,
    filterListsReady: false,
    instrumentationActive: false,
    activeTasks: [],
    lastErrors: [],
    revision: 0,
};

function _nextRevision() {
    _state.revision += 1;
    return _state.revision;
}

export const runtimeHealth = Object.freeze({
    /**
     * Get a snapshot of current health state.
     * @returns {Readonly<object>}
     */
    getHealth() {
        return Object.freeze({ ..._state });
    },

    /**
     * Update health state. Only the fields provided are changed.
     * Phase transitions are validated; illegal transitions are logged
     * and rejected.
     * @param {Partial<{
     *   phase: string,
     *   policyReady: boolean,
     *   dnrReady: boolean,
     *   filterListsReady: boolean,
     *   instrumentationActive: boolean,
     *   activeTasks: string[],
     *   lastErrors: object[],
     * }>} patch
     * @returns {{ ok: boolean, reason?: string }}
     */
    setHealth(patch) {
        if (patch.phase !== undefined) {
            const allowed = _VALID_TRANSITIONS[_state.phase];
            if (!allowed || !allowed.includes(patch.phase)) {
                return {
                    ok: false,
                    reason: `illegal-transition: ${_state.phase} -> ${patch.phase}`,
                };
            }
            _state.phase = patch.phase;
        }

        if (patch.policyReady !== undefined) _state.policyReady = patch.policyReady;
        if (patch.dnrReady !== undefined) _state.dnrReady = patch.dnrReady;
        if (patch.filterListsReady !== undefined) _state.filterListsReady = patch.filterListsReady;
        if (patch.instrumentationActive !== undefined) _state.instrumentationActive = patch.instrumentationActive;
        if (patch.activeTasks !== undefined) _state.activeTasks = [...patch.activeTasks];
        if (patch.lastErrors !== undefined) _state.lastErrors = [...patch.lastErrors];

        _nextRevision();
        return { ok: true };
    },

    /**
     * Append a runtime error to the health state.
     * @param {object} err
     */
    recordError(err) {
        _state.lastErrors.push(err);
        if (_state.lastErrors.length > 50) _state.lastErrors.shift();
        _nextRevision();
    },

    reset() {
        _state = {
            phase: "booting",
            policyReady: false,
            dnrReady: false,
            filterListsReady: false,
            instrumentationActive: false,
            activeTasks: [],
            lastErrors: [],
            revision: 0,
        };
    },
});
