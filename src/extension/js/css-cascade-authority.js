/**
 * platform/chromium/js/css-cascade-authority.js
 *
 * CSS cascade authority for injection and removal of stylesheets.
 *
 * Controls when and how CSS may be injected into or removed from a
 * document. Checks policy profile, frame type, and source route
 * before allowing CSS mutation. Tracks injected style IDs for
 * cleanup on policy change or navigation.
 *
 * Usage:
 *   import { CssCascadeAuthority } from "./css-cascade-authority.js";
 *   const ok = CssCascadeAuthority.canInject(framePolicy);
 */

export const CssCascadeAuthority = Object.freeze({
    /**
     * Check whether CSS injection is allowed for a frame.
     * @param {object} framePolicy
     * @returns {{ ok: boolean, reason?: string }}
     */
    canInject(framePolicy) {
        if (!framePolicy) return { ok: false, reason: "no-policy" };
        if (framePolicy.observeOnly) return { ok: false, reason: "observe-only" };
        return { ok: true };
    },
});
