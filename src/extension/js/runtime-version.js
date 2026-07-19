/**
 * platform/chromium/js/runtime-version.js
 *
 * Service-worker/content-script version handshake and stale-runtime
 * quarantine.
 *
 * Every content script announces its runtime protocol version before
 * requesting mutation-capable policy. The service worker rejects or
 * quarantines stale protocol versions and downgrades them to
 * observe-only.
 *
 * Usage:
 *   import { RuntimeVersion } from "./runtime-version.js";
 *   const handshake = RuntimeVersion.createHandshake();
 *   const ok = RuntimeVersion.validateHandshake(handshake);
 */

const RUNTIME_PROTOCOL_VERSION = 1;

let _minAcceptedProtocol = RUNTIME_PROTOCOL_VERSION;

export const RuntimeVersion = Object.freeze({
    /** Current runtime protocol version. */
    get protocolVersion() { return RUNTIME_PROTOCOL_VERSION; },

    /** Minimum protocol version accepted by the service worker. */
    get minAcceptedProtocol() { return _minAcceptedProtocol; },

    /**
     * Set the minimum accepted protocol version (e.g. after extension update).
     * @param {number} v
     */
    setMinAcceptedProtocol(v) {
        _minAcceptedProtocol = v;
    },

    /**
     * Create a runtime handshake object for the current extension context.
     * @param {object} [overrides]
     * @returns {{
     *   extensionVersion: string,
     *   runtimeProtocolVersion: number,
     *   contentBundleId: string,
     *   documentId?: string,
     *   frameId: number,
     *   policyRevision: number,
     * }}
     */
    createHandshake(overrides = {}) {
        return {
            extensionVersion: overrides.extensionVersion || "",
            runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            contentBundleId: overrides.contentBundleId || "",
            documentId: overrides.documentId,
            frameId: overrides.frameId || 0,
            policyRevision: overrides.policyRevision || 0,
        };
    },

    /**
     * Validate a handshake from a content script.
     * Returns { ok, reason } where reason describes the failure.
     * @param {object} handshake
     * @returns {{ ok: boolean, reason?: string, quarantine?: boolean }}
     */
    validateHandshake(handshake) {
        if (!handshake || typeof handshake !== "object") {
            return { ok: false, reason: "invalid-handshake" };
        }

        const rpv = handshake.runtimeProtocolVersion;
        if (typeof rpv !== "number" || rpv < _minAcceptedProtocol) {
            return {
                ok: false,
                reason: `stale-protocol: ${rpv} < ${_minAcceptedProtocol}`,
                quarantine: true,
            };
        }

        if (rpv > RUNTIME_PROTOCOL_VERSION) {
            return {
                ok: false,
                reason: `future-protocol: ${rpv} > ${RUNTIME_PROTOCOL_VERSION}`,
                quarantine: true,
            };
        }

        return { ok: true };
    },

    /**
     * Check whether a handshake is stale enough to require quarantine
     * (observe-only downgrade).
     * @param {object} handshake
     * @returns {boolean}
     */
    requiresQuarantine(handshake) {
        const result = this.validateHandshake(handshake);
        return result.quarantine === true;
    },
});
