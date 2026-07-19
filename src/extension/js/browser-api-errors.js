/**
 * platform/chromium/js/browser-api-errors.js
 *
 * Browser API failure taxonomy and fallback policy.
 *
 * Every browser API wrapper should map errors to a known reason
 * so recovery can be consistent across the extension.  Benign
 * tab-closed races stay quiet, while quota and permission failures
 * become runtime-health transitions.
 *
 * Usage:
 *   import { BrowserApiError } from "./browser-api-errors.js";
 *   try {
 *     await chrome.tabs.sendMessage(tabId, msg);
 *   } catch (err) {
 *     const apiErr = BrowserApiError.classify("tabs", "sendMessage", err);
 *     if (apiErr.reason === "tab-closed") { silently ignore }
 *     if (apiErr.fallback === "retry") { schedule retry }
 *   }
 */
// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

const REASON = Object.freeze({
    TAB_CLOSED: "tab-closed",
    PERMISSION_MISSING: "permission-missing",
    QUOTA: "quota",
    UNSUPPORTED: "unsupported",
    INVALID_ARGUMENT: "invalid-argument",
    TRANSIENT: "transient",
    POLICY_DENIED: "policy-denied",
    UNKNOWN: "unknown",
});

// ---------------------------------------------------------------------------
// Error patterns per API
// ---------------------------------------------------------------------------

const _patterns = [
    // tabs
    { api: "tabs", patterns: [/No tab with id/i, /Invalid tab/i, /Tab.*not found/i, /The tab was closed/i], reason: REASON.TAB_CLOSED, recoverable: true, fallback: "ignore" },
    { api: "tabs", patterns: [/Cannot access/i, /Missing host permission/i], reason: REASON.PERMISSION_MISSING, recoverable: false, fallback: "degrade" },
    { api: "tabs", patterns: [/Invalid url/i, /Invalid arguments/i], reason: REASON.INVALID_ARGUMENT, recoverable: false, fallback: "surface-to-user" },

    // scripting
    { api: "scripting", patterns: [/Cannot access/i, /Permission denied/i, /Host permission required/i], reason: REASON.PERMISSION_MISSING, recoverable: false, fallback: "degrade" },
    { api: "scripting", patterns: [/No tab with id/i, /Invalid tab/i], reason: REASON.TAB_CLOSED, recoverable: true, fallback: "ignore" },
    { api: "scripting", patterns: [/Invalid injection/i, /Invalid arguments/i], reason: REASON.INVALID_ARGUMENT, recoverable: false, fallback: "surface-to-user" },

    // declarativeNetRequest
    { api: "dnr", patterns: [/Rule limit exceeded/i, /Too many rules/i, /Quota.*exceeded/i], reason: REASON.QUOTA, recoverable: false, fallback: "degrade" },
    { api: "dnr", patterns: [/Invalid rule/i, /Rule.*is invalid/i], reason: REASON.INVALID_ARGUMENT, recoverable: false, fallback: "surface-to-user" },
    { api: "dnr", patterns: [/Cannot modify/i, /Not allowed/i], reason: REASON.POLICY_DENIED, recoverable: false, fallback: "repair" },

    // contextMenus
    { api: "contextMenus", patterns: [/Cannot create/i, /Invalid id/i], reason: REASON.INVALID_ARGUMENT, recoverable: false, fallback: "surface-to-user" },

    // storage
    { api: "storage", patterns: [/Quota.*exceeded/i, /MAX_WRITE_OPERATIONS/i, /write.*failed/i], reason: REASON.QUOTA, recoverable: false, fallback: "degrade" },
    { api: "storage", patterns: [/Cannot access/i, /Permission denied/i], reason: REASON.PERMISSION_MISSING, recoverable: false, fallback: "degrade" },

    // webRequest
    { api: "webRequest", patterns: [/Invalid arguments/i], reason: REASON.INVALID_ARGUMENT, recoverable: false, fallback: "surface-to-user" },

    // general transient errors
    { api: "*", patterns: [/Internal error/i, /Connection refused/i, /Network error/i, /The browser is shutting down/i], reason: REASON.TRANSIENT, recoverable: true, fallback: "retry" },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const BrowserApiError = {
    REASON,

    /**
     * Classify a browser API error.
     *
     * @param {string} api - API name (tabs, scripting, dnr, storage, etc.)
     * @param {string} operation - operation name (sendMessage, insertCSS, etc.)
     * @param {Error} error - the caught error
     * @returns {object} { api, operation, reason, recoverable, fallback, message }
     */
    classify(api, operation, error) {
        const message = (error && (error.message || String(error))) || "";

        // Check API-specific patterns first
        for (const entry of _patterns) {
            if (entry.api !== "*" && entry.api !== api) continue;
            for (const pattern of entry.patterns) {
                if (pattern.test(message)) {
                    return {
                        api,
                        operation,
                        reason: entry.reason,
                        recoverable: entry.recoverable,
                        fallback: entry.fallback,
                        message,
                    };
                }
            }
        }

        // Check generic patterns
        for (const entry of _patterns) {
            if (entry.api !== "*") continue;
            for (const pattern of entry.patterns) {
                if (pattern.test(message)) {
                    return {
                        api,
                        operation,
                        reason: entry.reason,
                        recoverable: entry.recoverable,
                        fallback: entry.fallback,
                        message,
                    };
                }
            }
        }

        // Unknown error
        return {
            api,
            operation,
            reason: REASON.UNKNOWN,
            recoverable: false,
            fallback: "surface-to-user",
            message,
        };
    },

    /**
     * Quick check: is this a benign tab-closed error?
     */
    isBenignTabClosed(api, operation, error) {
        const result = BrowserApiError.classify(api, operation, error);
        return result.reason === REASON.TAB_CLOSED;
    },

    /**
     * Quick check: should this error trigger a runtime-health transition?
     */
    isHealthCritical(api, operation, error) {
        const result = BrowserApiError.classify(api, operation, error);
        return result.fallback === "degrade" || result.fallback === "repair";
    },

    /**
     * Get a suggested recovery action for the error.
     */
    getSuggestedAction(api, operation, error) {
        const result = BrowserApiError.classify(api, operation, error);
        switch (result.fallback) {
            case "ignore": return { action: "ignore", explanation: "Benign — no action needed" };
            case "retry": return { action: "retry", explanation: "Transient error — retry with backoff" };
            case "degrade": return { action: "degrade", explanation: "Capability unavailable — downgrade layer" };
            case "repair": return { action: "repair", explanation: "Recoverable failure — run repair workflow" };
            case "surface-to-user": return { action: "surface-to-user", explanation: "Show error to user" };
            default: return { action: "surface-to-user", explanation: "Unknown error" };
        }
    },
};
