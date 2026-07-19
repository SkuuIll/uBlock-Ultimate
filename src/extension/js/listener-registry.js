/**
 * platform/chromium/js/listener-registry.js
 *
 * Listener registry for browser and extension events.
 *
 * Every top-level addListener call should be declared in this registry,
 * ensuring no listener is registered twice and that every removable
 * listener has a teardown path.
 *
 * Usage:
 *   import { listenerRegistry } from "./listener-registry.js";
 *   listenerRegistry.register({
 *     id: "context-menu-click",
 *     owner: "context-menu",
 *     eventName: "contextMenus.onClicked",
 *     add: (handler) => chrome.contextMenus.onClicked.addListener(handler),
 *     remove: (handler) => chrome.contextMenus.onClicked.removeListener(handler),
 *   });
 *   listenerRegistry.ensure("context-menu-click", handler);
 *   listenerRegistry.removeAllByOwner("context-menu");
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _registry = new Map();  // id → ListenerRegistration
const _activeListeners = new Map();  // id → { handler, added}

class ListenerRegistration {
    constructor(config) {
        this.id = config.id;
        this.owner = config.owner || "unknown";
        this.eventName = config.eventName;
        this.phase = config.phase || "startup";
        this.add = config.add;
        this.remove = config.remove;
        this.isRegistered = config.isRegistered;
        this._handler = null;
        this._added = false;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const listenerRegistry = {
    /**
     * Register a listener description.
     * Does NOT add the listener — use ensure() for that.
     */
    register(config) {
        if (_registry.has(config.id)) {
            throw new Error(`Listener "${config.id}" is already registered`);
        }
        _registry.set(config.id, new ListenerRegistration(config));
    },

    /**
     * Ensure a listener is added exactly once.
     * If the listener was already added, this is a no-op.
     */
    ensure(id, handler) {
        const reg = _registry.get(id);
        if (!reg) {
            throw new Error(`Unknown listener: "${id}"`);
        }
        if (reg._added) return;  // already added

        reg._handler = handler;
        reg.add(handler);
        reg._added = true;
    },

    /**
     * Remove a specific listener.
     */
    remove(id) {
        const reg = _registry.get(id);
        if (!reg || !reg._added) return;

        if (reg.remove && reg._handler) {
            reg.remove(reg._handler);
        }
        reg._added = false;
        reg._handler = null;
    },

    /**
     * Remove all listeners owned by a specific owner.
     */
    removeAllByOwner(owner) {
        for (const [id, reg] of _registry) {
            if (reg.owner === owner) {
                listenerRegistry.remove(id);
            }
        }
    },

    /**
     * Remove all listeners for a specific phase.
     */
    removeAllByPhase(phase) {
        for (const [id, reg] of _registry) {
            if (reg.phase === phase) {
                listenerRegistry.remove(id);
            }
        }
    },

    /**
     * Check whether a listener is currently added.
     */
    isAdded(id) {
        const reg = _registry.get(id);
        return reg ? reg._added : false;
    },

    /**
     * Remove all listeners.
     */
    removeAll() {
        for (const [id] of _registry) {
            listenerRegistry.remove(id);
        }
    },

    /**
     * Return diagnostic snapshot.
     */
    getSnapshot() {
        const listeners = [];
        for (const [id, reg] of _registry) {
            listeners.push({
                id: reg.id,
                owner: reg.owner,
                eventName: reg.eventName,
                phase: reg.phase,
                added: reg._added,
                hasRemove: !!reg.remove,
            });
        }
        return listeners;
    },
};
