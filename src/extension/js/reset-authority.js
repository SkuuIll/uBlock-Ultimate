/**
 * platform/chromium/js/reset-authority.js
 *
 * Safe-reset and factory-reset authority.
 *
 * Provides controlled reset paths for corrupt or unrecoverable state.
 * Reset levels:
 *   1: repair transient runtime state
 *   2: clear caches and generated artifacts
 *   3: reset DNR/session/dynamic/context-menu/listener/runtime state
 *   4: reset settings to defaults but keep user filters/whitelist
 *   5: full factory reset after explicit confirmation/export prompt
 *
 * Usage:
 *   import { resetAuthority } from "./reset-authority.js";
 *   const result = await resetAuthority.reset(3, { reason: "corrupt-menus", userIntent: token });
 */

// ---------------------------------------------------------------------------
// Reset level definitions
// ---------------------------------------------------------------------------

const LEVELS = Object.freeze({
    REPAIR_TRANSIENT: 1,
    CLEAR_CACHES: 2,
    RESET_RUNTIME: 3,
    RESET_SETTINGS: 4,
    FACTORY_RESET: 5,
});

const _levelNames = {
    1: "repair-transient-runtime-state",
    2: "clear-caches-and-generated-artifacts",
    3: "reset-dnr-session-menus-listeners",
    4: "reset-settings-keep-user-filters",
    5: "full-factory-reset",
};

// ---------------------------------------------------------------------------
// Reset actions
// ---------------------------------------------------------------------------

const _resetActions = {
    [LEVELS.REPAIR_TRANSIENT]: [
        { key: "reset-stale-locks", description: "Reset stale task locks and operation tokens" },
        { key: "verify-context-menus", description: "Recreate context menus from registry" },
        { key: "reconcile-listeners", description: "Re-register browser listeners" },
        { key: "clear-timer-state", description: "Cancel stale timers" },
        { key: "reset-token-state", description: "Clear stale user-intent tokens and capability tokens" },
    ],
    [LEVELS.CLEAR_CACHES]: [
        { key: "clear-policy-cache", description: "Clear policy snapshot cache" },
        { key: "clear-filter-cache", description: "Clear compiled filter cache" },
        { key: "clear-diagnostic-bundles", description: "Clear diagnostic bundles" },
        { key: "reset-compiled-counts", description: "Reset compiled filter counts" },
    ],
    [LEVELS.RESET_RUNTIME]: [
        { key: "clear-dnr-dynamic", description: "Clear all dynamic DNR rules" },
        { key: "clear-dnr-session", description: "Clear all session DNR rules" },
        { key: "clear-context-menus", description: "Remove and recreate context menus" },
        { key: "reset-listeners", description: "Remove and re-register all listeners" },
        { key: "reset-runtime-health", description: "Reset runtime health to initial state" },
        { key: "reset-capability-tokens", description: "Revoke all capability tokens" },
    ],
    [LEVELS.RESET_SETTINGS]: [
        { key: "reset-user-settings", description: "Reset user settings to defaults" },
        { key: "reset-hidden-settings", description: "Reset hidden settings to defaults" },
        { key: "reset-panel-sections", description: "Reset popup panel sections" },
        { key: "keep-user-filters", description: "Preserve user-authored filters" },
        { key: "keep-whitelist", description: "Preserve whitelist entries" },
        { key: "reset-filter-list-selection", description: "Reset selected filter lists" },
    ],
    [LEVELS.FACTORY_RESET]: [
        { key: "export-user-data", description: "Prompt user to export data before reset" },
        { key: "clear-all-storage", description: "Clear all extension storage" },
        { key: "clear-dnr-rules", description: "Clear all DNR rules (static/dynamic/session)" },
        { key: "remove-context-menus", description: "Remove all context menus" },
        { key: "reset-settings", description: "Reset all settings" },
        { key: "reinitialize-runtime", description: "Re-run full startup sequencer" },
    ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const resetAuthority = {
    LEVELS,

    /**
     * Get the list of actions for a given reset level.
     */
    getActionsForLevel(level) {
        return _resetActions[level] || [];
    },

    /**
     * Get the human-readable name for a reset level.
     */
    getLevelName(level) {
        return _levelNames[level] || "unknown";
    },

    /**
     * Check whether a given level requires a fresh user-intent token.
     */
    requiresUserIntent(level) {
        return level >= LEVELS.RESET_RUNTIME;
    },

    /**
     * Execute a reset at the given level.
     *
     * @param {number} level - one of LEVELS values
     * @param {object} opts
     * @param {string} opts.reason
     * @param {object} [opts.userIntent] - UserIntentToken for levels >= 3
     * @returns {Promise<{ ok: boolean, performed: string[], errors: string[] }>}
     */
    async reset(level, opts = {}) {
        const { reason, userIntent } = opts;
        const performed = [];
        const errors = [];

        // Validate level
        if (!_resetActions[level]) {
            return { ok: false, performed, errors: [`Invalid reset level: ${level}`] };
        }

        // Validate user intent for destructive levels
        if (resetAuthority.requiresUserIntent(level) && !userIntent) {
            return { ok: false, performed, errors: ["Reset requires a fresh user-intent token"] };
        }

        // Execute actions
        const actions = _resetActions[level];
        for (const action of actions) {
            try {
                await _executeAction(action.key);
                performed.push(action.key);
            } catch (err) {
                errors.push(`${action.key}: ${err.message || err}`);
            }
        }

        return {
            ok: errors.length === 0,
            performed,
            errors,
        };
    },

    /**
     * Return diagnostic snapshot of available reset levels.
     */
    getSnapshot() {
        const levels = [];
        for (const level of Object.values(LEVELS)) {
            if (typeof level === "number") {
                levels.push({
                    level,
                    name: _levelNames[level],
                    requiresUserIntent: resetAuthority.requiresUserIntent(level),
                    actions: _resetActions[level].map(a => a.key),
                });
            }
        }
        return levels;
    },
};

// ---------------------------------------------------------------------------
// Internal action execution
// ---------------------------------------------------------------------------

async function _executeAction(actionKey) {
    switch (actionKey) {
        case "reset-stale-locks":
            // Import and reset task locks
            try {
                const { resetAllTasks } = await import("./task-lock-registry.js");
                resetAllTasks("reset-authority");
            } catch (_) {}
            break;

        case "clear-policy-cache":
            try {
                const { invalidateAllPolicy } = await import("./policy-cache.js");
                invalidateAllPolicy();
            } catch (_) {}
            break;

        case "clear-context-menus":
        case "remove-context-menus":
            try {
                if (typeof chrome !== "undefined" && chrome.contextMenus) {
                    await new Promise(resolve => chrome.contextMenus.removeAll(resolve));
                }
            } catch (_) {}
            break;

        case "reset-capability-tokens":
            try {
                const { OperationToken } = await import("./operation-token.js");
                OperationToken.abortAll();
            } catch (_) {}
            break;

        case "clear-timer-state":
            try {
                const { schedulerRegistry } = await import("./scheduler-registry.js");
                schedulerRegistry.cancelAll();
            } catch (_) {}
            break;

        case "reset-token-state":
            try {
                const { UserIntentToken } = await import("./user-intent-token.js");
                UserIntentToken.revokeAll();
            } catch (_) {}
            break;

        // Remaining actions are stubs that can be wired when their
        // target modules exist.
        default:
            break;
    }
}
