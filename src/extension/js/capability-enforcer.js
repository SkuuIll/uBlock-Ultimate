/**
 * platform/chromium/js/capability-enforcer.js
 *
 * Capability token gate for both MAIN and ISOLATED worlds.
 *
 * Injected by the service worker into every frame that passes policy gating,
 * BEFORE any high-risk runtime layer loads.
 *
 * == ISOLATED world ==
 *   - Has chrome.runtime.sendMessage for direct SW messaging.
 *   - Provides validate() for async, authoritative SW authorization.
 *   - Tokens (__uborTokens, __uborPolicyRevision) are seeded by SW.
 *
 * == MAIN world ==
 *   - Does NOT have chrome.runtime.sendMessage.
 *   - validate() is NOT available — MAIN-world code MUST NOT make
 *     authorization decisions based on page-interactable channels.
 *   - Only provides check(layer) synchronous fast-path using tokens
 *     that the SW seeded before page code ran.
 *
 * == Hostile pre-defence ==
 *   If __ubrCapability already exists as non-configurable when we
 *   try to install, we check whether it's our own prior installation
 *   by verifying that the capability object carries an installation ID
 *   matching the one in __ubrCapabilityInstalled.  A page cannot forge
 *   this because both properties are non-configurable and installed
 *   atomically at document_start before page code runs.
 */

