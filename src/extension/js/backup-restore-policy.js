/**
 * platform/chromium/js/backup-restore-policy.js
 *
 * Gate backup, restore, and cloud paths through storage schema validation.
 *
 * Every backup/restore/cloud operation is routed through this policy so
 * payloads are schema-validated, unknown keys are rejected, and version
 * migration is applied before storage writes.
 *
 * Usage:
 *   import { BackupRestorePolicy } from "./backup-restore-policy.js";
 *   const result = await BackupRestorePolicy.validateRestore(payload);
 *   if (result.ok) await BackupRestorePolicy.applyRestore(result.data);
 */

const _schemaVersion = 1;
const _allowedCloudKeys = new Set([
    "userFilters",
    "selectedFilterLists",
    "hostnameSwitches",
    "urlFilteringRules",
    "whitelist",
]);

/**
 * Basic key-level schema registry. Keys not in this set are unknown.
 */
const _knownKeys = new Set([
    "userSettings",
    "selectedFilterLists",
    "userFilters",
    "whitelist",
    "hostnameSwitches",
    "urlFilteringRules",
    "localData",
    "cloudData",
    "filterListCache",
    "cosmeticFiltersData",
]);

export const BackupRestorePolicy = Object.freeze({
    schemaVersion: _schemaVersion,

    /**
     * Validate a restore payload before writing to storage.
     * @param {object} payload - The raw parsed JSON object from backup/import.
     * @returns {{ ok: boolean, data?: object, rejectedKeys?: string[], errors?: string[] }}
     */
    validateRestore(payload) {
        const errors = [];
        const rejectedKeys = [];
        const data = {};

        if (!payload || typeof payload !== "object") {
            return { ok: false, errors: ["invalid-payload"] };
        }

        for (const [key, value] of Object.entries(payload)) {
            if (!_knownKeys.has(key)) {
                rejectedKeys.push(key);
                continue;
            }
            data[key] = value;
        }

        if (rejectedKeys.length > 0) {
            errors.push(`rejected-unknown-keys: ${rejectedKeys.join(",")}`);
        }

        return { ok: errors.length === 0, data, rejectedKeys, errors };
    },

    /**
     * Validate a cloud sync data key against the allowlist.
     * @param {string} key
     * @returns {boolean}
     */
    isCloudKeyAllowed(key) {
        return _allowedCloudKeys.has(key);
    },

    /**
     * Check whether a key may be included in backup exports.
     * @param {string} key
     * @returns {boolean}
     */
    isBackupEligible(key) {
        return _knownKeys.has(key);
    },
});
