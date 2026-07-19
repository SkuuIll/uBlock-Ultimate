/**
 * platform/chromium/js/runtime-events.js
 *
 * Runtime event bus for service-worker lifecycle events.
 *
 * Provides a typed event bus that carries startup, shutdown, policy
 * change, health transition, and permission change events. Observers
 * subscribe to specific event types.
 *
 * Usage:
 *   import { RuntimeEvents } from "./runtime-events.js";
 *   RuntimeEvents.on("policy-changed", (event) => { ... });
 *   RuntimeEvents.emit("policy-changed", { revision: 3 });
 */

const _listeners = new Map();

export const RuntimeEvents = Object.freeze({
    /**
     * Subscribe to a runtime event type.
     * @param {string} type
     * @param {(event: object) => void} handler
     * @returns {() => void} unsubscribe function
     */
    on(type, handler) {
        if (!_listeners.has(type)) _listeners.set(type, new Set());
        _listeners.get(type).add(handler);
        return () => { _listeners.get(type)?.delete(handler); };
    },

    /**
     * Emit a runtime event.
     * @param {string} type
     * @param {object} [event]
     */
    emit(type, event = {}) {
        const handlers = _listeners.get(type);
        if (!handlers) return;
        for (const handler of handlers) {
            try { handler({ type, ...event }); } catch (_) { }
        }
    },

    /**
     * Remove all listeners for a type.
     * @param {string} type
     */
    off(type) {
        _listeners.delete(type);
    },

    /**
     * Remove all listeners.
     */
    clear() {
        _listeners.clear();
    },
});
