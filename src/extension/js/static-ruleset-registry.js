/**
 * platform/chromium/js/static-ruleset-registry.js
 *
 * Static ruleset lifecycle and enabled-state reconciliation.
 *
 * Static rulesets are declared in the manifest and can be enabled/disabled
 * independently.  This registry tracks their lifecycle, ownership, and
 * enabled state, and reconciles actual browser state against policy.
 *
 * Usage:
 *   import { staticRulesetRegistry } from "./static-ruleset-registry.js";
 *   staticRulesetRegistry.define("ruleset-id", { owner: "default-filters", ... });
 *   const enabled = await staticRulesetRegistry.isEnabled("ruleset-id");
 *   await staticRulesetRegistry.reconcile();
 */

// ---------------------------------------------------------------------------
// Ruleset definitions
// ---------------------------------------------------------------------------

const _registry = new Map();

class StaticRulesetDefinition {
    constructor(id, opts) {
        this.id = id;
        this.manifestPath = opts.manifestPath || id;
        this.owner = opts.owner || "unknown";
        this.releaseMode = opts.releaseMode || "release";
        this.defaultEnabled = opts.defaultEnabled !== false;
        this.allowedProfiles = opts.allowedProfiles || ["*"];
        this.conflictsWith = opts.conflictsWith || [];
        this.migrationVersion = opts.migrationVersion || 0;
    }

    get isReleaseRuleset() {
        return this.releaseMode === "release";
    }

    get isTestRuleset() {
        return this.releaseMode === "test";
    }

    isAllowedInProfile(profileId) {
        if (this.allowedProfiles.includes("*")) return true;
        return this.allowedProfiles.includes(profileId);
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const staticRulesetRegistry = {
    /**
     * Define a static ruleset.
     */
    define(id, opts) {
        if (_registry.has(id)) {
            throw new Error(`Static ruleset "${id}" is already defined`);
        }
        _registry.set(id, new StaticRulesetDefinition(id, opts));
    },

    /**
     * Get a ruleset definition by id.
     */
    get(id) {
        return _registry.get(id) || null;
    },

    /**
     * Get all defined ruleset ids.
     */
    getAllIds() {
        return [..._registry.keys()];
    },

    /**
     * Get all release ruleset ids.
     */
    getReleaseIds() {
        const ids = [];
        for (const [id, def] of _registry) {
            if (def.isReleaseRuleset) ids.push(id);
        }
        return ids;
    },

    /**
     * Check whether a static ruleset is currently enabled in the browser.
     */
    async isEnabled(id) {
        try {
            if (typeof chrome !== "undefined" && chrome.declarativeNetRequest) {
                const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
                return enabled.includes(id);
            }
        } catch (_) { /* not in extension context or API unavailable */ }
        return false;
    },

    /**
     * Get the list of enabled rulesets from the browser.
     */
    async getEnabledRulesets() {
        try {
            if (typeof chrome !== "undefined" && chrome.declarativeNetRequest) {
                return await chrome.declarativeNetRequest.getEnabledRulesets();
            }
        } catch (_) { /* not in extension context */ }
        return [];
    },

    /**
     * Enable a static ruleset.
     */
    async enable(id) {
        const def = _registry.get(id);
        if (!def) throw new Error(`Unknown static ruleset: "${id}"`);

        try {
            if (typeof chrome !== "undefined" && chrome.declarativeNetRequest) {
                await chrome.declarativeNetRequest.updateEnabledRulesets({
                    enableRulesetIds: [id],
                    disableRulesetIds: [],
                });
            }
        } catch (err) {
            throw new Error(`Failed to enable ruleset "${id}": ${err.message}`);
        }
    },

    /**
     * Disable a static ruleset.
     */
    async disable(id) {
        try {
            if (typeof chrome !== "undefined" && chrome.declarativeNetRequest) {
                await chrome.declarativeNetRequest.updateEnabledRulesets({
                    enableRulesetIds: [],
                    disableRulesetIds: [id],
                });
            }
        } catch (err) {
            throw new Error(`Failed to disable ruleset "${id}": ${err.message}`);
        }
    },

    /**
     * Reconcile actual browser enabled state against policy:
     * - Enable rulesets that should be enabled but aren't.
     * - Disable rulesets that should not be enabled.
     */
    async reconcile(profileId) {
        const enabled = await staticRulesetRegistry.getEnabledRulesets();
        const enabledSet = new Set(enabled);
        const actions = { enable: [], disable: [] };

        for (const [id, def] of _registry) {
            const shouldBeEnabled = def.defaultEnabled
                && def.isReleaseRuleset
                && def.isAllowedInProfile(profileId || "*");

            if (shouldBeEnabled && !enabledSet.has(id)) {
                actions.enable.push(id);
            } else if (!shouldBeEnabled && enabledSet.has(id)) {
                actions.disable.push(id);
            }
        }

        if (actions.enable.length > 0 || actions.disable.length > 0) {
            try {
                await chrome.declarativeNetRequest.updateEnabledRulesets({
                    enableRulesetIds: actions.enable,
                    disableRulesetIds: actions.disable,
                });
            } catch (_) {}
        }

        return actions;
    },

    /**
     * Return diagnostic snapshot.
     */
    getSnapshot() {
        const rulesets = [];
        for (const [id, def] of _registry) {
            rulesets.push({
                id: def.id,
                owner: def.owner,
                releaseMode: def.releaseMode,
                defaultEnabled: def.defaultEnabled,
                allowedProfiles: def.allowedProfiles,
                conflictsWith: def.conflictsWith,
            });
        }
        return rulesets;
    },

    /**
     * Reset the registry (for testing).
     */
    reset() {
        _registry.clear();
    },
};
