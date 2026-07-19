/**
 * platform/chromium/js/document-runtime-sentinel.js
 *
 * Per-document runtime injection sentinel.
 *
 * Every content/runtime layer must acquire a document runtime slot
 * before starting.  Duplicate acquire with the same key returns
 * already-active.  Policy revision change invalidates mutation
 * layers but may keep passive bootstrap.
 *
 * About:blank/srcdoc frames use inherited effective URL in the key,
 * not the about:blank/srcdoc URL itself.
 *
 * Usage:
 *   import { DocumentRuntimeSentinel } from "./document-runtime-sentinel.js";
 *   const slot = DocumentRuntimeSentinel.acquire({ tabId, frameId, bundleId: "cosmetic", layerId: "generic" });
 *   if (!slot.acquired) { return; }  // already active
 *   // ... start layer ...
 *   slot.release();
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _slots = new Map();  // key → { tabId, frameId, documentId, policyRevision, bundleId, layerId, acquiredAt }

function _makeKey(tabId, frameId, documentId, bundleId, layerId) {
    return `${tabId}:${frameId}:${documentId || ""}:${bundleId}:${layerId}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const DocumentRuntimeSentinel = {
    /**
     * Acquire a runtime slot for a document layer.
     *
     * @param {object} opts
     * @param {number} opts.tabId
     * @param {number} opts.frameId
     * @param {string} [opts.documentId]
     * @param {string} opts.effectiveUrl - effective URL (inherited for about:blank)
     * @param {number} [opts.policyRevision]
     * @param {string} opts.bundleId - e.g. "cosmetic", "scriptlets", "video"
     * @param {string} opts.layerId - e.g. "generic", "specific", "adapter"
     * @returns {{ acquired: boolean, reason?: string, release: () => void }}
     */
    acquire(opts) {
        const {
            tabId,
            frameId,
            documentId,
            policyRevision,
            bundleId,
            layerId,
        } = opts;

        const key = _makeKey(tabId, frameId, documentId, bundleId, layerId);
        const existing = _slots.get(key);

        if (existing) {
            // Check if policy revision changed
            if (policyRevision !== undefined && existing.policyRevision !== policyRevision) {
                // Stale slot — replace it
                existing._stale = true;
                // Fall through to create new slot
            } else {
                return {
                    acquired: false,
                    reason: "already-active",
                    release: () => {},
                };
            }
        }

        const slot = {
            tabId,
            frameId,
            documentId,
            policyRevision,
            bundleId,
            layerId,
            acquiredAt: Date.now(),
            _released: false,
            _stale: false,
        };

        _slots.set(key, slot);

        return {
            acquired: true,
            reason: null,
            release: () => {
                if (slot._released) return;
                slot._released = true;
                const current = _slots.get(key);
                if (current === slot) {
                    _slots.delete(key);
                }
            },
        };
    },

    /**
     * Check whether a layer is currently active for a document.
     */
    isActive(tabId, frameId, documentId, bundleId, layerId) {
        const key = _makeKey(tabId, frameId, documentId, bundleId, layerId);
        const slot = _slots.get(key);
        return slot !== undefined && !slot._released && !slot._stale;
    },

    /**
     * Invalidate all slots for a specific tab (e.g. on tab close).
     */
    invalidateTab(tabId) {
        const toRemove = [];
        for (const [key, slot] of _slots) {
            if (slot.tabId === tabId) {
                toRemove.push(key);
            }
        }
        for (const key of toRemove) {
            _slots.delete(key);
        }
    },

    /**
     * Invalidate all slots with a stale policy revision.
     * Called when policy revision bumps.
     */
    invalidateByPolicyRevision(oldRevision) {
        const toRemove = [];
        for (const [key, slot] of _slots) {
            if (slot.policyRevision === oldRevision) {
                toRemove.push(key);
            }
        }
        for (const key of toRemove) {
            _slots.delete(key);
        }
    },

    /**
     * Invalidate all slots.
     */
    invalidateAll() {
        _slots.clear();
    },

    /**
     * Return diagnostic snapshot.
     */
    getSnapshot() {
        const slots = [];
        for (const [key, slot] of _slots) {
            slots.push({
                key,
                tabId: slot.tabId,
                frameId: slot.frameId,
                documentId: slot.documentId,
                policyRevision: slot.policyRevision,
                bundleId: slot.bundleId,
                layerId: slot.layerId,
                acquiredAt: slot.acquiredAt,
                released: slot._released,
                stale: slot._stale,
            });
        }
        return {
            activeCount: slots.length,
            slots,
        };
    },
};
