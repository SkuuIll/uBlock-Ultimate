/**
 * src/js/runtime/frame-policy.ts
 *
 * Frame-policy inheritance for all_frames and about:blank.
 *
 * Usage:
 *   import { resolveFramePolicy } from "./frame-policy.js";
 *
 *   const framePolicy = resolveFramePolicy({
 *     frameId, parentFrameId, documentUrl, parentUrl,
 *     parentPolicy,
 *   });
 */

export function resolveFramePolicy(opts) {
    const {
        frameId,
        parentFrameId,
        documentUrl,
        parentUrl,
        parentPolicy,
    } = opts;

    const isTopFrame = parentFrameId === -1 || parentFrameId === undefined;
    const isAboutBlank = documentUrl === "about:blank" || documentUrl === "about:srcdoc";
    const isThirdParty = parentUrl && !isTopFrame && extractHostname(documentUrl) !== extractHostname(parentUrl);

    const inheritsParentPolicy = isAboutBlank || (!isThirdParty && !isTopFrame);

    let allowCosmetic;
    let allowScriptlets;
    let allowVideoMutation;

    if (inheritsParentPolicy && parentPolicy) {
        // Inherit from parent
        allowCosmetic = parentPolicy.cosmetic !== "off";
        allowScriptlets = parentPolicy.scriptlets !== "off";
        allowVideoMutation = parentPolicy.genericVideo !== "off" && !isThirdParty;
    } else if (isThirdParty) {
        // Third-party iframes get stricter policy
        allowCosmetic = false;
        allowScriptlets = false;
        allowVideoMutation = false;
    } else {
        // Top frame or unknown: use parent or default
        allowCosmetic = parentPolicy ? parentPolicy.cosmetic !== "off" : true;
        allowScriptlets = parentPolicy ? parentPolicy.scriptlets !== "off" : true;
        allowVideoMutation = false;
    }

    return {
        frameId,
        parentFrameId,
        documentUrl,
        parentUrl,
        effectiveUrl: isAboutBlank && parentUrl ? parentUrl : documentUrl,
        inheritsParentPolicy,
        allowCosmetic,
        allowScriptlets,
        allowVideoMutation,
    };
}

function extractHostname(url) {
    if (!url) return "";
    try {
        return new URL(url).hostname;
    } catch (_) {
        const match = url.match(/^(?:https?:\/\/)?([^\/?#:]+)/);
        return match ? match[1].toLowerCase() : "";
    }
}
