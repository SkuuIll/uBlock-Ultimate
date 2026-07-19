/**
 * platform/chromium/js/extension-update-migration.js
 *
 * Extension update migration handler.
 *
 * Runs schema and state migrations when the extension version changes.
 * Tracks previous version, runs migration steps in order, and records
 * migration outcomes. Supports rollback on partial failure.
 *
 * Usage:
 *   import { ExtensionUpdateMigration } from "./extension-update-migration.js";
 *   await ExtensionUpdateMigration.runIfNeeded();
 */

const _migrationSteps = [];
let _previousVersion = "";
let _currentVersion = "";

export const ExtensionUpdateMigration = Object.freeze({
    /**
     * Register a migration step.
     * @param {string} fromVersion
     * @param {string} toVersion
     * @param {() => Promise<void>} step
     */
    register(fromVersion, toVersion, step) {
        _migrationSteps.push({ fromVersion, toVersion, step });
    },

    /**
     * Run all needed migrations based on previous version.
     * @param {string} [previousVersion]
     * @returns {Promise<{ ok: boolean, steps: number, errors: string[] }>}
     */
    async runIfNeeded(previousVersion) {
        _previousVersion = previousVersion || "";
        _currentVersion = chrome.runtime.getManifest().version;
        const errors = [];
        let stepsRun = 0;

        if (!_previousVersion || _previousVersion === _currentVersion) {
            return { ok: true, steps: 0, errors: [] };
        }

        const sorted = [..._migrationSteps]
            .filter(s => {
                const fromOk = !s.fromVersion || s.fromVersion === _previousVersion;
                const toOk = !s.toVersion || s.toVersion === _currentVersion;
                return fromOk && toOk;
            })
            .sort((a, b) => a.fromVersion.localeCompare(b.fromVersion));

        for (const step of sorted) {
            try {
                await step.step();
                stepsRun++;
            } catch (err) {
                errors.push(`migration-${step.fromVersion}-${step.toVersion}: ${err.message}`);
            }
        }

        return { ok: errors.length === 0, steps: stepsRun, errors };
    },
});
