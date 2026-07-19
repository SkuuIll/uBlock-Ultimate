/**
 * platform/chromium/js/permission-state.js
 *
 * Permission-change observer and downgrade/recovery flow.
 *
 * Permissions can be missing, revoked, unsupported by browser, disabled
 * by policy, or behave differently by profile.  This module provides a
 * single authority for permission state queries and change notifications.
 *
 * Usage:
 *   import { permissionState } from "./permission-state.js";
 *   const hasIt = await permissionState.has("scripting");
 *   const snapshot = await permissionState.getSnapshot();
 *   permissionState.onChange((changes) => { ... });
 */

// ---------------------------------------------------------------------------
// Required permissions (extracted from manifest)
// ---------------------------------------------------------------------------

const _requiredPermissions = [
    "tabs",
    "webRequest",
    "declarativeNetRequest",
    "declarativeNetRequestFeedback",
    "storage",
    "unlimitedStorage",
    "contextMenus",
    "scripting",
];

const _optionalPermissions = [
    "privacy",
    "commands",
];

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _initialized = false;
let _permissionCache = new Map();  // permission → { granted, available }
const _changeListeners = new Set();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function _checkPermission(perm) {
    try {
        if (typeof chrome !== "undefined" && chrome.permissions) {
            const result = await chrome.permissions.contains({ permissions: [perm] });
            return result;
        }
    } catch (_) { /* not in extension context */ }
    return false;
}

function _checkBrowserApi(perm) {
    switch (perm) {
        case "tabs": return typeof chrome !== "undefined" && !!chrome.tabs;
        case "webRequest": return typeof chrome !== "undefined" && !!chrome.webRequest;
        case "declarativeNetRequest": return typeof chrome !== "undefined" && !!chrome.declarativeNetRequest;
        case "declarativeNetRequestFeedback": return typeof chrome !== "undefined" && !!chrome.declarativeNetRequest && typeof chrome.declarativeNetRequest.onRuleMatchedDebug !== "undefined";
        case "storage": return typeof chrome !== "undefined" && !!chrome.storage;
        case "unlimitedStorage": return true;  // no API check possible
        case "contextMenus": return typeof chrome !== "undefined" && !!chrome.contextMenus;
        case "scripting": return typeof chrome !== "undefined" && !!chrome.scripting;
        case "privacy": return typeof chrome !== "undefined" && !!chrome.privacy;
        case "commands": return typeof chrome !== "undefined" && !!chrome.commands;
        default: return false;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const permissionState = {
    /**
     * Initialize permission state cache.
     */
    async initialize() {
        if (_initialized) return;
        _initialized = true;

        const allPermissions = [..._requiredPermissions, ..._optionalPermissions];
        for (const perm of allPermissions) {
            const granted = await _checkPermission(perm);
            const available = _checkBrowserApi(perm);
            _permissionCache.set(perm, { granted, available });
        }
    },

    /**
     * Check whether a permission is currently granted.
     */
    async has(permission) {
        // Check cache first
        const cached = _permissionCache.get(permission);
        if (cached !== undefined) {
            return cached.granted;
        }
        // Fallback: live check
        return _checkPermission(permission);
    },

    /**
     * Check whether a browser API is available (regardless of permission grant).
     */
    isApiAvailable(permission) {
        return _checkBrowserApi(permission);
    },

    /**
     * Refresh the permission cache.
     */
    async refresh() {
        const previous = new Map(_permissionCache);
        for (const [perm] of _permissionCache) {
            const granted = await _checkPermission(perm);
            _permissionCache.set(perm, { ..._permissionCache.get(perm), granted });
        }

        // Notify listeners of changes
        const changes = [];
        for (const [perm, state] of _permissionCache) {
            const prev = previous.get(perm);
            if (prev && prev.granted !== state.granted) {
                changes.push({
                    permission: perm,
                    previous: prev.granted,
                    current: state.granted,
                    apiAvailable: state.available,
                });
            }
        }

        if (changes.length > 0) {
            for (const listener of _changeListeners) {
                try { listener(changes); } catch (_) {}
            }
        }

        return changes;
    },

    /**
     * Register a change listener.  Called with an array of permission changes.
     */
    onChange(listener) {
        _changeListeners.add(listener);
    },

    /**
     * Remove a change listener.
     */
    removeChangeListener(listener) {
        _changeListeners.delete(listener);
    },

    /**
     * Get a comprehensive permission state snapshot.
     */
    async getSnapshot() {
        if (!_initialized) {
            await permissionState.initialize();
        }

        const permissions = {};
        for (const [perm, state] of _permissionCache) {
            permissions[perm] = {
                granted: state.granted,
                apiAvailable: state.available,
                apiUnavailable: !state.available,
            };
        }

        return {
            initialized: _initialized,
            permissions,
            missing: [..._permissionCache.entries()]
                .filter(([, s]) => !s.granted)
                .map(([p]) => p),
        };
    },
};
