/**
 * platform/chromium/js/startup-hydration-gate.js
 *
 * Cold-start hydration barrier and startup event queue.
 *
 * During service-worker cold start, the runtime is not ready to handle
 * mutation-capable messages until critical components are hydrated.
 * This module provides:
 *   - A hydration state tracker for each startup component.
 *   - An event queue that holds incoming messages until their required
 *     components are hydrated (or the event expires).
 *   - Sensitivity levels so safe-read events can pass through immediately.
 *
 * Usage:
 *   import { HydrationGate } from "./startup-hydration-gate.js";
 *   HydrationGate.beginHydration("service-worker-startup");
 *   HydrationGate.markHydrated("policy-profiles");
 *   // In message handler:
 *   const ok = HydrationGate.checkEvent({ eventType, sensitivity });
 *   if (!ok) { return { ok: false, error: "runtime-not-ready", retryable: true }; }
 */

// ---------------------------------------------------------------------------
// Sensitivity levels (ascending — higher = more restrictive)
// ---------------------------------------------------------------------------

const SENSITIVITY = Object.freeze({
    SAFE_READ: 0,           // no hydration required; pass through
    DIAGNOSTIC_READ: 1,     // may run once any component hydrated
    MUTATION_LOW: 2,        // requires critical + policy
    MUTATION_HIGH: 3,       // requires critical + policy + network
    NETWORK_MUTATION: 4,    // requires everything
    UI_MUTATION: 5,         // requires everything + UI
});

// ---------------------------------------------------------------------------
// Component phases
// ---------------------------------------------------------------------------

const PHASES = Object.freeze({
    CRITICAL: "critical",       // storage, i18n, manifest
    POLICY: "policy",           // policy profiles, browser capabilities
    NETWORK: "network",         // DNR, filter lists, asset authority
    UI: "ui",                   // popup, dashboard
    DIAGNOSTIC: "diagnostic",   // logger, dev tools
});

// Hydration priority: components in earlier phases must hydrate first.
const _PHASE_ORDER = [
    PHASES.CRITICAL,
    PHASES.POLICY,
    PHASES.NETWORK,
    PHASES.UI,
    PHASES.DIAGNOSTIC,
];

// ---------------------------------------------------------------------------
// Required components per sensitivity level
// ---------------------------------------------------------------------------

