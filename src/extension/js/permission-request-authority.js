/**
 * platform/chromium/js/permission-request-authority.js
 *
 * Optional-permission grant flow and least-privilege migration.
 *
 * All permission requests route through one authority. Each permission
 * declares its owners, required features, user-facing reason key, and
 * fallback policy. Permission prompts require fresh user intent.
 * Revoked permissions cancel related tokens and downgrade active layers.
 *
 * Usage:
 *   import { PermissionRequestAuthority } from "./permission-request-authority.js";
 *   PermissionRequestAuthority.declare({ permission: "storage", owners: ["sync"] });
 *   const result = await PermissionRequestAuthority.request("storage", { tabId });
 */

const _capabilities = new Map();

/**
 * @typedef {{
 *   permission: string,
 *   optional: boolean,
 *   owners: string[],
 *   requiredFor: string[],
 *   userFacingReasonKey: string,
 *   fallbackPolicy: "disable"|"observe-only"|"degraded",
 *   grantTriggers: string[],
 *   revokeEffects: string[],
 * }} PermissionCapability
 */

export const PermissionRequestAuthority = Object.freeze({
    /**
     * Declare a permission capability.
     * @param {PermissionCapability} spec
     */
    declare(spec) {
        if (_capabilities.has(spec.permission)) {
            throw new Error(`Duplicate permission capability: ${spec.permission}`);
        }
        _capabilities.set(spec.permission, {
            permission: spec.permission,
            optional: spec.optional || false,
            owners: spec.owners || [],
            requiredFor: spec.requiredFor || [],
            userFacingReasonKey: spec.userFacingReasonKey || "",
            fallbackPolicy: spec.fallbackPolicy || "disable",
            grantTriggers: spec.grantTriggers || [],
            revokeEffects: spec.revokeEffects || [],
        });
    },

    /**
     * Request a permission. Returns { ok, reason, fallback }.
     * @param {string} permission
     * @param {{ tabId?: number, documentId?: string, userIntentToken?: string }} context
     * @returns {Promise<{ ok: boolean, reason?: string, fallback?: string }>}
     */
    async request(permission, context = {}) {
        const cap = _capabilities.get(permission);
        if (!cap) return { ok: false, reason: `undeclared-permission: ${permission}` };

        if (!cap.optional) return { ok: true };

        if (!context.userIntentToken) {
            return {
                ok: false,
                reason: "user-intent-required",
                fallback: cap.fallbackPolicy,
            };
        }

        try {
            const granted = await chrome.permissions.request({ permissions: [permission] });
            if (!granted) {
                return {
                    ok: false,
                    reason: "user-denied",
                    fallback: cap.fallbackPolicy,
                };
            }
            return { ok: true };
        } catch (err) {
            return {
                ok: false,
                reason: `request-error: ${err.message}`,
                fallback: cap.fallbackPolicy,
            };
        }
    },

    /**
     * Check whether a permission is currently granted.
     * @param {string} permission
     * @returns {Promise<boolean>}
     */
    async contains(permission) {
        return chrome.permissions.contains({ permissions: [permission] });
    },

    /**
     * Remove a permission (least-privilege downgrade).
     * @param {string} permission
     * @returns {Promise<boolean>}
     */
    async remove(permission) {
        return chrome.permissions.remove({ permissions: [permission] });
    },

    /**
     * Get the capability declaration for a permission.
     * @param {string} permission
     * @returns {PermissionCapability|null}
     */
    get(permission) {
        return _capabilities.get(permission) || null;
    },
});
