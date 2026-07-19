/**
 * platform/chromium/js/user-intent-token.js
 *
 * High-risk user-intent tokens for dangerous manual actions.
 *
 * Some operations (restore backup, import remote lists, clear all rules,
 * trust user filters, launch zapper) are safe only when clearly initiated
 * by the user from a trusted extension page or browser UI.  Message sender
 * checks are necessary but not sufficient.
 *
 * A UserIntentToken is issued by trusted UI (popup, dashboard, context menu,
 * command) and must be presented for high-risk actions.  Tokens are
 * short-lived and optionally single-use.
 *
 * Usage:
 *   import { UserIntentToken } from "./user-intent-token.js";
 *   const token = UserIntentToken.issue("restore-backup", { tabId: 42 });
 *   // ... pass token to service worker ...
 *   const ok = UserIntentToken.consume(token);
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _issued = new Map();  // tokenId → UserIntentTokenData
let _counter = 0;

// ---------------------------------------------------------------------------
// Token data shape
// ---------------------------------------------------------------------------

class UserIntentTokenData {
    constructor(action, opts) {
        this.id = ++_counter;
        this.action = action;
        this.issuedFrom = opts.issuedFrom || "popup";
        this.tabId = opts.tabId;
        this.documentId = opts.documentId;
        this.issuedAt = Date.now();
        this.expiresAt = Date.now() + (opts.ttlMs || 30_000);  // default 30s TTL
        this.oneTimeUse = opts.oneTimeUse !== false;
        this._consumed = false;
    }

    get isValid() {
        return !this._consumed && Date.now() < this.expiresAt;
    }

    consume() {
        if (this._consumed) return false;
        if (Date.now() >= this.expiresAt) return false;
        this._consumed = true;
        return true;
    }
}

// ---------------------------------------------------------------------------
// High-risk action definitions
// ---------------------------------------------------------------------------

const HIGH_RISK_ACTIONS = new Set([
    "restore-backup",
    "import-remote-filter-list",
    "trust-user-filters",
    "enable-advanced-mode",
    "enable-stealth-mode",
    "change-privacy-settings",
    "clear-all-rules",
    "relax-page-filtering",
    "block-page-filtering",
    "launch-element-picker",
    "launch-element-zapper",
    "open-privileged-route",
    "override-policy",
    "reset-extension",
    "export-data",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const UserIntentToken = {
    /**
     * Issue a new user-intent token.
     *
     * @param {string} action - one of HIGH_RISK_ACTIONS
     * @param {object} [opts]
     * @param {string} [opts.issuedFrom="popup"]
     * @param {number} [opts.tabId]
     * @param {string} [opts.documentId]
     * @param {number} [opts.ttlMs=30000]
     * @param {boolean} [opts.oneTimeUse=true]
     * @returns {object} serializable token object
     */
    issue(action, opts = {}) {
        if (!HIGH_RISK_ACTIONS.has(action)) {
            throw new Error(`Unknown high-risk action: "${action}"`);
        }
        const token = new UserIntentTokenData(action, opts);
        _issued.set(token.id, token);
        return {
            id: token.id,
            action: token.action,
            issuedFrom: token.issuedFrom,
            tabId: token.tabId,
            documentId: token.documentId,
            issuedAt: token.issuedAt,
            expiresAt: token.expiresAt,
            oneTimeUse: token.oneTimeUse,
        };
    },

    /**
     * Consume a token.  Returns true if the token is valid and was
     * successfully consumed (or is reusable and still within TTL).
     */
    consume(tokenData) {
        if (!tokenData || !tokenData.id) return false;
        const token = _issued.get(tokenData.id);
        if (!token) return false;

        if (!token.isValid) {
            _issued.delete(token.id);
            return false;
        }

        if (token.oneTimeUse) {
            if (!token.consume()) {
                _issued.delete(token.id);
                return false;
            }
            _issued.delete(token.id);  // clean up after consume
        }

        return true;
    },

    /**
     * Validate a token without consuming it.
     */
    validate(tokenData) {
        if (!tokenData || !tokenData.id) return false;
        const token = _issued.get(tokenData.id);
        return token ? token.isValid : false;
    },

    /**
     * Revoke all tokens for a given action (e.g. on policy change).
     */
    revokeAction(action) {
        for (const [id, token] of _issued) {
            if (token.action === action) {
                _issued.delete(id);
            }
        }
    },

    /**
     * Revoke all tokens.
     */
    revokeAll() {
        _issued.clear();
    },

    /**
     * Check whether an action is classified as high-risk.
     */
    isHighRisk(action) {
        return HIGH_RISK_ACTIONS.has(action);
    },

    /**
     * Return diagnostic snapshot.
     */
    getSnapshot() {
        const tokens = [];
        for (const [, token] of _issued) {
            tokens.push({
                id: token.id,
                action: token.action,
                issuedFrom: token.issuedFrom,
                age: Date.now() - token.issuedAt,
                expiresIn: token.expiresAt - Date.now(),
                oneTimeUse: token.oneTimeUse,
                consumed: token._consumed,
            });
        }
        return tokens;
    },
};
