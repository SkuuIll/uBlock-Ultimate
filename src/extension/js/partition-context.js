/**
 * platform/chromium/js/partition-context.js
 *
 * Partitioned storage and network-context authority.
 *
 * Provides one canonical context for partitioning decisions: top-level
 * site, frame site, initiator site, request site, effective site,
 * third-party status, profile mode, storage/cookie partition keys, and
 * opaque/sandboxed state. Every third-party/first-party decision,
 * cookie/header mutation, logger grouping, diagnostic redaction, and
 * cloud/backup eligibility check uses this context.
 *
 * Usage:
 *   import { PartitionContext } from "./partition-context.js";
 *   const ctx = PartitionContext.create({ topLevelSite, frameSite, requestSite, profileMode });
 *   if (ctx.thirdParty) { ... }
 *   if (ctx.profileMode === "incognito") { ... }
 */

import { effectiveSite } from "./effective-site.js";

function _normalizeSite(raw) {
    if (!raw) return "";
    try {
        const url = new URL(raw);
        return effectiveSite.effectiveSite(url.hostname) || url.hostname;
    } catch (_) {
        return raw;
    }
}

function _isThirdParty(topSite, requestSite) {
    if (!topSite || !requestSite) return false;
    return topSite !== requestSite && !requestSite.endsWith("." + topSite);
}

export const PartitionContext = Object.freeze({
    /**
     * Create a partition context.
     * @param {{
     *   topLevelSite: string,
     *   frameSite?: string,
     *   initiatorSite?: string,
     *   requestSite: string,
     *   profileMode?: "normal"|"incognito"|"private"|"managed",
     *   opaque?: boolean,
     *   sandboxed?: boolean,
     * }} raw
     * @returns {{
     *   topLevelSite: string,
     *   frameSite: string,
     *   initiatorSite: string,
     *   requestSite: string,
     *   effectiveSite: string,
     *   thirdParty: boolean,
     *   profileMode: string,
     *   storagePartitionKey: string,
     *   cookiePartitionKey: string,
     *   opaque: boolean,
     *   sandboxed: boolean,
     * }}
     */
    create(raw) {
        const topLevelSite = _normalizeSite(raw.topLevelSite);
        const frameSite = _normalizeSite(raw.frameSite || raw.topLevelSite);
        const initiatorSite = _normalizeSite(raw.initiatorSite || "");
        const requestSite = _normalizeSite(raw.requestSite);
        const profileMode = raw.profileMode || "normal";
        const opaque = raw.opaque || false;
        const sandboxed = raw.sandboxed || false;

        const storagePartitionKey = opaque
            ? `${profileMode}:opaque:${topLevelSite}`
            : `${profileMode}:${topLevelSite}`;

        const cookiePartitionKey = opaque
            ? `opaque:${topLevelSite}`
            : topLevelSite;

        return {
            topLevelSite,
            frameSite,
            initiatorSite,
            requestSite,
            effectiveSite: requestSite || topLevelSite,
            thirdParty: _isThirdParty(topLevelSite, requestSite),
            profileMode,
            storagePartitionKey,
            cookiePartitionKey,
            opaque,
            sandboxed,
        };
    },
});
