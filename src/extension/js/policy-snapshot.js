/**
 * platform/chromium/js/policy-snapshot.js
 *
 * Policy snapshot with revision tracking.
 *
 * Every capability token issued to a content script or runtime layer
 * carries a policy revision, document identity, and expiry.  When the
 * policy revision bumps (due to a profile change, setting toggle, or
 * filter list update), all tokens derived from the stale revision are
 * invalidated and their layers must re-request policy.
 *
 * Usage:
 *   import { PolicySnapshot } from "./policy-snapshot.js";
 *   const snap = PolicySnapshot.create(tabId, frameId, documentId, url, policy);
 *   const token = snap.issueToken("cosmetic");
 *   const valid = token.isValid();   // false after revision bumps
 *   PolicySnapshot.invalidateAll({ reason: "policy-change" });
 */

// ---------------------------------------------------------------------------
// Global revision counter
// ---------------------------------------------------------------------------

let _globalRevision = 0;

function _nextRevision() {
    return ++_globalRevision;
}

// ---------------------------------------------------------------------------
// Token TTL
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 60000;  // 1 minute default

// ---------------------------------------------------------------------------
// Snapshot storage
// ---------------------------------------------------------------------------

const _snapshots = new Map();  // key: `${tabId}:${frameId}` → PolicySnapshot

// ---------------------------------------------------------------------------
// PolicySnapshot class
// ---------------------------------------------------------------------------

class _Snapshot {
    constructor(opts) {
        const {
            tabId,
            frameId,
            documentId,
            url,
            profileId,
            policy,
            revision,
        } = opts;

        this.tabId = tabId;
        this.frameId = frameId;
        this.documentId = documentId || null;
        this.url = url;
        this.profileId = profileId;
        this.policy = policy;
        this.revision = revision;
        this.issuedAt = Date.now();
        this.tokens = new Set();   // Set<Token>
    }

    _issueToken(layer, ttl = TOKEN_TTL_MS) {
        const now = Date.now();
        const token = Object.freeze({
            tokenId: crypto.randomUUID(),
            layer,
            tabId: this.tabId,
            frameId: this.frameId,
            documentId: this.documentId,
            revision: this.revision,
            issuedAt: now,
            expiresAt: now + ttl,
            expiresAfter: ttl,
            isValid() {
                const current = _snapshots.get(`${this.tabId}:${this.frameId}`);
                if (current === undefined) return false;
                if (current.revision !== this.revision) return false;
                if (Date.now() > this.expiresAt) return false;
                return true;
            },
        });
        this.tokens.add(token);
        return token;
    }

    _invalidateTokens() {
        this.tokens.clear();
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const PolicySnapshot = {
    /**
     * Create a new snapshot for a tab/frame, associate it with a policy,
     * and return the snapshot.
     *
     * If a snapshot already exists for this tab/frame, the old one is
     * replaced (and its tokens are invalidated).
     */
    create(tabId, frameId, documentId, url, policy) {
        const key = `${tabId}:${frameId}`;
        const existing = _snapshots.get(key);
        if (existing) {
            existing._invalidateTokens();
        }

        const revision = _nextRevision();
        const snap = new _Snapshot({
            tabId,
            frameId,
            documentId,
            url,
            profileId: policy.profileId,
            policy,
            revision,
        });
        _snapshots.set(key, snap);
        return snap;
    },

    /**
     * Retrieve the current snapshot for a tab/frame, or undefined.
     */
    get(tabId, frameId) {
        return _snapshots.get(`${tabId}:${frameId}`);
    },

    /**
     * Issue a capability token for the given layer, derived from the
     * snapshot for (tabId, frameId).  Returns undefined if no snapshot
     * exists.
     */
    issueToken(tabId, frameId, layer, ttl) {
        const snap = _snapshots.get(`${tabId}:${frameId}`);
        if (!snap) return undefined;
        return snap._issueToken(layer, ttl);
    },

    /**
     * Invalidate all snapshots and bump the global revision.
     * Called when policy profiles change, settings toggle, or
     * filter lists update.
     */
    invalidateAll({ reason } = {}) {
        // Collect unique tab IDs before clearing
        const affectedTabIds = new Set();
        for (const snap of _snapshots.values()) {
            snap._invalidateTokens();
            if (snap.tabId != null) affectedTabIds.add(snap.tabId);
        }
        _snapshots.clear();
        _nextRevision();  // bump so future tokens have new revision

        // Notify content scripts in affected tabs to deactivate
        for (const tabId of affectedTabIds) {
            try {
                chrome.tabs.sendMessage(tabId, { what: "ubor:deactivate" }).catch(() => {});
            } catch (_e) {
                // Tab may have been closed; ignore
            }
        }
    },

    /**
     * Invalidate a single snapshot (e.g. on tab close).
     */
    invalidate(tabId, frameId) {
        const key = `${tabId}:${frameId}`;
        const snap = _snapshots.get(key);
        if (snap) {
            snap._invalidateTokens();
            _snapshots.delete(key);
        }
    },

    /**
     * Return the current global revision number.
     */
    getCurrentRevision() {
        return _globalRevision;
    },

    /**
     * Return a diagnostic snapshot of all active snapshots.
     */
    getActiveSnapshotCount() {
        return _snapshots.size;
    },

    /**
     * Look up a token by tokenId across all active snapshots.
     * Returns the token object or undefined.
     */
    getTokenById(tokenId) {
        for (const snap of _snapshots.values()) {
            for (const token of snap.tokens) {
                if (token.tokenId === tokenId) return token;
            }
        }
        return undefined;
    },

    /**
     * Return an iterator over all active snapshots.
     * Each entry is [key, PolicySnapshot].
     */
    entries() {
        return _snapshots.entries();
    },

    /** Default TTL for tokens */
    TOKEN_TTL_MS,
};
