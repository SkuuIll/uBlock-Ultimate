/**
 * platform/chromium/js/webrequest-instrumentation.js
 *
 * Centralized lifecycle for webRequest instrumentation listeners.
 *
 * The webRequest API is an ambient listener — listeners are registered
 * at extension load and cannot be removed by a content script or popup.
 * This module controls whether the callbacks are operational (active) or
 * short-circuited (inactive) based on instrumentation capability tokens.
 *
 * Design:
 *   - Listeners are added exactly once (at module init time).
 *   - When instrumentation is inactive, callbacks return immediately
 *     without any side effect (no log writes, no attribution).
 *   - The popup and logger get/setActiveInstrumentation() to indicate
 *     whether they want to observe webRequest data.
 *   - Multiple consumers can activate instrumentation; it stays active
 *     until the last consumer deactivates (reference-counted).
 *
 * Usage:
 *   import { webRequestInstrumentation } from "./webrequest-instrumentation.js";
 *   await webRequestInstrumentation.initialize();
 *   webRequestInstrumentation.activate("popup");
 *   webRequestInstrumentation.deactivate("popup");
 *   const active = webRequestInstrumentation.isActive();
 *   const snapshot = webRequestInstrumentation.getSnapshot();
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const state = {
    initialized: false,
    activeConsumers: new Set(),          // Set<consumerId: string>
    listenerRegistration: {
        onBeforeRequest: null,
        onBeforeSendHeaders: null,
        onHeadersReceived: null,
        onCompleted: null,
        onErrorOccurred: null,
    },
};

// ---------------------------------------------------------------------------
// Listener callbacks — these are no-ops unless instrumentation is active.
// When active they collect data and forward to registered observers.
// ---------------------------------------------------------------------------

const _observers = new Set();  // Set<function>

function _shouldHandle() {
    return state.activeConsumers.size > 0;
}

function _onBeforeRequest(details) {
    if (!_shouldHandle()) return;
    for (const observer of _observers) {
        try { observer("onBeforeRequest", details); } catch (_) { /* swallow */ }
    }
}

function _onBeforeSendHeaders(details) {
    if (!_shouldHandle()) return;
    for (const observer of _observers) {
        try { observer("onBeforeSendHeaders", details); } catch (_) { /* swallow */ }
    }
}

function _onHeadersReceived(details) {
    if (!_shouldHandle()) return;
    for (const observer of _observers) {
        try { observer("onHeadersReceived", details); } catch (_) { /* swallow */ }
    }
}

function _onCompleted(details) {
    if (!_shouldHandle()) return;
    for (const observer of _observers) {
        try { observer("onCompleted", details); } catch (_) { /* swallow */ }
    }
}

function _onErrorOccurred(details) {
    if (!_shouldHandle()) return;
    for (const observer of _observers) {
        try { observer("onErrorOccurred", details); } catch (_) { /* swallow */ }
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const webRequestInstrumentation = {
    /**
     * Register webRequest listeners once.  Safe to call multiple times
     * (subsequent calls are no-ops).
     */
    async initialize() {
        if (state.initialized) return;
        state.initialized = true;

        // In MV3 the webRequest API is available only when the
        // "webRequest" permission is declared and the listener
        // is added from a service worker context.
        if (typeof chrome === "undefined" || !chrome.webRequest) {
            // WebRequest API not available — all operations are no-ops.
            return;
        }

        state.listenerRegistration.onBeforeRequest =
            chrome.webRequest.onBeforeRequest.addListener(
                _onBeforeRequest,
                { urls: ["<all_urls>"] },
                []
            );

        state.listenerRegistration.onBeforeSendHeaders =
            chrome.webRequest.onBeforeSendHeaders.addListener(
                _onBeforeSendHeaders,
                { urls: ["<all_urls>"] },
                ["requestHeaders"]
            );

        state.listenerRegistration.onHeadersReceived =
            chrome.webRequest.onHeadersReceived.addListener(
                _onHeadersReceived,
                { urls: ["<all_urls>"] },
                ["responseHeaders"]
            );

        state.listenerRegistration.onCompleted =
            chrome.webRequest.onCompleted.addListener(
                _onCompleted,
                { urls: ["<all_urls>"] },
                ["responseHeaders"]
            );

        state.listenerRegistration.onErrorOccurred =
            chrome.webRequest.onErrorOccurred.addListener(
                _onErrorOccurred,
                { urls: ["<all_urls>"] }
            );
    },

    /**
     * Activate instrumentation for a specific consumer (e.g. "popup", "logger").
     * Reference-counted: stays active until the last consumer deactivates.
     */
    activate(consumerId) {
        if (!consumerId || typeof consumerId !== "string") return;
        state.activeConsumers.add(consumerId);
    },

    /**
     * Deactivate instrumentation for a consumer.  When the last consumer
     * deactivates, callbacks become no-ops.
     */
    deactivate(consumerId) {
        if (!consumerId || typeof consumerId !== "string") return;
        state.activeConsumers.delete(consumerId);
    },

    /**
     * True when at least one consumer has active instrumentation.
     */
    isActive() {
        return state.activeConsumers.size > 0;
    },

    /**
     * Register an observer callback that receives (eventName, details)
     * for every webRequest event when instrumentation is active.
     * Returns an unregister function.
     */
    addObserver(fn) {
        _observers.add(fn);
        return () => { _observers.delete(fn); };
    },

    /**
     * Remove a previously registered observer.
     */
    removeObserver(fn) {
        _observers.delete(fn);
    },

    /**
     * Get a snapshot of current instrumentation state.
     */
    getSnapshot() {
        return {
            initialized: state.initialized,
            active: state.activeConsumers.size > 0,
            activeConsumerCount: state.activeConsumers.size,
            activeConsumers: [...state.activeConsumers],
            observerCount: _observers.size,
        };
    },

    /**
     * Return the Set of active consumer IDs.
     */
    getActiveConsumers() {
        return new Set(state.activeConsumers);
    },
};
