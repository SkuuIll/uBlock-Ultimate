/**
 * platform/chromium/js/message-contracts.js
 *
 * Command/message contract registry for service-worker dispatch.
 *
 * Every `msg.what` handler declares a contract describing its allowed
 * senders, mutation intent, policy-readiness requirement, and payload
 * schema. The service-worker dispatcher validates incoming messages
 * against their contract before routing to the handler.
 *
 * Usage:
 *   import { MessageContracts } from "./message-contracts.js";
 *   MessageContracts.define("toggleFilterList", {
 *     allowedSenders: ["dashboard", "popup"],
 *     mutation: true,
 *     requiresPolicyReady: true,
 *   });
 *   const result = MessageContracts.authorize({ what: "toggleFilterList", sender });
 */

const _contracts = new Map();

export const MessageContracts = Object.freeze({
    /**
     * @param {string} what
     * @param {{
     *   channel?: string,
     *   allowedSenders: ("content"|"popup"|"dashboard"|"logger"|"extension-page")[],
     *   mutation: boolean,
     *   requiresPolicyReady: boolean,
     *   requiresTab?: boolean,
     *   schema?: unknown,
     * }} spec
     */
    define(what, spec) {
        if (_contracts.has(what)) throw new Error(`Duplicate contract: ${what}`);
        _contracts.set(what, {
            what,
            channel: spec.channel || "",
            allowedSenders: spec.allowedSenders || [],
            mutation: spec.mutation !== false,
            requiresPolicyReady: spec.requiresPolicyReady !== false,
            requiresTab: spec.requiresTab || false,
            schema: spec.schema || null,
        });
    },

    /**
     * Check whether a sender is allowed to dispatch the given message.
     * @param {{ what: string, sender?: { tab?: {}, frameId?: number, origin?: string } }} msg
     * @param {string} senderType
     * @param {boolean} policyReady
     * @returns {{ ok: boolean, reason?: string }}
     */
    authorize(msg, senderType, policyReady) {
        const contract = _contracts.get(msg.what);
        if (!contract) return { ok: false, reason: `no-contract: ${msg.what}` };

        if (contract.allowedSenders.length > 0 && !contract.allowedSenders.includes(senderType)) {
            return { ok: false, reason: `sender-not-allowed: ${senderType}` };
        }
        if (contract.requiresPolicyReady && !policyReady) {
            return { ok: false, reason: "policy-not-ready" };
        }
        if (contract.mutation && !policyReady) {
            return { ok: false, reason: "mutation-without-policy" };
        }
        return { ok: true };
    },

    /**
     * Return the contract for a given `what`, or null.
     */
    get(what) {
        return _contracts.get(what) || null;
    },

    /**
     * Iterate all registered contracts.
     */
    entries() {
        return _contracts.entries();
    },
});
