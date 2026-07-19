/**
 * platform/chromium/js/dom-marker-authority.js
 *
 * DOM marker authority for element picker/zapper markers.
 *
 * Controls the injection and removal of DOM markers (highlighted
 * elements in picker mode, zapper targets, inspected elements).
 * Markers are tracked per tab/frame and removed on navigation,
 * policy change, or explicit cleanup.
 *
 * Usage:
 *   import { DomMarkerAuthority } from "./dom-marker-authority.js";
 *   DomMarkerAuthority.inject(tabId, frameId, markerId);
 *   DomMarkerAuthority.removeAll(tabId);
 */

const _markers = new Map();

function _key(tabId, frameId) {
    return `${tabId}:${frameId}`;
}

export const DomMarkerAuthority = Object.freeze({
    /**
     * Record a DOM marker injection.
     * @param {number} tabId
     * @param {number} frameId
     * @param {string} markerId
     * @param {{ type?: string }} [info]
     */
    inject(tabId, frameId, markerId, info = {}) {
        const k = _key(tabId, frameId);
        if (!_markers.has(k)) _markers.set(k, []);
        _markers.get(k).push({ markerId, type: info.type || "picker", injectedAt: Date.now() });
    },

    /**
     * Remove markers for a specific frame.
     * @param {number} tabId
     * @param {number} frameId
     * @returns {string[]}
     */
    remove(tabId, frameId) {
        const k = _key(tabId, frameId);
        const entries = _markers.get(k) || [];
        _markers.delete(k);
        return entries.map(e => e.markerId);
    },

    /**
     * Remove all markers for a tab.
     * @param {number} tabId
     */
    removeAll(tabId) {
        for (const [key] of _markers) {
            if (key.startsWith(`${tabId}:`)) _markers.delete(key);
        }
    },

    /**
     * Check if a frame has active markers.
     * @param {number} tabId
     * @param {number} frameId
     * @returns {boolean}
     */
    has(tabId, frameId) {
        const entries = _markers.get(_key(tabId, frameId));
        return entries ? entries.length > 0 : false;
    },
});
