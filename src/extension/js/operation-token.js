/**
 * platform/chromium/js/operation-token.js
 *
 * Stale-operation cancellation tokens for async commits.
 *
 * Long-running operations (e.g., syncFilterListDnrRules, DNR transaction
 * commit) create an OperationToken before any side effect.  If a newer
 * operation for the same capability starts (or the policy revision bumps),
 * the previous token is cancelled and its pending work should not commit.
 *
 * Usage:
 *   import { OperationToken } from "./operation-token.js";
 *   const token = OperationToken.acquire("dnr-sync", { policyRevision });
 *   // ... async work ...
 *   if (token.isCurrent()) {
 *     // commit side effects
 *   } else {
 *     // stale — discard result
 *   }
 *   token.release();
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _tokens = new Map();  // key: `${capability}:${scopeId}` → OperationToken

let _tokenCounter = 0;

// ---------------------------------------------------------------------------
// AbortController polyfill for environments without it (MV3 service worker)
// ---------------------------------------------------------------------------

const _AbortController = typeof AbortController !== "undefined"
    ? AbortController
    : class {
        constructor() {
            this.signal = { aborted: false };
        }
        abort() {
            this.signal.aborted = true;
        }
    };

// ---------------------------------------------------------------------------
// OperationToken class
// ---------------------------------------------------------------------------

class _Token {
    constructor(capability, scopeId, opts) {
        this.id = ++_tokenCounter;
        this.capability = capability;
        this.scopeId = scopeId;
        this.policyRevision = opts.policyRevision;
        this.settingsRevision = opts.settingsRevision;
        this.documentRevision = opts.documentRevision;
        this.startedAt = Date.now();
        this._released = false;
        this._abortController = new _AbortController();
    }

    get aborted() {
        return this._abortController.signal.aborted || this._released;
    }

    get signal() {
        return this._abortController.signal;
    }

    /**
     * True if this token is still the active token for its
     * (capability, scopeId) pair — i.e., no newer token has
     * superseded it.
     */
    isCurrent() {
        if (this._released) return false;
        const active = _tokens.get(`${this.capability}:${this.scopeId}`);
        return active === this;
    }

    /**
     * Release this token.  If it was the active token for its slot,
     * the slot becomes available for a new acquirer.
     */
    release() {
        if (this._released) return;
        this._released = true;
        const key = `${this.capability}:${this.scopeId}`;
        if (_tokens.get(key) === this) {
            _tokens.delete(key);
        }
    }

    /**
     * Abort this token and (if it is the active token) cancel the slot.
     */
    abort() {
        if (this._released) return;
        this._abortController.abort();
        this.release();
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const OperationToken = {
    /**
     * Acquire a token for the given capability and scope.
     *
     * If a previous token exists for the same (capability, scopeId),
     * it is aborted (superseded).
     *
     * @param {string} capability - e.g. "dnr-sync", "dnr-transaction", "policy-load"
     * @param {string} [scopeId="default"] - scopes the token within the capability
     * @param {object} [opts={}]
     * @param {number} [opts.policyRevision]
     * @param {number} [opts.settingsRevision]
     * @param {number} [opts.documentRevision]
     * @returns {OperationToken}
     */
    acquire(capability, scopeId = "default", opts = {}) {
        const key = `${capability}:${scopeId}`;
        const existing = _tokens.get(key);
        if (existing) {
            existing.abort();
        }
        const token = new _Token(capability, scopeId, opts);
        _tokens.set(key, token);
        return token;
    },

    /**
     * Abort all tokens for a given capability (across all scopes).
     * Useful when a capability is being shut down.
     */
    abortCapability(capability) {
        for (const [key, token] of _tokens) {
            const [cap] = key.split(":");
            if (cap === capability) {
                token.abort();
            }
        }
    },

    /**
     * Abort all tokens unconditionally.
     */
    abortAll() {
        for (const token of _tokens.values()) {
            token.abort();
        }
    },

    /**
     * Return the active token for (capability, scopeId), or undefined.
     */
    getActive(capability, scopeId = "default") {
        return _tokens.get(`${capability}:${scopeId}`);
    },

    /**
     * Return diagnostic info about all active tokens.
     */
    getSnapshot() {
        const entries = [];
        for (const [key, token] of _tokens) {
            entries.push({
                key,
                id: token.id,
                capability: token.capability,
                scopeId: token.scopeId,
                startedAt: token.startedAt,
                age: Date.now() - token.startedAt,
                policyRevision: token.policyRevision,
            });
        }
        return entries;
    },
};
