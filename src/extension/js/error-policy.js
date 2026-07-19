/**
 * platform/chromium/js/error-policy.js
 *
 * Structured error policy with error classification.
 *
 * Instead of a global unhandled-rejection suppressor, this module
 * classifies errors by their root cause and determines whether they
 * should be suppressed, surfaced, or trigger a runtime-health change.
 *
 * Usage:
 *   import { classifyRuntimeError, isBenign, shouldSuppress } from "./error-policy.js";
 *   const classification = classifyRuntimeError(error);
 *   if (shouldSuppress(classification)) { return; }
 *   // otherwise surface the error
 */

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

const ERROR_CLASS = Object.freeze({
    BENIGN_TAB_LIFECYCLE_RACE: "benign-tab-lifecycle-race",
    STALE_DOCUMENT: "stale-document",
    POLICY_NOT_READY: "policy-not-ready",
    DNR_UPDATE_FAILED: "dnr-update-failed",
    EXTERNAL_ASSET_FETCH_FAILED: "external-asset-fetch-failed",
    STORAGE_SCHEMA_VIOLATION: "storage-schema-violation",
    UNSAFE_MUTATION_REJECTED: "unsafe-mutation-rejected",
    UNEXPECTED: "unexpected",
});

// ---------------------------------------------------------------------------
// Error classification patterns
// ---------------------------------------------------------------------------

const _PATTERNS = [
    {
        class: ERROR_CLASS.BENIGN_TAB_LIFECYCLE_RACE,
        patterns: [
            /No tab with id/i,
            /Invalid tab id/i,
            /Tab [0-9]+ not found/i,
            /No matching tab/i,
            /Cannot access a chrome-extension:\/\/ resource/i,
            /The tab was closed/i,
            /Frame with id [0-9]+ not found/i,
        ],
        suppress: true,
        updateHealth: false,
    },
    {
        class: ERROR_CLASS.STALE_DOCUMENT,
        patterns: [
            /stale document/i,
            /document id.*no longer valid/i,
            /frame.*discarded/i,
            /bfcache.*restore/i,
        ],
        suppress: true,
        updateHealth: false,
    },
    {
        class: ERROR_CLASS.POLICY_NOT_READY,
        patterns: [
            /policy.*not.*ready/i,
            /profiles?.*not.*loaded/i,
            /runtime.*not.*ready/i,
        ],
        suppress: false,
        updateHealth: true,
    },
    {
        class: ERROR_CLASS.DNR_UPDATE_FAILED,
        patterns: [
            /dnr.*update.*failed/i,
            /rule.*limit.*exceeded/i,
            /too many rules/i,
            /dynamic rule.*invalid/i,
            /session rule.*invalid/i,
            /declarativeNetRequest.*error/i,
        ],
        suppress: false,
        updateHealth: true,
    },
    {
        class: ERROR_CLASS.EXTERNAL_ASSET_FETCH_FAILED,
        patterns: [
            /fetch.*failed/i,
            /network.*error/i,
            /asset.*not found/i,
            /list.*download.*failed/i,
            /filter.*list.*fetch.*error/i,
        ],
        suppress: false,
        updateHealth: false,
    },
    {
        class: ERROR_CLASS.STORAGE_SCHEMA_VIOLATION,
        patterns: [
            /storage.*schema.*violation/i,
            /invalid.*storage.*format/i,
            /corrupt.*data/i,
            /storage.*quota.*exceeded/i,
        ],
        suppress: false,
        updateHealth: true,
    },
    {
        class: ERROR_CLASS.UNSAFE_MUTATION_REJECTED,
        patterns: [
            /unsafe.*mutation/i,
            /mutation.*rejected/i,
            /high.risk.*selector/i,
            /mutation.*blocked.*by.*policy/i,
        ],
        suppress: false,
        updateHealth: false,
    },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify a runtime error.
 *
 * @param {Error|string} error
 * @returns {{ errorClass: string, suppress: boolean, updateHealth: boolean, matchedPattern: string|null }}
 */
export function classifyRuntimeError(error) {
    const message = (error && (error.message || error)) || "";

    for (const entry of _PATTERNS) {
        for (const pattern of entry.patterns) {
            if (pattern.test(message)) {
                return {
                    errorClass: entry.class,
                    suppress: entry.suppress,
                    updateHealth: entry.updateHealth,
                    matchedPattern: pattern.source,
                };
            }
        }
    }

    return {
        errorClass: ERROR_CLASS.UNEXPECTED,
        suppress: false,
        updateHealth: false,
        matchedPattern: null,
    };
}

/**
 * Quick check: should this error be suppressed (not surfaced to console/user)?
 */
export function shouldSuppress(error) {
    const classification = classifyRuntimeError(error);
    return classification.suppress;
}

/**
 * Quick check: is this error benign (can be safely ignored)?
 */
export function isBenign(error) {
    const classification = classifyRuntimeError(error);
    return classification.errorClass === ERROR_CLASS.BENIGN_TAB_LIFECYCLE_RACE
        || classification.errorClass === ERROR_CLASS.STALE_DOCUMENT;
}

/**
 * Quick check: should this error trigger a runtime-health update?
 */
export function shouldUpdateHealth(error) {
    const classification = classifyRuntimeError(error);
    return classification.updateHealth;
}

/**
 * Register a custom error classification pattern.
 */
export function registerErrorClass(errorClass, patterns, { suppress, updateHealth } = {}) {
    _PATTERNS.push({
        class: errorClass,
        patterns: Array.isArray(patterns) ? patterns : [patterns],
        suppress: suppress !== false,
        updateHealth: updateHealth === true,
    });
}

export { ERROR_CLASS };
