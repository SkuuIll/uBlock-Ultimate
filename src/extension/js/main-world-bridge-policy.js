/**
 * platform/chromium/js/main-world-bridge-policy.js
 *
 * Main-world bridge authority with nonce-bound handshakes.
 *
 * Defines when, how, and to whom a main-world communication bridge may
 * be opened. Every bridge is bound to a specific tab/frame/document,
 * gets a one-time nonce, and expires after navigation or policy revision.
 * The page-world side never receives broad extension state.
 *
 * Usage:
 *   import { MainWorldBridgePolicy } from "./main-world-bridge-policy.js";
 *   const bridge = MainWorldBridgePolicy.issue({ tabId, frameId, documentId, pageOrigin, policyRevision });
 *   if (MainWorldBridgePolicy.validate(bridge, { nonce, documentId })) { ... }
 */

import { idAuthority } from "./id-authority.js";
import { timeAuthority } from "./time-authority.js";

const _activeBridges = new Map();
const BRIDGE_TTL_MS = 300_000;

/**
 * @typedef {{
 *   bridgeId: string,
 *   tabId: number,
 *   frameId: number,
 *   documentId: string,
 *   pageOrigin: string,
 *   policyRevision: string,
 *   allowedMessages: string[],
 *   nonce: string,
 *   expiresAt: number,
 *   observeOnly: boolean,
 * }} MainWorldBridgePolicy
 */

function _generateNonce() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let result = "";
    for (let i = 0; i < 16; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

export const MainWorldBridgePolicy = Object.freeze({
    /**
     * Issue a new bridge policy for a frame.
     * @param {{
     *   tabId: number,
     *   frameId: number,
     *   documentId: string,
     *   pageOrigin: string,
     *   policyRevision: string,
     *   allowedMessages?: string[],
     *   observeOnly?: boolean,
     * }} spec
     * @returns {MainWorldBridgePolicy}
     */
    issue(spec) {
        const bridgeId = idAuthority.allocate("main-world-bridge");
        const nonce = _generateNonce();
        const bridge = {
            bridgeId,
            tabId: spec.tabId,
            frameId: spec.frameId,
            documentId: spec.documentId,
            pageOrigin: spec.pageOrigin,
            policyRevision: spec.policyRevision,
            allowedMessages: spec.allowedMessages || ["getCosmetics", "getScriptlets", "reportFrame"],
            nonce,
            expiresAt: timeAuthority.nowMs() + BRIDGE_TTL_MS,
            observeOnly: spec.observeOnly || false,
        };

        const key = `${spec.tabId}:${spec.frameId}:${spec.documentId}`;
        _activeBridges.set(key, bridge);
        return bridge;
    },

    /**
     * Validate an incoming message against an active bridge.
     * @param {MainWorldBridgePolicy} bridge
     * @param {{ nonce: string, documentId: string, message: string }} msg
     * @returns {{ ok: boolean, reason?: string }}
     */
    validate(bridge, msg) {
        if (!bridge) return { ok: false, reason: "no-bridge" };
        if (timeAuthority.nowMs() > bridge.expiresAt) {
            return { ok: false, reason: "bridge-expired" };
        }
        if (bridge.nonce !== msg.nonce) {
            return { ok: false, reason: "nonce-mismatch" };
        }
        if (bridge.documentId !== msg.documentId) {
            return { ok: false, reason: "document-mismatch" };
        }
        if (bridge.allowedMessages.length > 0 && !bridge.allowedMessages.includes(msg.message)) {
            return { ok: false, reason: "message-not-allowed" };
        }
        return { ok: true };
    },

    /**
     * Get an active bridge by tab/frame/document key.
     * @param {string} key - "tabId:frameId:documentId"
     * @returns {MainWorldBridgePolicy|null}
     */
    get(key) {
        return _activeBridges.get(key) || null;
    },

    /**
     * Revoke (remove) a bridge.
     * @param {string} key
     */
    revoke(key) {
        _activeBridges.delete(key);
    },

    /**
     * Revoke all bridges for a given tab.
     * @param {number} tabId
     */
    revokeTab(tabId) {
        for (const [key] of _activeBridges) {
            if (key.startsWith(`${tabId}:`)) _activeBridges.delete(key);
        }
    },

    /**
     * Revoke all expired bridges.
     */
    reapExpired() {
        const now = timeAuthority.nowMs();
        for (const [key, bridge] of _activeBridges) {
            if (now > bridge.expiresAt) _activeBridges.delete(key);
        }
    },
});