(function() {
    "use strict";

    // ── Hostile predefinition detection ────────────────────────────────
    const existingDesc = Object.getOwnPropertyDescriptor(self, "__ubrCapability");

    if (existingDesc && existingDesc.configurable === false) {
        // Existing non-configurable capability — check if it's ours.
        // Our capability object has a non-enumerable installId property.
        // The marker property __ubrCapabilityInstalled holds the same value.
        // A page cannot forge both simultaneously because they're installed
        // atomically as non-configurable properties before page code runs.
        const existingCap = existingDesc.value;
        const markerDesc = Object.getOwnPropertyDescriptor(self, "__ubrCapabilityInstalled");

        const existingInstallId = existingCap && typeof existingCap === 'object' && existingCap.installId;
        const markerInstallId = markerDesc && markerDesc.value;

        if (existingInstallId &&
            typeof existingInstallId === 'string' &&
            existingInstallId === markerInstallId) {
            // Legitimate re-injection — our own install from an earlier
            // activation. Skip without setting the tamper sentinel.
            return;
        }

        // Non-configurable __ubrCapability without matching installId —
        // assume hostile predefinition. Set tamper sentinel and fail closed.
        try {
            Object.defineProperty(self, "__ubrCapabilityTampered", {
                value: true,
                configurable: false,
                writable: false,
            });
        } catch (_) {}
        return;
    }

    // Remove a configurable predefinition so we can install the real one.
    if (existingDesc) {
        try { delete self.__ubrCapability; } catch (_) { return; }
    }

    // Generate a unique installation ID for this injection.
    // This is embedded in the capability object and mirrored in the
    // __ubrCapabilityInstalled marker. A page cannot predict or forge
    // the matching pair because both are installed non-configurably
    // before page code executes.
    const installId = crypto.randomUUID();

    // ── Token helpers ──────────────────────────────────────────────────
    function _tokens() { return self.__uborTokens || {}; }
    function _revision() { return self.__uborPolicyRevision; }

    // ── SW messaging availability ──────────────────────────────────────
    // Only the ISOLATED-world enforcer instance may use SW messaging: it runs
    // in a context the page cannot patch.  The MAIN-world instance shares the
    // page's global object, so its chrome.runtime.sendMessage is forgeable and
    // must never be used for authorisation.  The SW stamps __ubrEnforcerIsolated
    // on the ISOLATED window before injecting the enforcer there; the static
    // MAIN-world instance never receives that marker.
    const isIsolated = self.__ubrEnforcerIsolated === true;
    const hasSWMessaging = isIsolated &&
        typeof chrome !== 'undefined' &&
        chrome.runtime && typeof chrome.runtime.sendMessage === 'function';

    // ── Capability object (shared shape for both worlds) ───────────────
    const capability = Object.freeze(Object.defineProperties({
        /**
         * Synchronous fast-path check:
         *   token exists for layer  AND  revision matches.
         * Page-forgeable (reads __uborTokens / __uborPolicyRevision) but
         * catches token-absent/revision-stale early.
         */
        isFresh: function(layer) {
            const tokens = _tokens();
            const token = tokens[layer];
            if (!token) return false;
            if (token.revision !== _revision()) return false;
            // Enforce the locally verifiable lease expiry.  Tokens carry an
            // `expiresAt` timestamp; once it passes the token is dead even
            // though the revision still matches.  This prevents a one-minute
            // SW lease from silently becoming a document-lifetime lease.
            if (typeof token.expiresAt === "number" && Date.now() > token.expiresAt) {
                return false;
            }
            return true;
        },

        check: function(layer) {
            return this.isFresh(layer);
        },

        /**
         * Asynchronous SW-authorised validation.
         *
         * Usage: validate(layer, action) → Promise<boolean>
         *
         * ISOLATED world: uses chrome.runtime.sendMessage with the
         *   channel-wrapper format required by the SW dispatcher.
         * MAIN world: **NOT AVAILABLE** — returns Promise.resolve(false).
         *   The MAIN-world instance shares the page's global object, so its
         *   chrome.runtime.sendMessage is forgeable by the page and cannot
         *   serve as an authentication channel.  Authorisation in the MAIN
         *   world instead relies on non-configurable, non-writable booleans
         *   (e.g. __ubrInterceptorAuthorized) set by the SW at injection time.
         */
        validate: function(layer, action) {
            if (!hasSWMessaging) {
                // MAIN world — no forgeable bridge.  Refuse authorisation.
                return Promise.resolve(false);
            }
            // ISOLATED world — direct SW messaging via channel-wrapper format
            return new Promise(function(resolve) {
                chrome.runtime.sendMessage({
                    channel: "contentscript",
                    msg: {
                        what: "validateCapability",
                        layer: layer,
                        action: action,
                    },
                }).then(function(result) {
                    if (result && result.renewedToken) {
                        // Store renewed token locally so subsequent
                        // isFresh() / check() calls work without an
                        // SW round-trip.
                        const tokens = self.__uborTokens || {};
                        tokens[result.renewedToken.layer] = result.renewedToken;
                        self.__uborTokens = tokens;
                        if (result.revision != null) {
                            self.__uborPolicyRevision = result.revision;
                        }
                    }
                    resolve(result && result.ok === true && result.authorized === true);
                }).catch(function() {
                    resolve(false);
                });
            });
        },

        getPagePolicy: function() {
            return self.__uborPagePolicy || null;
        },

        getPolicyRevision: function() {
            return _revision();
        },

        hasStaleTokens: function() {
            const rev = _revision();
            if (rev == null) return Object.keys(_tokens()).length > 0;
            const tokens = _tokens();
            for (const layer in tokens) {
                if (tokens.hasOwnProperty && tokens.hasOwnProperty(layer) && tokens[layer].revision !== rev) return true;
            }
            return false;
        },
    }, {
        // Non-enumerable installation ID — cannot be forged by page
        // because the capability object is frozen and non-configurable.
        installId: {
            value: installId,
            writable: false,
            enumerable: false,
            configurable: false,
        },
    }));

    // ── Install ────────────────────────────────────────────────────────
    try {
        Object.defineProperty(self, "__ubrCapability", {
            value: capability,
            configurable: false,
            writable: false,
        });

        // Set installation marker with the same installId.
        // Both properties are non-configurable; page cannot modify
        // either after installation.
        Object.defineProperty(self, "__ubrCapabilityInstalled", {
            value: installId,
            configurable: false,
            writable: false,
        });
    } catch (_) {
        // Define failed — an incompatible property exists.
        // Try to set the tamper sentinel for downstream detection.
        try {
            Object.defineProperty(self, "__ubrCapabilityTampered", {
                value: true,
                configurable: false,
                writable: false,
            });
        } catch (_) {}
    }
})();