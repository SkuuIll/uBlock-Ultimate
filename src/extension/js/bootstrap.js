/**
 * platform/chromium/js/bootstrap.js
 *
 * Policy-gated bootstrap loader.
 *
 * Manifest injects ONLY this file (plus lightweight vapi plumbing) on every
 * http/https page.  Bootstrap collects safe page-level signals, requests a
 * policy snapshot from the service worker, then dynamically loads only the
 * runtime layers the policy allows.
 *
 * This is the sole gatekeeper — no high-risk runtime (contentscript.js,
 * smart-content.js, video-adblock-generic.js) loads without policy approval.
 */

(async () => {
    if (typeof vAPI !== "object") return;

    /* ── 1. Wait for DOM before collecting signals ─────────────────────── */
    // At document_start, <body> elements are not yet parsed, so queries
    // like input[type="password"] or <video> return null.  Defer signal
    // collection until the document is interactive or ready.
    if (document.readyState === "loading") {
        await new Promise((r) =>
            document.addEventListener("DOMContentLoaded", r, { once: true }),
        );
    }

    /* ── 2. Collect bounded privacy-safe signals ───────────────────────── */
    const pageSignals = {
        hasContentEditable:
            document.querySelector("[contenteditable]") !== null,
        hasLargeAppRoot:
            document.querySelector("#root, #app, #__next, main, .shell") !== null,
        hasAuthForm:
            document.querySelector(
                'input[type="password"], form[action*="login"], form[action*="auth"]',
            ) !== null,
        hasPaymentForm:
            document.querySelector(
                'input[type="cc-number"], input[type="cc-exp"], input[autocomplete="cc-number"]',
            ) !== null,
        isArticle:
            document.querySelector("article") !== null ||
            document.querySelector('[role="article"]') !== null,
        isVideoPage:
            document.querySelector("video") !== null &&
            document.querySelector("video").clientWidth >= 320,
        metaViewport: document.querySelector('meta[name="viewport"]') !== null,
    };

    /* ── 3. Request atomic page activation ─────────────────────────────── */
    let activation;
    try {
        activation = await vAPI.messaging.send("contentscript", {
            what: "getPageActivation",
            url: location.href,
            hostname: location.hostname,
            pageSignals,
        });
    } catch (_) {
        return;
    }
    if (!activation || activation.ok === false) return;

    /* ── 4. Store policy + tokens for ISOLATED-world access ────────────── */
    self.__uborPagePolicy = activation.policy;
    self.__uborTokens = activation.tokens || {};

    /* ── 5. Layer injection handled by SW via chrome.scripting.executeScript ── */
    // The SW's getPageActivation handler:
    //   - resolves policy once
    //   - creates one PolicySnapshot
    //   - seeds tokens, revision, AND policy into MAIN world
    //   - injects capability-enforcer.js
    //   - injects approved runtime layers
    // Bootstrap no longer injects runtime files directly.
})();

/* ── 6. MAIN-world->SW postMessage bridge for capability validation ────── */
// The capability enforcer (MAIN world) communicates back to the SW via
// window.postMessage.  This ISOLATED-world listener picks up validation
// requests and forwards them through the vAPI messaging channel.
{
    const handler = async (event) => {
        if (event.source !== window) return;

        // ── 6a. Authorization query from MAIN world ──────────────────────
        // MAIN-world code posts { ubrAuth: { action, ... } }.
        // Bridge forwards to SW and posts result back to MAIN world.
        const msg = event.data;
        if (
            !msg ||
            typeof msg !== "object" ||
            !msg.ubrAuth
        ) return;

        event.stopImmediatePropagation();

        const authRequest = msg.ubrAuth;
        try {
            const response = await vAPI.messaging.send("contentscript", {
                what: "validateAction",
                action: authRequest.action,
                layer: authRequest.layer,
                tabId: typeof vAPI !== "undefined" ? vAPI.tabId : undefined,
                frameId: typeof vAPI !== "undefined" ? vAPI.frameId : undefined,
                details: authRequest.details,
            });
            window.postMessage(
                { ubrAuthResponse: { id: authRequest.id, ...response } },
                self.location.origin,
            );
        } catch (_) {
            window.postMessage(
                { ubrAuthResponse: { id: authRequest.id, allowed: false } },
                self.location.origin,
            );
        }
    };

    self.addEventListener("message", handler, { passive: true });
}
