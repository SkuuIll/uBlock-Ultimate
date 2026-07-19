/**
 * platform/chromium/js/document-lifecycle.js
 *
 * Document lifecycle tracker.
 *
 * Tracks the lifecycle state of every active document in every tab.
 * States include: created, loading, active, bfcache, discarded, closed.
 * Policy and capability decisions depend on knowing whether a document
 * is newly created, restored from BFCache, or stale.
 *
 * Usage:
 *   import { DocumentLifecycle } from "./document-lifecycle.js";
 *   DocumentLifecycle.created(tabId, frameId, documentId);
 *   DocumentLifecycle.activated(tabId, frameId, documentId);
 *   const state = DocumentLifecycle.get(tabId, frameId);
 */

const _documents = new Map();

function _key(tabId, frameId) {
    return `${tabId}:${frameId}`;
}

export const DocumentLifecycle = Object.freeze({
    /**
     * Record a document as created.
     * @param {number} tabId
     * @param {number} frameId
     * @param {string} documentId
     * @param {object} [info]
     */
    created(tabId, frameId, documentId, info = {}) {
        _documents.set(_key(tabId, frameId), {
            tabId,
            frameId,
            documentId,
            state: "created",
            url: info.url || "",
            created: Date.now(),
            activated: 0,
        });
    },

    /**
     * Record a document as activated (navigation complete).
     * @param {number} tabId
     * @param {number} frameId
     * @param {string} documentId
     */
    activated(tabId, frameId, documentId) {
        const doc = _documents.get(_key(tabId, frameId));
        if (doc && doc.documentId === documentId) {
            doc.state = "active";
            doc.activated = Date.now();
        }
    },

    /**
     * Record a document entering BFCache.
     * @param {number} tabId
     * @param {number} frameId
     */
    bfcache(tabId, frameId) {
        const doc = _documents.get(_key(tabId, frameId));
        if (doc) doc.state = "bfcache";
    },

    /**
     * Record a document being discarded or closed.
     * @param {number} tabId
     * @param {number} [frameId]
     */
    closed(tabId, frameId) {
        if (frameId !== undefined) {
            const doc = _documents.get(_key(tabId, frameId));
            if (doc) doc.state = "closed";
        } else {
            for (const [key, doc] of _documents) {
                if (doc.tabId === tabId) doc.state = "closed";
            }
        }
    },

    /**
     * Get document state.
     * @param {number} tabId
     * @param {number} frameId
     * @returns {object|null}
     */
    get(tabId, frameId) {
        return _documents.get(_key(tabId, frameId)) || null;
    },

    /**
     * Get all active documents for a tab.
     * @param {number} tabId
     * @returns {object[]}
     */
    forTab(tabId) {
        return [..._documents.values()].filter(d => d.tabId === tabId && d.state !== "closed");
    },

    /**
     * Clean up closed/stale entries.
     */
    reap() {
        const cutoff = Date.now() - 600000;
        for (const [key, doc] of _documents) {
            if (doc.state === "closed" && doc.created < cutoff) _documents.delete(key);
        }
    },
});