const _REQUIREMENTS = Object.freeze({
    [SENSITIVITY.SAFE_READ]: [],
    [SENSITIVITY.DIAGNOSTIC_READ]: [],
    [SENSITIVITY.MUTATION_LOW]: [PHASES.CRITICAL, PHASES.POLICY],
    [SENSITIVITY.MUTATION_HIGH]: [PHASES.CRITICAL, PHASES.POLICY, PHASES.NETWORK],
    [SENSITIVITY.NETWORK_MUTATION]: [PHASES.CRITICAL, PHASES.POLICY, PHASES.NETWORK],
    [SENSITIVITY.UI_MUTATION]: [PHASES.CRITICAL, PHASES.POLICY, PHASES.NETWORK, PHASES.UI],
});

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _state = {
    phase: null,                    // current hydration phase
    components: new Map(),          // componentId → { hydrated, metadata, error }
    hydrationStartTime: null,
    hydrationEndTime: null,
    eventQueue: [],                 // queued events during hydration
    maxQueueSize: 200,
    maxQueueAge: 60_000,            // 60s
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _phaseMet(phase) {
    // A phase is "met" if every registered component in that phase
    // is hydrated or failed.
    const idx = _PHASE_ORDER.indexOf(phase);
    if (idx === -1) return false;

    // Check that no earlier phase has unmet components
    for (let i = 0; i <= idx; i++) {
        const p = _PHASE_ORDER[i];
        for (const [, record] of _state.components) {
            if (record.phase === p && !record.hydrated && !record.error) {
                return false;
            }
        }
    }
    return true;
}

function _nextPhase() {
    for (const phase of _PHASE_ORDER) {
        if (!_phaseMet(phase)) {
            return phase;
        }
    }
    return null;  // all phases complete
}

function _getSensitivityLevel(label) {
    for (const [name, level] of Object.entries(SENSITIVITY)) {
        if (name === label || level === label) return level;
    }
    return SENSITIVITY.MUTATION_LOW;  // default fallback
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const HydrationGate = {
    SENSITIVITY,

    /**
     * Begin the hydration process.  Call once at service-worker startup.
     */
    beginHydration(reason) {
        _state.hydrationStartTime = Date.now();
        _state.phase = PHASES.CRITICAL;
    },

    /**
     * Mark a component as hydrated.
     *
     * @param {string} componentId - e.g. "policy-profiles", "dnr-manager"
     * @param {object} [metadata] - optional diagnostic metadata
     */
    markHydrated(componentId, metadata) {
        const record = _state.components.get(componentId) || { phase: PHASES.CRITICAL };
        record.hydrated = true;
        record.metadata = metadata;
        record.error = null;
        _state.components.set(componentId, record);

        // Advance phase if possible
        const next = _nextPhase();
        if (next) {
            _state.phase = next;
        } else {
            _state.phase = null;
            _state.hydrationEndTime = Date.now();
            _drainQueue();
        }
    },

    /**
     * Mark a component as failed to hydrate.
     */
    markHydrationFailed(componentId, error) {
        const record = _state.components.get(componentId) || { phase: PHASES.CRITICAL };
        record.hydrated = false;
        record.error = error;
        _state.components.set(componentId, record);
    },

    /**
     * Register a component without immediately hydrating it.
     * The component can be hydrated later with markHydrated.
     *
     * @param {string} componentId
     * @param {string} phase - one of PHASES values
     */
    registerComponent(componentId, phase) {
        if (!_PHASE_ORDER.includes(phase)) {
            phase = PHASES.CRITICAL;
        }
        if (!_state.components.has(componentId)) {
            _state.components.set(componentId, { phase, hydrated: false, error: null });
        }
    },

    /**
     * Check whether an event can be handled based on its sensitivity
     * level and the current hydration state.
     *
     * Returns { allowed, queued, reason }.
     */
    checkEvent({ eventType, sensitivity = SENSITIVITY.MUTATION_LOW, timeoutMs } = {}) {
        const level = _getSensitivityLevel(sensitivity);

        // SAFE_READ always passes
        if (level === SENSITIVITY.SAFE_READ) {
            return { allowed: true, queued: false };
        }

        // If fully hydrated, all events pass
        if (_state.hydrationEndTime !== null) {
            return { allowed: true, queued: false };
        }

        // Check requirements
        const required = _REQUIREMENTS[level] || [];
        for (const phase of required) {
            if (!_phaseMet(phase)) {
                // Not ready — queue or reject
                const now = Date.now();
                if (timeoutMs && now - _state.hydrationStartTime > timeoutMs) {
                    return { allowed: false, queued: false, reason: "hydration-timeout" };
                }
                _enqueueEvent({ eventType, level, receivedAt: now });
                return { allowed: false, queued: true, reason: "hydration-in-progress" };
            }
        }

        return { allowed: true, queued: false };
    },

    /**
     * Return whether the runtime is fully hydrated.
     */
    isHydrated() {
        return _state.hydrationEndTime !== null;
    },

    /**
     * Return the current hydration phase, or null if fully hydrated.
     */
    getCurrentPhase() {
        return _state.phase;
    },

    /**
     * Return a diagnostic snapshot of hydration state.
     */
    getSnapshot() {
        const components = [];
        for (const [id, record] of _state.components) {
            components.push({
                id,
                phase: record.phase,
                hydrated: record.hydrated,
                hasError: !!record.error,
            });
        }
        return {
            hydrationStartTime: _state.hydrationStartTime,
            hydrationEndTime: _state.hydrationEndTime,
            phase: _state.phase,
            fullyHydrated: _state.hydrationEndTime !== null,
            componentCount: components.length,
            components,
            queuedEventCount: _state.eventQueue.length,
            elapsed: _state.hydrationStartTime
                ? Date.now() - _state.hydrationStartTime
                : 0,
        };
    },
};

// ---------------------------------------------------------------------------
// Internal queue helpers
// ---------------------------------------------------------------------------

function _enqueueEvent(event) {
    if (_state.eventQueue.length >= _state.maxQueueSize) {
        // Drop oldest event
        _state.eventQueue.shift();
    }
    _state.eventQueue.push(event);

    // Purge expired events
    const cutoff = Date.now() - _state.maxQueueAge;
    while (_state.eventQueue.length > 0 && _state.eventQueue[0].receivedAt < cutoff) {
        _state.eventQueue.shift();
    }
}

function _drainQueue() {
    _state.eventQueue = [];
}
