/**
 * platform/chromium/js/request-context-authority.js
 *
 * Request initiator-chain authority for network decisions.
 *
 * Every network-facing decision receives a normalized context that
 * captures the full initiator chain: top origin, frame origin, initiator
 * origin, request origin, resource type, load context, redirect depth,
 * and policy revision. This prevents wrong decisions from looking only
 * at the request URL or active tab hostname.
 *
 * Usage:
 *   import { RequestContextAuthority } from "./request-context-authority.js";
 *   const ctx = RequestContextAuthority.create({ requestId, tabId, frameId, requestUrl });
 */

const _resourceTypeMap = {
    main_frame: "main_document",
    sub_frame: "sub_document",
    script: "script",
    stylesheet: "stylesheet",
    font: "font",
    image: "image",
    media: "media",
    websocket: "websocket",
    xmlhttprequest: "xhr",
    beacon: "beacon",
    ping: "ping",
    other: "other",
};

/**
 * Canonical load contexts.
 */
const _loadContextMap = {
    main_frame: "navigation",
    sub_frame: "navigation",
    script: "script-created",
    xmlhttprequest: "script-created",
    beacon: "script-created",
};

export const RequestContextAuthority = Object.freeze({
    /**
     * Create a normalized request context.
     * @param {{
     *   requestId: string,
     *   tabId: number,
     *   frameId: number,
     *   documentId?: string,
     *   requestUrl: string,
     *   requestOrigin?: string|null,
     *   initiatorOrigin?: string|null,
     *   topOrigin?: string|null,
     *   frameOrigin?: string|null,
     *   resourceType?: string,
     *   loadContext?: string,
     *   redirectDepth?: number,
     *   isUserInitiated?: boolean,
     *   isExtensionInitiated?: boolean,
     *   policyRevision?: string,
     * }} raw
     * @returns {object}
     */
    create(raw) {
        const resourceType = _resourceTypeMap[raw.resourceType] || "other";
        return {
            requestId: raw.requestId || "",
            tabId: raw.tabId || -1,
            frameId: raw.frameId || -1,
            documentId: raw.documentId || "",
            requestUrl: raw.requestUrl || "",
            requestOrigin: raw.requestOrigin || null,
            initiatorOrigin: raw.initiatorOrigin || null,
            topOrigin: raw.topOrigin || null,
            frameOrigin: raw.frameOrigin || null,
            resourceType,
            loadContext: raw.loadContext || _loadContextMap[raw.resourceType] || "other",
            redirectDepth: raw.redirectDepth || 0,
            isUserInitiated: raw.isUserInitiated || false,
            isExtensionInitiated: raw.isExtensionInitiated || false,
            policyRevision: raw.policyRevision || "",
        };
    },

    /**
     * Classify whether a request is third-party relative to the top origin.
     * @param {object} ctx - return value of create()
     * @returns {boolean}
     */
    isThirdParty(ctx) {
        if (!ctx.topOrigin || !ctx.requestOrigin) return false;
        try {
            const topHost = new URL(ctx.topOrigin).hostname;
            const reqHost = new URL(ctx.requestOrigin).hostname;
            return topHost !== reqHost && !reqHost.endsWith("." + topHost);
        } catch (_) {
            return false;
        }
    },
});
