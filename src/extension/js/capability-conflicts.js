/**
 * platform/chromium/js/capability-conflicts.js
 *
 * Capability conflict detection and resolution.
 *
 * Tracks known conflicts between extension capabilities (e.g., two
 * subsystems trying to register the same webRequest listener, or one
 * feature requiring a permission another feature will revoke). Emits
 * policy invalidations when conflicts are detected.
 *
 * Usage:
 *   import { CapabilityConflicts } from "./capability-conflicts.js";
 *   CapabilityConflicts.declare("webRequest-tracking", { exclusive: true, conflictsWith: ["webRequest-other"] });
 *   const conflict = CapabilityConflicts.check("webRequest-tracking", "webRequest-other");
 */

const _declarations = new Map();

export const CapabilityConflicts = Object.freeze({
    /**
     * Declare a capability's conflict properties.
     * @param {string} id
     * @param {{ exclusive?: boolean, conflictsWith?: string[], requires?: string[] }} spec
     */
    declare(id, spec) {
        _declarations.set(id, {
            id,
            exclusive: spec.exclusive || false,
            conflictsWith: spec.conflictsWith || [],
            requires: spec.requires || [],
        });
    },

    /**
     * Check whether enabling two capabilities would cause a conflict.
     * @param {string} idA
     * @param {string} idB
     * @returns {{ conflict: boolean, reason?: string }}
     */
    check(idA, idB) {
        const a = _declarations.get(idA);
        const b = _declarations.get(idB);
        if (!a || !b) return { conflict: false };

        if (a.conflictsWith.includes(idB) || b.conflictsWith.includes(idA)) {
            return { conflict: true, reason: `${idA} conflicts with ${idB}` };
        }

        return { conflict: false };
    },

    /**
     * Check all capabilities against each other and return conflicts.
     * @param {string[]} activeIds
     * @returns {object[]}
     */
    checkAll(activeIds) {
        const conflicts = [];
        for (let i = 0; i < activeIds.length; i++) {
            for (let j = i + 1; j < activeIds.length; j++) {
                const result = this.check(activeIds[i], activeIds[j]);
                if (result.conflict) conflicts.push({ idA: activeIds[i], idB: activeIds[j], reason: result.reason });
            }
        }
        return conflicts;
    },
});
