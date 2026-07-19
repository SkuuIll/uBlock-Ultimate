/**
 * platform/chromium/js/dom-boundary-policy.js
 *
 * DOM boundary policy for content-script mutation limits.
 *
 * Defines what DOM mutation operations are allowed per frame based on
 * policy profile, frame type (main, sub, sandboxed, opaque), and
 * document lifecycle state. Mutable operations like style injection,
 * scriptlet injection, element picker, and CSS removal are gated here.
 *
 * Usage:
 *   import { DomBoundaryPolicy } from "./dom-boundary-policy.js";
 *   const ok = DomBoundaryPolicy.canMutateDom(framePolicy);
 */

export const DomBoundaryPolicy = Object.freeze({
    /**
     * Check whether DOM mutation is allowed for a frame policy.
     * @param {object} framePolicy - from FramePolicy
     * @returns {{ ok: boolean, reason?: string }}
     */
    canMutateDom(framePolicy) {
        if (!framePolicy) return { ok: false, reason: "no-policy" };
        if (framePolicy.observeOnly) return { ok: false, reason: "observe-only" };
        if (framePolicy.sandboxed && !framePolicy.allowSameOrigin) {
            return { ok: false, reason: "sandboxed-no-same-origin" };
        }
        return { ok: true };
    },

    /**
     * Check whether cosmetic filtering is allowed.
     * @param {object} framePolicy
     * @returns {boolean}
     */
    canInjectCosmetics(framePolicy) {
        return this.canMutateDom(framePolicy).ok;
    },

    /**
     * Check whether element picker/zapper is allowed.
     * @param {object} framePolicy
     * @returns {{ ok: boolean, reason?: string }}
     */
    canUsePicker(framePolicy) {
        if (!framePolicy) return { ok: false, reason: "no-policy" };
        if (framePolicy.observeOnly) return { ok: false, reason: "observe-only" };
        if (framePolicy.sandboxed) return { ok: false, reason: "sandboxed" };
        return { ok: true };
    },
});
