/**
 * platform/chromium/js/profile-mode-policy.js
 *
 * Incognito, private-window, and profile-mode policy.
 *
 * Storage, logging, diagnostics, DNR session rules, cloud sync, and
 * context menus can behave differently per browser profile mode.
 * This module provides a single authority for profile-mode decisions.
 *
 * Usage:
 *   import { profileModePolicy } from "./profile-mode-policy.js";
 *   const mode = await profileModePolicy.detectMode();
 *   const policy = profileModePolicy.getProfilePolicy(mode);
 */

// ---------------------------------------------------------------------------
// Profile modes
// ---------------------------------------------------------------------------

const MODE = Object.freeze({
    NORMAL: "normal",
    INCOGNITO_SPLIT: "incognito-split",
    INCOGNITO_SPANNING: "incognito-spanning",
    GUEST: "guest",
    MANAGED_ENTERPRISE: "managed-enterprise",
    UNKNOWN: "unknown",
});

// ---------------------------------------------------------------------------
// Profile policy definitions
// ---------------------------------------------------------------------------

const _profilePolicies = {
    [MODE.NORMAL]: {
        storageNamespace: "default",
        loggerAllowed: true,
        diagnosticRetentionMs: 7 * 24 * 60 * 60 * 1000,  // 7 days
        cloudBackupEligible: true,
        dnrSessionShared: true,
        contextMenuEligible: true,
        webRequestInstrumentationEligible: true,
        safeModeNamespace: "default",
    },
    [MODE.INCOGNITO_SPLIT]: {
        storageNamespace: "incognito-split",
        loggerAllowed: false,
        diagnosticRetentionMs: 60 * 60 * 1000,  // 1 hour
        cloudBackupEligible: false,
        dnrSessionShared: false,
        contextMenuEligible: false,
        webRequestInstrumentationEligible: false,
        safeModeNamespace: "incognito",
    },
    [MODE.INCOGNITO_SPANNING]: {
        storageNamespace: "default",
        loggerAllowed: true,
        diagnosticRetentionMs: 24 * 60 * 60 * 1000,  // 24 hours
        cloudBackupEligible: false,
        dnrSessionShared: true,
        contextMenuEligible: true,
        webRequestInstrumentationEligible: true,
        safeModeNamespace: "default",
    },
    [MODE.GUEST]: {
        storageNamespace: "guest",
        loggerAllowed: false,
        diagnosticRetentionMs: 60 * 60 * 1000,  // 1 hour
        cloudBackupEligible: false,
        dnrSessionShared: false,
        contextMenuEligible: false,
        webRequestInstrumentationEligible: false,
        safeModeNamespace: "guest",
    },
    [MODE.MANAGED_ENTERPRISE]: {
        storageNamespace: "managed",
        loggerAllowed: true,
        diagnosticRetentionMs: 24 * 60 * 60 * 1000,  // 24 hours
        cloudBackupEligible: false,
        dnrSessionShared: true,
        contextMenuEligible: true,
        webRequestInstrumentationEligible: true,
        safeModeNamespace: "default",
    },
    [MODE.UNKNOWN]: {
        storageNamespace: "default",
        loggerAllowed: false,
        diagnosticRetentionMs: 60 * 60 * 1000,  // 1 hour
        cloudBackupEligible: false,
        dnrSessionShared: false,
        contextMenuEligible: false,
        webRequestInstrumentationEligible: false,
        safeModeNamespace: "unknown",
    },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const profileModePolicy = {
    MODE,

    /**
     * Detect the current profile mode.
     *
     * In MV3 service worker, incognito detection is limited.
     * We use `chrome.extension.inIncognitoContext` when available.
     *
     * @returns {Promise<string>} one of MODE values
     */
    async detectMode() {
        try {
            // Check incognito context
            if (typeof chrome !== "undefined" && chrome.extension) {
                const incognito = await new Promise(resolve => {
                    try {
                        resolve(chrome.extension.inIncognitoContext);
                    } catch (_) {
                        resolve(false);
                    }
                });
                if (incognito) {
                    // Incognito: check if storage is split or spanning
                    try {
                        const storageType = chrome.storage ? chrome.storage.incognito : null;
                        if (storageType === "split") {
                            return MODE.INCOGNITO_SPLIT;
                        }
                        return MODE.INCOGNITO_SPANNING;
                    } catch (_) {
                        return MODE.INCOGNITO_SPLIT;
                    }
                }
            }
        } catch (_) { /* not in extension context */ }

        // Could add more detection here (guest profile, managed enterprise, etc.)
        return MODE.NORMAL;
    },

    /**
     * Get the profile policy for a given mode.
     */
    getProfilePolicy(mode) {
        return _profilePolicies[mode] || _profilePolicies[MODE.UNKNOWN];
    },

    /**
     * Convenience: detect mode and return full policy in one call.
     */
    async getEffectivePolicy() {
        const mode = await profileModePolicy.detectMode();
        return {
            mode,
            policy: _profilePolicies[mode] || _profilePolicies[MODE.UNKNOWN],
        };
    },

    /**
     * Override a profile policy field.
     */
    setProfilePolicyField(mode, field, value) {
        const policy = _profilePolicies[mode];
        if (policy && field in policy) {
            policy[field] = value;
        }
    },

    /**
     * Return diagnostic snapshot.
     */
    getSnapshot() {
        const modes = {};
        for (const [mode, policy] of Object.entries(_profilePolicies)) {
            modes[mode] = { ...policy };
        }
        return modes;
    },
};
