/**
 * platform/chromium/js/effective-settings.js
 *
 * Managed/default/user setting precedence resolver.
 *
 * Precedence: managed policy > enterprise/default lock > user setting >
 *   extension default > fallback safe default
 *
 * Usage:
 *   import { effectiveSettings } from "./effective-settings.js";
 *   const val = effectiveSettings.get("advancedUserEnabled");
 *   // { name: "advancedUserEnabled", value: false, source: "user", userEditable: true }
 */

// ---------------------------------------------------------------------------
// Setting source definitions
// ---------------------------------------------------------------------------

const SOURCE = Object.freeze({
    MANAGED: "managed",
    USER: "user",
    DEFAULT: "default",
    FALLBACK: "fallback",
});

// ---------------------------------------------------------------------------
// Setting metadata registry
// ---------------------------------------------------------------------------

const _registry = new Map();

/**
 * Define a setting and its metadata.
 *
 * @param {string} name
 * @param {object} opts
 * @param {*} opts.defaultValue
 * @param {string} [opts.source="default"] - initial source
 * @param {boolean} [opts.userEditable=true]
 * @param {boolean} [opts.policyRevisionBump=false] - does changing this bump policy revision?
 * @param {string} [opts.sideEffectId] - settings-effect registry entry to invoke on change
 */
export function defineSetting(name, opts) {
    const {
        defaultValue,
        source = SOURCE.DEFAULT,
        userEditable = true,
        policyRevisionBump = false,
        sideEffectId,
    } = opts;

    _registry.set(name, {
        name,
        value: defaultValue,
        defaultValue,
        source,
        userEditable,
        policyRevisionBump,
        sideEffectId,
    });
}

// ---------------------------------------------------------------------------
// Setting overrides
// ---------------------------------------------------------------------------

const _managedOverrides = new Map();
const _userOverrides = new Map();

/**
 * Apply managed policy settings (highest precedence).
 */
export function setManagedSetting(name, value) {
    _managedOverrides.set(name, { value, source: SOURCE.MANAGED });
}

/**
 * Apply user-controlled setting (medium precedence).
 */
export function setUserSetting(name, value) {
    _userOverrides.set(name, { value, source: SOURCE.USER });
}

/**
 * Remove managed override for a setting.
 */
export function clearManagedSetting(name) {
    _managedOverrides.delete(name);
}

/**
 * Remove user override for a setting.
 */
export function clearUserSetting(name) {
    _userOverrides.delete(name);
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the effective value for a setting.
 *
 * Priority: managed > user > defined default > fallback safe default
 *
 * @param {string} name
 * @returns {{ name: string, value: any, source: string, userEditable: boolean }}
 */
export function getEffectiveSetting(name) {
    const def = _registry.get(name);

    // Managed override (highest priority)
    const managed = _managedOverrides.get(name);
    if (managed !== undefined) {
        return {
            name,
            value: managed.value,
            source: SOURCE.MANAGED,
            userEditable: false,
        };
    }

    // User override (medium priority)
    const user = _userOverrides.get(name);
    if (user !== undefined) {
        return {
            name,
            value: user.value,
            source: SOURCE.USER,
            userEditable: def ? def.userEditable : true,
        };
    }

    // Defined default or fallback
    if (def !== undefined) {
        return {
            name,
            value: def.value,
            source: def.source,
            userEditable: def.userEditable,
        };
    }

    // Fallback safe default
    return {
        name,
        value: undefined,
        source: SOURCE.FALLBACK,
        userEditable: true,
    };
}

/**
 * Get the raw (unresolved) setting definition.
 */
export function getSettingDefinition(name) {
    return _registry.get(name) || null;
}

/**
 * Return a diagnostic snapshot of all known settings and their effective values.
 */
export function getSettingsSnapshot() {
    const settings = [];
    for (const [name] of _registry) {
        settings.push(getEffectiveSetting(name));
    }
    return settings;
}

export const effectiveSettings = {
    define: defineSetting,
    get: getEffectiveSetting,
    getDefinition: getSettingDefinition,
    setManaged: setManagedSetting,
    setUser: setUserSetting,
    clearManaged: clearManagedSetting,
    clearUser: clearUserSetting,
    snapshot: getSettingsSnapshot,
    SOURCE,
};
