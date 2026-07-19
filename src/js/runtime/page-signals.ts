/**
 * src/js/runtime/page-signals.ts
 *
 * Privacy-preserving page signal collection (P2.8).
 * Collects only structural booleans/counts — no text content, form values,
 * chat messages, user identifiers, or raw query strings.
 *
 * Usage:
 *   const signals = collectPageSignals(document);
 */

const signalCache = new WeakMap<Document, ReturnType<typeof collectPageSignals>>();

export function collectPageSignals(doc: Document): Record<string, unknown> {
    if (!doc || !doc.body) return {};

    const cached = signalCache.get(doc);
    if (cached) return cached;

    const inputs = doc.querySelectorAll("input, textarea, [contenteditable]");
    const hasAuthForm = Array.from(inputs).some(el =>
        el.type === "password" || el.closest('form[action*="login"], form[action*="auth"]')
    );
    const hasPaymentForm = Array.from(inputs).some(el =>
        el.type === "password" && el.closest('form[action*="checkout"], form[action*="pay"], form[action*="payment"]')
    );

    const appRootSelectors = "#root, #app, #__next, main, .shell, [data-app-root]";
    const appRoots = doc.querySelectorAll(appRootSelectors);

    const videos = doc.querySelectorAll("video");

    let hasShadowRoots = false;
    const allElements = doc.querySelectorAll("*");
    for (let i = 0; i < allElements.length; i++) {
        if (allElements[i].shadowRoot) { hasShadowRoots = true; break; }
    }

    const result = {
        hasContentEditable: doc.querySelector("[contenteditable]") !== null,
        hasLargeAppRoot: appRoots.length > 0,
        hasAuthForm,
        hasPaymentForm,
        hasPrimaryVideo: videos.length > 0,
        hasManyShadowRoots: hasShadowRoots,
        inputCount: Math.min(inputs.length, 50),
        videoCount: Math.min(videos.length, 10),
        appRootCount: Math.min(appRoots.length, 10),
    };

    signalCache.set(doc, result);
    return result;
}
