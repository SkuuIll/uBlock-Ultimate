/**
 * platform/chromium/js/sender-envelope.js
 *
 * Authenticated sender envelopes for every extension message.
 *
 * Every message handled by the service worker should carry a verifiable
 * sender envelope that describes who sent it, from which execution
 * context, with what protocol version.  The envelope is derived by
 * trusted code (not accepted as user-controlled message data).
 *
 * Usage:
 *   import { SenderEnvelope } from "./sender-envelope.js";
 *   const envelope = SenderEnvelope.fromSender(sender);
 *   if (!envelope) return;
 *   if (envelope.senderKind === "content-script") { ... }
 */

// ---------------------------------------------------------------------------
// Sender kind constants
// ---------------------------------------------------------------------------

const SENDER_KIND = Object.freeze({
    SERVICE_WORKER: "service-worker",
    CONTENT_SCRIPT: "content-script",
    POPUP: "popup",
    DASHBOARD: "dashboard",
    LOGGER: "logger",
    OPTIONS: "options",
    EXTENSION_PAGE: "extension-page",
    MAIN_WORLD_BRIDGE: "main-world-bridge",
    CONTEXT_MENU: "context-menu",
    COMMAND: "command",
    UNKNOWN: "unknown",
});

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

const _extensionOrigin = (() => {
    try {
        if (typeof browser !== "undefined" && browser.runtime && browser.runtime.getURL) {
            return new URL(browser.runtime.getURL("/")).origin;
        }
    } catch (_) { /* not in extension context */ }
    return "chrome-extension://unknown";
})();

// ---------------------------------------------------------------------------
// SenderEnvelope builder
// ---------------------------------------------------------------------------

export const SenderEnvelope = {
    SENDER_KIND,

    /**
     * Build a SenderEnvelope from a browser `sender` object (from
     * runtime.onMessage or runtime.onConnect).
     *
     * @param {object} sender - runtime.MessageSender
     * @param {object} [opts]
     * @param {string} [opts.routeId]
     * @param {string} [opts.nonce]
     * @returns {object|null} envelope or null if sender is invalid
     */
    fromSender(sender, opts = {}) {
        if (!sender) return null;

        const url = sender.url || "";
        const origin = sender.origin || "";
        const isExtensionPage = url.startsWith(_extensionOrigin) || origin === _extensionOrigin;

        let senderKind;
        if (sender.id === browser.runtime.id && isExtensionPage) {
            // Determine which extension page based on URL
            if (url.includes("/popup")) senderKind = SENDER_KIND.POPUP;
            else if (url.includes("/dashboard")) senderKind = SENDER_KIND.DASHBOARD;
            else if (url.includes("/logger")) senderKind = SENDER_KIND.LOGGER;
            else if (url.includes("/options")) senderKind = SENDER_KIND.OPTIONS;
            else senderKind = SENDER_KIND.EXTENSION_PAGE;
        } else if (sender.tab && sender.frameId !== undefined) {
            senderKind = SENDER_KIND.CONTENT_SCRIPT;
        } else {
            senderKind = SENDER_KIND.UNKNOWN;
        }

        const runtimeProtocolVersion = "1.0";  // bumped on protocol changes

        return Object.freeze({
            senderKind,
            extensionOrigin: _extensionOrigin,
            tabId: sender.tab ? sender.tab.id : undefined,
            frameId: sender.frameId,
            documentId: sender.documentId,
            pageOrigin: (sender.tab && sender.url) ? new URL(sender.url).origin : undefined,
            routeId: opts.routeId,
            runtimeProtocolVersion,
            issuedAt: Date.now(),
            nonce: opts.nonce,
        });
    },

    /**
     * Build a SenderEnvelope for an internal (service-worker-originated) action.
     */
    fromInternal(action, opts = {}) {
        return Object.freeze({
            senderKind: SENDER_KIND.SERVICE_WORKER,
            extensionOrigin: _extensionOrigin,
            routeId: action,
            runtimeProtocolVersion: "1.0",
            issuedAt: Date.now(),
        });
    },

    /**
     * Build a SenderEnvelope for a context-menu action.
     */
    fromContextMenu(tabId, opts = {}) {
        return Object.freeze({
            senderKind: SENDER_KIND.CONTEXT_MENU,
            extensionOrigin: _extensionOrigin,
            tabId,
            runtimeProtocolVersion: "1.0",
            issuedAt: Date.now(),
        });
    },

    /**
     * Build a SenderEnvelope for a command (keyboard shortcut).
     */
    fromCommand(commandName, tabId) {
        return Object.freeze({
            senderKind: SENDER_KIND.COMMAND,
            extensionOrigin: _extensionOrigin,
            tabId,
            commandName,
            runtimeProtocolVersion: "1.0",
            issuedAt: Date.now(),
        });
    },

    /**
     * Check whether a sender kind is allowed to perform a given action.
     * This is a simple ACL check.
     *
     * @param {object} envelope
     * @param {string[]} allowedKinds - list of SENDER_KIND values
     * @returns {boolean}
     */
    isAllowed(envelope, allowedKinds) {
        if (!envelope) return false;
        return allowedKinds.includes(envelope.senderKind);
    },

    /**
     * Check whether the sender is a content script.
     */
    isContentScript(envelope) {
        return envelope && envelope.senderKind === SENDER_KIND.CONTENT_SCRIPT;
    },

    /**
     * Check whether the sender is from trusted extension UI (popup, dashboard, etc.).
     */
    isTrustedUI(envelope) {
        if (!envelope) return false;
        return [
            SENDER_KIND.POPUP,
            SENDER_KIND.DASHBOARD,
            SENDER_KIND.LOGGER,
            SENDER_KIND.OPTIONS,
            SENDER_KIND.SERVICE_WORKER,
            SENDER_KIND.CONTEXT_MENU,
            SENDER_KIND.COMMAND,
        ].includes(envelope.senderKind);
    },
};
