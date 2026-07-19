/**
 * platform/chromium/js/channel-registry.js
 *
 * Channel registry for BroadcastChannel and inter-frame messaging.
 *
 * Tracks active BroadcastChannel instances, message ports, and
 * inter-frame communication channels so they can be closed on
 * cleanup, policy change, or navigation.
 *
 * Usage:
 *   import { ChannelRegistry } from "./channel-registry.js";
 *   ChannelRegistry.register("my-channel", bc);
 *   ChannelRegistry.closeAll();
 */

const _channels = new Map();

export const ChannelRegistry = Object.freeze({
    /**
     * Register a channel.
     * @param {string} name
     * @param {object} channel - e.g., BroadcastChannel or MessagePort
     * @param {{ owner?: string, tabId?: number }} [info]
     */
    register(name, channel, info = {}) {
        if (_channels.has(name)) {
            try { _channels.get(name).channel.close(); } catch (_) { }
        }
        _channels.set(name, { channel, owner: info.owner || "", tabId: info.tabId || 0, registeredAt: Date.now() });
    },

    /**
     * Close and remove a channel.
     * @param {string} name
     */
    close(name) {
        const entry = _channels.get(name);
        if (entry) {
            try { entry.channel.close(); } catch (_) { }
            _channels.delete(name);
        }
    },

    /**
     * Close all channels for a given owner.
     * @param {string} owner
     */
    closeByOwner(owner) {
        for (const [name, entry] of _channels) {
            if (entry.owner === owner) {
                try { entry.channel.close(); } catch (_) { }
                _channels.delete(name);
            }
        }
    },

    /**
     * Close all channels for a given tab.
     * @param {number} tabId
     */
    closeByTab(tabId) {
        for (const [name, entry] of _channels) {
            if (entry.tabId === tabId) {
                try { entry.channel.close(); } catch (_) { }
                _channels.delete(name);
            }
        }
    },

    /**
     * Close all channels.
     */
    closeAll() {
        for (const [, entry] of _channels) {
            try { entry.channel.close(); } catch (_) { }
        }
        _channels.clear();
    },
});
