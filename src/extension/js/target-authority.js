/**
 * platform/chromium/js/target-authority.js
 *
 * Target authority for tab/document/frame mutation requests.
 *
 * Verifies that mutation-capable requests target the correct tab,
 * frame, and document.  Content-script requests can only mutate
 * their own tab/frame/document unless a contract explicitly allows
 * escalation.  Popup/dashboard/logger requests need activeTab,
 * explicit user gesture, or a selected tab from trusted UI.
 *
 * Usage:
 *   import { TargetAuthority } from "./target-authority.js";
 *   const result = TargetAuthority.authorize({
 *     action: "hide-element",
 *     requestedTabId: msg.tabId,
 *     senderTabId: sender.tab?.id,
 *     senderFrameId: sender.frameId,
 *     source: "content-script",
 *   });
 *   if (!result.authorized) { return { error: result.reason }; }
 */

// ---------------------------------------------------------------------------
// Source constants
// ---------------------------------------------------------------------------

const SOURCE = Object.freeze({
    CONTENT_SCRIPT: "content-script",
    POPUP: "popup",
    DASHBOARD: "dashboard",
    LOGGER: "logger",
    CONTEXT_MENU: "context-menu",
    COMMAND: "command",
});

// ---------------------------------------------------------------------------
// Escalation contracts
// ---------------------------------------------------------------------------

// Which (source, action) pairs can target a different tab?
const _escalationContracts = new Map();

/**
 * Define a contract that allows a source to escalate (target a different tab).
 *
 * @param {string} source - SOURCE value
 * @param {string} action - action name
 * @param {object} [opts]
 * @param {boolean} [opts.requiresActiveTab=false]
 * @param {boolean} [opts.requiresUserGesture=false]
 */
export function defineEscalationContract(source, action, opts = {}) {
    const key = `${source}:${action}`;
    _escalationContracts.set(key, {
        source,
        action,
        requiresActiveTab: opts.requiresActiveTab !== false,
        requiresUserGesture: opts.requiresUserGesture === true,
    });
}

// ---------------------------------------------------------------------------
// TargetAuthority API
// ---------------------------------------------------------------------------

export const TargetAuthority = {
    SOURCE,

    /**
     * Authorize a mutation request against a target.
     *
     * @param {object} req
     * @param {string} req.action
     * @param {number} [req.requestedTabId]
     * @param {number} [req.requestedFrameId]
     * @param {string} [req.requestedDocumentId]
     * @param {string} [req.requestedUrl]
     * @param {number} [req.senderTabId]
     * @param {number} [req.senderFrameId]
     * @param {string} [req.senderDocumentId]
     * @param {string} [req.senderOrigin]
     * @param {string} req.source
     * @param {boolean} [req.hasActiveTab]
     * @param {boolean} [req.hasUserGesture]
     * @returns {{ authorized: boolean, reason?: string, downgradeToObserve?: boolean }}
     */
    authorize(req) {
        const {
            action,
            requestedTabId,
            requestedFrameId,
            requestedDocumentId,
            senderTabId,
            senderFrameId,
            senderDocumentId,
            source,
            hasActiveTab,
            hasUserGesture,
        } = req;

        // Content script: can only mutate own tab/frame
        if (source === SOURCE.CONTENT_SCRIPT) {
            const key = `${source}:${action}`;
            const contract = _escalationContracts.get(key);

            if (contract) {
                // Has escalation contract — check requirements
                if (contract.requiresActiveTab && !hasActiveTab) {
                    return {
                        authorized: false,
                        reason: "Escalation requires activeTab permission",
                    };
                }
                if (contract.requiresUserGesture && !hasUserGesture) {
                    return {
                        authorized: false,
                        reason: "Escalation requires user gesture",
                    };
                }
                return { authorized: true };
            }

            // Default: own tab/frame only
            if (senderTabId !== undefined && requestedTabId !== undefined
                && senderTabId !== requestedTabId) {
                return {
                    authorized: false,
                    reason: "Content script cannot target a different tab",
                };
            }

            if (senderFrameId !== undefined && requestedFrameId !== undefined
                && senderFrameId !== requestedFrameId) {
                return {
                    authorized: false,
                    reason: "Content script cannot target a different frame",
                    downgradeToObserve: true,
                };
            }

            return { authorized: true };
        }

        // Extension UI (popup, dashboard, logger)
        if (source === SOURCE.POPUP || source === SOURCE.DASHBOARD || source === SOURCE.LOGGER) {
            if (!requestedTabId) {
                return {
                    authorized: false,
                    reason: "No target tab specified",
                };
            }

            if (!hasActiveTab && source === SOURCE.POPUP) {
                return {
                    authorized: false,
                    reason: "Popup requires activeTab or user gesture to target tabs",
                };
            }

            return { authorized: true };
        }

        // Context menu and commands: always authorized (browser-vetted)
        if (source === SOURCE.CONTEXT_MENU || source === SOURCE.COMMAND) {
            if (!requestedTabId) {
                return {
                    authorized: false,
                    reason: "No target tab specified",
                };
            }
            return { authorized: true };
        }

        return {
            authorized: false,
            reason: `Unknown source: "${source}"`,
        };
    },

    /**
     * Check whether a request should be downgraded to observe-only
     * due to stale document/frame identity.
     */
    shouldDowngradeToObserve(req) {
        const { requestedDocumentId, requestedFrameId, senderDocumentId, senderFrameId } = req;

        // Stale document ID
        if (requestedDocumentId && senderDocumentId && requestedDocumentId !== senderDocumentId) {
            return { downgrade: true, reason: "Document ID mismatch — possible SPA navigation" };
        }

        // Frame ID mismatch
        if (requestedFrameId !== undefined && senderFrameId !== undefined
            && requestedFrameId !== senderFrameId) {
            return { downgrade: true, reason: "Frame ID mismatch — possible iframe replacement" };
        }

        return { downgrade: false, reason: null };
    },
};
