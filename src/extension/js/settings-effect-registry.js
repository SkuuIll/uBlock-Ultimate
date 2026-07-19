/**
 * platform/chromium/js/settings-effect-registry.js
 *
 * Settings-effect registry for all user setting changes.
 *
 * Every user setting that triggers a side effect (browser API call,
 * policy revision bump, context menu update, badge refresh) must
 * register its effect here.  changeUserSetting() should not contain
 * direct one-off browser API calls.
 *
 * Usage:
 *   import { settingsEffectRegistry } from "./settings-effect-registry.js";
 *   settingsEffectRegistry.register({
 *     setting: "contextMenuEnabled",
 *     owner: "context-menu",
 *     apply: async (value) => { ... },
 *     policyRevisionBump: false,
 *   });
 *   await settingsEffectRegistry.applyEffects("contextMenuEnabled", true, false);
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const _effects = new Map();  // settingName → SettingEffect

class SettingEffect {
    constructor(config) {
        this.setting = config.setting;
        this.owner = config.owner || "unknown";
        this.capability = config.capability;
        this.permission = config.permission;
        this.apply = config.apply;
        this.rollback = config.rollback;
        this.verify = config.verify;
        this.policyRevisionBump = config.policyRevisionBump || false;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const settingsEffectRegistry = {
    /**
     * Register a setting effect.
     */
    register(config) {
        if (_effects.has(config.setting)) {
            throw new Error(`Setting "${config.setting}" already has a registered effect`);
        }
        _effects.set(config.setting, new SettingEffect(config));
    },

    /**
     * Apply side effects for a setting change.
     *
     * @param {string} settingName
     * @param {*} newValue
     * @param {*} oldValue
     * @param {object} [context] - additional context for the effect
     * @returns {Promise<{ ok: boolean, policyRevisionBump: boolean, error?: string }>}
     */
    async applyEffects(settingName, newValue, oldValue, context = {}) {
        const effect = _effects.get(settingName);
        if (!effect) {
            return { ok: true, policyRevisionBump: false };  // no effect = no-op
        }

        // Check capability gate
        if (effect.capability) {
            try {
                const { permissionState } = await import("./permission-state.js");
                const hasCap = await permissionState.has(effect.capability);
                if (!hasCap) {
                    return {
                        ok: false,
                        policyRevisionBump: false,
                        error: `Capability "${effect.capability}" not available`,
                    };
                }
            } catch (_) {}
        }

        // Check permission gate
        if (effect.permission) {
            try {
                const { permissionState } = await import("./permission-state.js");
                const hasPerm = await permissionState.has(effect.permission);
                if (!hasPerm) {
                    return {
                        ok: false,
                        policyRevisionBump: false,
                        error: `Permission "${effect.permission}" not granted`,
                    };
                }
            } catch (_) {}
        }

        // Apply the effect
        try {
            await effect.apply(newValue, oldValue, context);
        } catch (err) {
            // Rollback if available
            if (effect.rollback) {
                try {
                    await effect.rollback(oldValue, "apply-failed");
                } catch (_) {
                    // Rollback also failed — return partial failure
                }
            }
            return {
                ok: false,
                policyRevisionBump: effect.policyRevisionBump,
                error: err.message || String(err),
            };
        }

        // Verify if available
        if (effect.verify) {
            try {
                const verified = await effect.verify(newValue);
                if (!verified) {
                    if (effect.rollback) {
                        try { await effect.rollback(oldValue, "verify-failed"); } catch (_) {}
                    }
                    return {
                        ok: false,
                        policyRevisionBump: effect.policyRevisionBump,
                        error: `Verification failed for setting "${settingName}"`,
                    };
                }
            } catch (err) {
                if (effect.rollback) {
                    try { await effect.rollback(oldValue, "verify-error"); } catch (_) {}
                }
                return {
                    ok: false,
                    policyRevisionBump: effect.policyRevisionBump,
                    error: `Verification error: ${err.message}`,
                };
            }
        }

        return { ok: true, policyRevisionBump: effect.policyRevisionBump };
    },

    /**
     * Get the registered effect for a setting.
     */
    get(settingName) {
        return _effects.get(settingName) || null;
    },

    /**
     * Return diagnostic snapshot.
     */
    getSnapshot() {
        const effects = [];
        for (const [, effect] of _effects) {
            effects.push({
                setting: effect.setting,
                owner: effect.owner,
                capability: effect.capability,
                permission: effect.permission,
                hasApply: !!effect.apply,
                hasRollback: !!effect.rollback,
                hasVerify: !!effect.verify,
                policyRevisionBump: effect.policyRevisionBump,
            });
        }
        return effects;
    },
};
