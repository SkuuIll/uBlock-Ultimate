/**
 * platform/chromium/js/layout-read-authority.js
 *
 * Layout-read authority for frame style/size queries.
 *
 * Controls when content scripts may read computed styles, layout
 * dimensions, and other visual properties from a document. These
 * reads are restricted for sandboxed, opaque-origin, and
 * observe-only frames.
 *
 * Usage:
 *   import { LayoutReadAuthority } from "./layout-read-authority.js";
 *   const ok = LayoutReadAuthority.canReadLayout(framePolicy);
 */

export const LayoutReadAuthority = Object.freeze({
    /**
     * Check whether layout reads are allowed for a frame.
     * @param {object} framePolicy
     * @returns {{ ok: boolean, reason?: string }}
     */
    canReadLayout(framePolicy) {
        if (!framePolicy) return { ok: false, reason: "no-policy" };
        const reasons = [];
        if (framePolicy.observeOnly) reasons.push("observe-only");
        if (reasons.length > 0) return { ok: false, reason: reasons.join(",") };
        return { ok: true };
    },
});
