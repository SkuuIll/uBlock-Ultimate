/**
 * src/js/runtime/protected-ui.ts
 *
 * Generalized protected UI detection for all mutation layers.
 * Prevents generic rules from hiding/removing/neutralizing essential
 * app UI elements. No site-specific logic.
 *
 * Usage:
 *   import { isProtectedAppUi } from "./protected-ui.js";
 *
 *   if (isProtectedAppUi(element)) return; // skip mutation
 */

export function isProtectedAppUi(element) {
    if (!element || !(element instanceof Element)) return true;

    const tag = element.tagName.toLowerCase();

    // Core structural elements
    if (["html", "body", "main", "header", "nav", "form"].includes(tag)) {
        return true;
    }

    // Media elements should not be hidden generically
    if (["video", "audio"].includes(tag)) {
        return true;
    }

    // Input/control elements
    if (["input", "textarea", "select", "button"].includes(tag)) {
        if (element.closest("form")) return true;
    }

    // Contenteditable and rich interaction zones
    if (element.getAttribute("contenteditable") === "true") {
        return true;
    }

    // ARIA application/dialog/modal roots
    const role = element.getAttribute("role");
    if (role && ["application", "dialog", "alertdialog", "main"].includes(role.toLowerCase())) {
        return true;
    }

    // Extension-owned UI
    if (element.hasAttribute("data-ubr-owned") ||
        element.hasAttribute("data-ubr-extension-ui") ||
        element.hasAttribute("data-ubr-video-ad-hidden")) {
        return true;
    }

    // Large viewport containers (likely app shell)
    const rect = element.getBoundingClientRect();
    const viewportArea = window.innerWidth * window.innerHeight;
    if (viewportArea > 0 && rect.width * rect.height / viewportArea > 0.35) {
        return true;
    }

    return false;
}
