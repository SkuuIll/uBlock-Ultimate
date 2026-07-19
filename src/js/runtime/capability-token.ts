/**
 * src/js/runtime/capability-token.ts
 *
 * Capability tokens for mutation APIs (P2.10).
 * Mutation functions require a valid token from the policy resolver.
 * No token means no mutation. Expired token means downgrade to observe-only.
 *
 * Usage:
 *   const token = createCapabilityToken("video", tabId, frameId, policyRevision);
 *   if (!isTokenValid(token, "video", tabId, frameId)) return; // downgrade to observe-only
 */

let tokenCounter = 0;

export function createCapabilityToken(
    layer: string,
    tabId: number,
    frameId: number,
    policyRevision: number,
) {
    const now = Date.now();
    tokenCounter++;
    return {
        id: `${now}-${tokenCounter}`,
        layer,
        tabId,
        frameId,
        policyRevision,
        issuedAt: now,
        expiresAt: now + 30000, // 30-second expiry
    };
}

export function isTokenValid(
    token: any,
    expectedLayer: string,
    expectedTabId?: number,
    expectedFrameId?: number,
) {
    if (!token) return false;
    if (token.layer !== expectedLayer) return false;
    if (expectedTabId !== undefined && token.tabId !== expectedTabId) return false;
    if (expectedFrameId !== undefined && token.frameId !== expectedFrameId) return false;
    if (Date.now() > token.expiresAt) return false;
    return true;
}
