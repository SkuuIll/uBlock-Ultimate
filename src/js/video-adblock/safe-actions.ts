import type { SafeActionPlan } from "./site-adapters/adapter-types";
import { debugLog } from "./diagnostics";

export interface MutationCapabilities {
    hideElement: boolean;
    removeElement: boolean;
    neutralizeClick: boolean;
    skipClick: boolean;
    domMarking: boolean;
}

export const FULL_MUTATION_CAPABILITIES: MutationCapabilities = {
    hideElement: true,
    removeElement: true,
    neutralizeClick: true,
    skipClick: true,
    domMarking: true,
};

let currentCapabilities: MutationCapabilities = { ...FULL_MUTATION_CAPABILITIES };

// Replace the full capability set rather than merging, so a policy that omits
// (or sets false for) a field cannot inherit a stale default from a previous
// policy application.
export function setMutationCapabilities(caps: MutationCapabilities): void {
    currentCapabilities = { ...caps };
}

// Mutation ledger for tracking what was changed and how to reverse it (Items 64-67)
interface MutationRecord {
    element: Element;
    action: 'hide' | 'remove' | 'neutralize-click' | 'mark' | 'skip-click';
    reason: string;
    timestamp: number;
    token: DomToken;
    revert?(): void;
}
const mutationLedger: MutationRecord[] = [];

// CSS injection inventory (Item 136)
const cssInjectionInventory = new Map<string, { selector: string; layer: string; timestamp: number }>();

export function recordCssInjection(selector: string, layer: string): void {
    cssInjectionInventory.set(selector + '|' + layer, { selector, layer, timestamp: Date.now() });
}

export function getCssInjectionInventory() {
    return Array.from(cssInjectionInventory.values());
}

export function clearCssInjectionsForLayer(layer: string): void {
    for (const [key, record] of cssInjectionInventory) {
        if (record.layer === layer) cssInjectionInventory.delete(key);
    }
}

export function getMutationLedger(): readonly MutationRecord[] {
    return mutationLedger;
}

export function clearMutationLedger(): void {
    mutationLedger.length = 0;
}

// Synchronous fast-path authorization for read-only checks (e.g., deciding whether to scan)
export function isVideoAuthorized(): boolean {
    const cap = (self as any).__ubrCapability;
    if (!cap) return false;
    return cap.check("video");
}

function authorizeMutation(action: string, element: Element, reason: string): boolean {
    if (!currentCapabilities) return false;
    let allowed = false;
    switch (action) {
        case 'hide': allowed = currentCapabilities.hideElement !== false; break;
        case 'remove': allowed = currentCapabilities.removeElement !== false; break;
        case 'neutralize-click': allowed = currentCapabilities.neutralizeClick !== false; break;
        case 'skip-click': allowed = currentCapabilities.skipClick !== false; break;
        case 'mark': allowed = currentCapabilities.domMarking !== false; break;
        default: return false;
    }
    if (!allowed) return false;
    const cap = (self as any).__ubrCapability;
    if (!cap) return false; // fail closed: no enforcer means no video mutation allowed
    return cap.check("video");
}

// Log a mutation to the ledger for rollback (Item 65-67)
function recordMutation(action: MutationRecord['action'], element: Element, reason: string, revert?: () => void): void {
    const token = captureDomToken(element);
    if (mutationLedger.length > 1000) {
        const oldest = mutationLedger.shift();
        if (oldest?.revert) {
            try { oldest.revert(); } catch {}
        }
    }
    mutationLedger.push({ element, action, reason, timestamp: Date.now(), revert, token });
}

const HIDDEN_ATTR = "data-ubr-video-ad-hidden";
const PREV_STYLE_ATTR = "data-ubr-video-ad-prev-style";
const RESTORE_BATCH: Element[] = [];
const CLICK_NEUTRALIZED_ATTR = "data-ubr-video-ad-click-neutralized";
const clickNeutralized = new WeakSet<Element>();

// Protected UI guards — never hide/remove/neutralize these
const PROTECTED_SELECTORS = [
    "html", "body",
    "form", "input", "textarea", "select", "button",
    "[contenteditable]",
    "[role=dialog]", "[role=alertdialog]", "[role=form]",
    "[role=alert]", "[role=status]", "[role=log]", "[role=marquee]",
    "[role=progressbar]", "[role=timer]",
    "[aria-live]", "[aria-atomic=true]", "[aria-relevant]",
    "[autocomplete]",
    // Auth / payment / shell roots
    "[class*=login]", "[class*=signin]", "[class*=signup]", "[class*=auth]",
    "[class*=register]", "[class*=password]",
    "[class*=checkout]", "[class*=payment]", "[class*=cart]",
    "[id*=login]", "[id*=signin]", "[id*=signup]", "[id*=auth]",
    "[id*=checkout]", "[id*=payment]", "[id*=cart]",
    // Navigation
    "nav", "[role=navigation]", "[role=menubar]", "[role=tablist]",
    // Shell
    "#app", "#root", "#__next", "#__nuxt",
];

function isInsideClosedShadowRoot(element: Element): boolean {
    let el: Node | null = element;
    const doc = element.ownerDocument;
    while (el && el !== doc) {
        const root = el.getRootNode ? el.getRootNode() : null;
        if (root instanceof ShadowRoot && root.mode === "closed") return true;
        el = el.parentNode || (root instanceof ShadowRoot ? (root as ShadowRoot).host : null);
    }
    return false;
}

function isProtectedSiteUi(element: Element): boolean {
    if (isInsideClosedShadowRoot(element)) return true;

    for (const sel of PROTECTED_SELECTORS) {
        if (element.matches(sel)) return true;
    }

    const host = location.hostname.toLowerCase();

    if (
        host === "youtube.com" ||
        host.endsWith(".youtube.com") ||
        host === "youtube-nocookie.com" ||
        host.endsWith(".youtube-nocookie.com") ||
        host === "youtu.be" ||
        host.endsWith(".youtu.be")
    ) {
        if (
            element.closest("ytd-masthead") ||
            element.closest("#masthead") ||
            element.closest("#search") ||
            element.closest("ytd-searchbox") ||
            element.closest("#center") ||
            element.closest("#container.ytd-masthead")
        ) {
            return true;
        }
    }

    return false;
}

function isExtensionOwnedElement(element: Element): boolean {
    if (element.hasAttribute("data-ubol-overlay")) return true;
    if (element.hasAttribute("data-ubol-overlay-dialog")) return true;
    if (element.hasAttribute("data-ubr-extension-ui")) return true;
    const src = element.getAttribute("src") || "";
    if (src.startsWith("chrome-extension://") && (src.includes("/picker-ui.html") || src.includes("/zapper-ui.html"))) return true;
    return false;
}

function isActiveOrFocusedElement(element: Element): boolean {
    return element === document.activeElement ||
        element.contains(document.activeElement) ||
        element.getAttribute("aria-live") === "assertive" ||
        element.getAttribute("role") === "alert" ||
        element.getAttribute("role") === "status";
}

function hasAccessibleName(element: Element): boolean {
    if (element.hasAttribute("aria-label") && element.getAttribute("aria-label").trim()) return true;
    if (element.hasAttribute("aria-labelledby")) return true;
    return false;
}

function hasElementVideoOverlap(element: Element): boolean {
    const elemRect = element.getBoundingClientRect()
    const videos = document.querySelectorAll("video")
    for (const video of videos) {
        const videoRect = video.getBoundingClientRect()
        if (elemRect.left < videoRect.right && elemRect.right > videoRect.left &&
            elemRect.top < videoRect.bottom && elemRect.bottom > videoRect.top) {
            return true
        }
    }
    return false
}

function hasPointerTrapRisk(element: Element): boolean {
    // High z-index inside a video player container is expected for ad overlays (Item 225),
    // but only bypass for elements that are direct children of known player containers
    // and do not contain the actual video element.
    const parent = element.parentElement
    const isDirectPlayerChild = parent?.matches?.(".player-root, .video-container") ?? false
    const overlapsVideo = hasElementVideoOverlap(element)

    if (isDirectPlayerChild || overlapsVideo) {
        // Only bypass if this element does NOT contain a <video> (not the player itself)
        const containsVideo = element.querySelector("video");
        if (!containsVideo) return false;
    }
    const style = element instanceof HTMLElement ? getComputedStyle(element) : null;
    if (!style) return false;
    const zIndex = parseInt(style.zIndex || "0", 10);
    if (zIndex > 10000) return true;
    if (style.position === "fixed" || style.position === "absolute") {
        const rect = element.getBoundingClientRect();
        if (rect.width > window.innerWidth * 0.8 || rect.height > window.innerHeight * 0.8) {
            return true;
        }
    }
    return false;
}

function hasContrastRisk(element: Element): boolean {
    const style = element instanceof HTMLElement ? getComputedStyle(element) : null;
    if (!style) return false;
    if (style.forcedColorAdjust !== undefined && style.forcedColorAdjust !== "auto") return true;
    if (style.backgroundColor === "transparent" && element.querySelector("video, img, canvas, [role=img]")) {
        return true;
    }
    return false;
}

function isVirtualizedContainer(element: Element): boolean {
    // Virtualized list containers should not be classified as ad elements (Item 149)
    const role = element.getAttribute("role");
    if (role === "list" || role === "listbox" || role === "grid" || role === "row") {
        const children = element.children;
        // Virtualized lists have many similar children
        if (children.length > 5) {
            const tagSet = new Set<string>();
            for (let i = 0; i < Math.min(children.length, 20); i++) {
                tagSet.add(children[i].tagName);
            }
            if (tagSet.size <= 2) return true;
        }
    }
    return false;
}

function isShadowDomComponent(element: Element): boolean {
    // App-shell web components and custom elements (Item 150)
    const tagName = element.tagName || "";
    if (tagName.includes("-")) return true;
    const root = element.getRootNode ? element.getRootNode() : null;
    if (root instanceof ShadowRoot) return true;
    return false;
}

function hasExcessiveLayoutShift(element: Element): boolean {
    // Layout-shift budget check (Item 140)
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const parent = element.parentElement;
    if (!parent) return false;
    const parentRect = parent.getBoundingClientRect();
    if (parentRect.width === 0 || parentRect.height === 0) return false;
    const ratio = (rect.width * rect.height) / (parentRect.width * parentRect.height);
    return ratio > 0.3;
}

// Hostile DOM detection — elements that subvert ad-blocker heuristics (Items 220-223)
function isHostileDomElement(element: Element): boolean {
    const style = element instanceof HTMLElement ? getComputedStyle(element) : null;
    if (!style) return false;
    if (style.position === "fixed" && style.zIndex !== "auto" && Number(style.zIndex) > 9999) {
        if (element.matches(":empty") || (element.children.length === 0 && (element.textContent || "").trim() === "")) {
            return true;
        }
    }
    return false;
}

// Secure DOM token capture for safe reidentification (Item 215-218)
type DomToken = {
    id: string;
    tag: string;
    className: string;
    anchorId: string;
    depth: number;
    siblingIndex: number;
    capturedAt: number;
};

function captureDomToken(element: Element): DomToken {
    const parent = element.parentElement;
    const siblings = parent ? Array.from(parent.children) : [];
    return {
        id: element.id || "",
        tag: element.tagName.toLowerCase(),
        className: element.className && typeof element.className === "string" ? element.className : "",
        anchorId: parent?.id || parent?.getAttribute("data-ubr-anchor") || "",
        depth: 0,
        siblingIndex: parent ? siblings.indexOf(element) : -1,
        capturedAt: Date.now(),
    };
}

export function safelyHideElement(element: Element, reason: string): boolean {
    if (!(element instanceof Element)) return false;
    if (!authorizeMutation('hide', element, reason)) return false;
    if (isExtensionOwnedElement(element)) return false;
    if (isProtectedSiteUi(element)) return false;
    if (isActiveOrFocusedElement(element)) return false;
    if (hasPointerTrapRisk(element)) return false;
    if (hasContrastRisk(element)) return false;
    if (hasAccessibleName(element)) return false;
    if (isHostileDomElement(element)) return false;
    if (isVirtualizedContainer(element)) return false;
    if (isShadowDomComponent(element)) return false;
    if (hasExcessiveLayoutShift(element)) return false;

    const tag = element.tagName.toLowerCase();
    if (tag === "video" || tag === "body" || tag === "html") return false;

    if (element.hasAttribute(HIDDEN_ATTR)) return true;

    const el = element as HTMLElement;
    const prevStyle = element.getAttribute("style") || "";
    element.setAttribute(PREV_STYLE_ATTR, prevStyle);
    el.style.setProperty("display", "none", "important");
    element.setAttribute(HIDDEN_ATTR, "true");
    RESTORE_BATCH.push(element);
    // Record a revert that restores the EXACT previous style (audit Item 5),
    // not a blanket `display = ''` which would destroy a legitimate original
    // `display` (e.g. grid/flex).  It is idempotent with restoreHiddenVideoAds:
    // if the element was already un-hidden by that path, the HIDDEN_ATTR is
    // gone and we skip — so the shutdown order (stopVideoAdBlocker then
    // restoreAll) cannot clobber the restored inline style.
    recordMutation('hide', element, reason, () => {
        if (!element.hasAttribute(HIDDEN_ATTR)) return;
        const restored = element.getAttribute(PREV_STYLE_ATTR);
        if (restored !== null && restored !== "") {
            el.setAttribute("style", restored);
        } else {
            el.style.removeProperty("display");
        }
        element.removeAttribute(HIDDEN_ATTR);
        element.removeAttribute(PREV_STYLE_ATTR);
    });
    const selector = element.id
        ? `#${CSS.escape(element.id)}`
        : (element.className && typeof element.className === "string")
            ? element.className.split(/\s+/).filter(Boolean).map(c => `.${CSS.escape(c)}`).join("")
            : element.tagName.toLowerCase();
    recordCssInjection(selector, "video-adblock");
    debugLog("Hid element:", element.tagName, "#" + element.id, reason);
    return true;
}

export function safelyRemoveElement(element: Element, reason: string): boolean {
    if (!(element instanceof Element)) return false;
    if (!authorizeMutation('remove', element, reason)) return false;
    if (isExtensionOwnedElement(element)) return false;
    if (isProtectedSiteUi(element)) return false;
    if (isActiveOrFocusedElement(element)) return false;
    if (hasPointerTrapRisk(element)) return false;
    if (hasContrastRisk(element)) return false;
    if (hasAccessibleName(element)) return false;
    if (isHostileDomElement(element)) return false;
    if (isVirtualizedContainer(element)) return false;
    if (isShadowDomComponent(element)) return false;
    if (hasExcessiveLayoutShift(element)) return false;

    const tag = element.tagName.toLowerCase();
    if (tag === "video" || tag === "body" || tag === "html") return false;
    if (element.querySelector("video")) return false;

    const parent = element.parentNode;
    const next = element.nextSibling;
    element.remove();
    recordMutation('remove', element, reason, () => {
        if (parent && next) parent.insertBefore(element, next);
        else if (parent) parent.appendChild(element);
    });
    debugLog("Removed element:", element.tagName, "#" + element.id, reason);
    return true;
}

export function safelyMuteVideo(video: HTMLVideoElement, reason: string): boolean {
    if (!(video instanceof HTMLVideoElement)) return false;

    video.muted = true;
    debugLog("Muted video:", reason);
    return true;
}

export function safelyNeutralizeClickElement(element: Element, reason: string): boolean {
    if (!(element instanceof Element)) return false;
    if (!authorizeMutation('neutralize-click', element, reason)) return false;
    if (isExtensionOwnedElement(element)) return false;
    if (isProtectedSiteUi(element)) return false;

    const tag = element.tagName.toLowerCase();
    if (tag === "video" || tag === "body" || tag === "html") return false;
    if (element.contains(document.querySelector("video"))) return false;

    if (clickNeutralized.has(element)) return true;
    clickNeutralized.add(element);
    element.setAttribute(CLICK_NEUTRALIZED_ATTR, "true");

    const handler = (event: Event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        debugLog("Neutralized video-ad overlay click:", reason);
    };

    element.addEventListener("pointerdown", handler, true);
    element.addEventListener("mousedown", handler, true);
    element.addEventListener("click", handler, true);

    // Record a revert so restoreAll() (used on SW-ordered revocation) removes
    // the neutralization handlers rather than leaving them on the page.
    recordMutation('neutralize-click', element, reason, () => {
        element.removeEventListener("pointerdown", handler, true);
        element.removeEventListener("mousedown", handler, true);
        element.removeEventListener("click", handler, true);
        element.removeAttribute(CLICK_NEUTRALIZED_ATTR);
        clickNeutralized.delete(element);
    });

    return true;
}

const SKIP_CLICKED_ATTR = "data-ubr-video-ad-skip-clicked";
export const SKIP_RECLICK_COOLDOWN_MS = 1500;
const skipClickState = new WeakMap<Element, {
    lastClickedAt: number;
    lastReason: string;
}>();

function classOrIdLooksDisabled(element: HTMLElement): boolean {
    const cls = typeof element.className === "string" ? element.className : "";
    const id = element.id || "";
    const aria = element.getAttribute("aria-label") || "";
    const title = element.getAttribute("title") || "";
    const combined = `${cls} ${id} ${aria} ${title}`.toLowerCase().replace(/_/g, "-");

    return (
        combined.includes("disabled") ||
        combined.includes("disable") ||
        combined.includes("inactive") ||
        combined.includes("not-ready") ||
        combined.includes("notready") ||
        combined.includes("countdown") ||
        combined.includes("wait")
    );
}

export function safelyClickVisibleSkipControl(element: HTMLElement, reason: string): boolean {
    if (!(element instanceof HTMLElement)) return false;
    if (!authorizeMutation('skip-click', element, reason)) return false;
    if (isInsideClosedShadowRoot(element)) return false;
    if (element.closest("ytd-masthead")) return false;

    const tag = element.tagName.toLowerCase();
    if (tag === "video" || tag === "body" || tag === "html") return false;

    if (element.hasAttribute("disabled")) return false;
    if (element.getAttribute("aria-disabled") === "true") return false;
    if (classOrIdLooksDisabled(element)) return false;

    const now = Date.now();
    const prior = skipClickState.get(element);
    if (
        prior &&
        now - prior.lastClickedAt < SKIP_RECLICK_COOLDOWN_MS &&
        prior.lastReason === reason
    ) {
        return true;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 10) return false;

    const style = getComputedStyle(element);
    if (style.display === "none") return false;
    if (style.visibility === "hidden") return false;
    if (style.pointerEvents === "none") return false;
    if (Number(style.opacity || "1") < 0.1) return false;

    skipClickState.set(element, {
        lastClickedAt: now,
        lastReason: reason,
    });
    element.setAttribute(SKIP_CLICKED_ATTR, "true");

    debugLog("Clicking visible video-ad skip control:", reason);
    element.click();

    return true;
}

const MARKED_ATTR = "data-ubr-ad-marker";
const MARKER_CLASS_BASE = "ubr-ad-marker";
const MARKER_CLASS_SUFFIX = Math.random().toString(36).slice(2, 8);
const MARKED_CLASS = MARKER_CLASS_BASE + MARKER_CLASS_SUFFIX;

// Marker ledger for reversible class additions (Item 169)
const markerLedger = new WeakMap();

export function markElementAsAd(element: Element): void {
    if (!element || markerLedger.has(element)) return;
    const prevClass = element.getAttribute("class") || "";
    element.classList.add(MARKED_CLASS);
    element.setAttribute(MARKED_ATTR, "true");
    markerLedger.set(element, prevClass);
}

export function unmarkElement(element: Element): boolean {
    if (!markerLedger.has(element)) return false;
    const prevClass = markerLedger.get(element);
    element.classList.remove(MARKED_CLASS);
    element.removeAttribute(MARKED_ATTR);
    markerLedger.delete(element);
    return true;
}

function safelyMarkElement(element: Element, reason: string): boolean {
    if (!(element instanceof Element)) return false;
    if (!authorizeMutation('mark', element, reason)) return false;
    if (isExtensionOwnedElement(element)) return false;
    if (isProtectedSiteUi(element)) return false;
    if (isInsideClosedShadowRoot(element)) return false;
    if (element.hasAttribute(MARKED_ATTR)) return true;
    element.setAttribute(MARKED_ATTR, "true");
    element.classList.add(MARKED_CLASS);
    debugLog("Marked element:", element.tagName, reason);
    recordMutation('mark', element, reason, () => {
        element.removeAttribute(MARKED_ATTR);
        element.classList.remove(MARKED_CLASS);
        markerLedger.delete(element);
    });
    return true;
}

export interface SafeActionResult {
    hidden: number;
    removed: number;
    marked: number;
    neutralizedClicks: number;
    clickedSkips: number;
}

export function restoreHiddenVideoAds(root?: Document): void {
    const elements = root
        ? Array.from(root.querySelectorAll(`[${HIDDEN_ATTR}]`))
        : RESTORE_BATCH.splice(0);

    for (const el of elements) {
        if (!(el instanceof HTMLElement)) continue;

        const prevStyle = el.getAttribute(PREV_STYLE_ATTR);
        if (prevStyle !== null && prevStyle !== "") {
            el.setAttribute("style", prevStyle);
        } else {
            el.style.removeProperty("display");
        }

        el.removeAttribute(HIDDEN_ATTR);
        el.removeAttribute(PREV_STYLE_ATTR);
    }

    debugLog(`Restored ${elements.length} hidden elements`);
}

export function restoreAll(): void {
    // Revert all mutations in reverse order using the ledger
    const ledgerCopy = [...mutationLedger];
    for (let i = ledgerCopy.length - 1; i >= 0; i--) {
        const record = ledgerCopy[i];
        if (record.revert) {
            try {
                record.revert();
            } catch (e) {
                console.warn("[uBR] restoreAll revert failed:", e);
            }
        }
    }
    mutationLedger.length = 0;
    RESTORE_BATCH.length = 0;
    cssInjectionInventory.clear();
    debugLog("Restored all mutations");
}

export function applySafeActionPlan(plan: SafeActionPlan, capabilities?: MutationCapabilities, root?: Document, dryRun?: boolean): SafeActionResult {
    const caps = capabilities ?? currentCapabilities;
    const doc = root || document;
    const result: SafeActionResult = {
        hidden: 0,
        removed: 0,
        marked: 0,
        neutralizedClicks: 0,
        clickedSkips: 0,
    };

    if (dryRun) {
        debugLog("[dry-run] SafeActionPlan:", plan.reason, "hide:", (plan.hideSelectors || []).length, "remove:", (plan.removeSelectors || []).length, "mark:", (plan.markSelectors || []).length);
        return result;
    }

    if (caps.domMarking) {
        for (const el of plan.markElements ?? []) {
            if (safelyMarkElement(el, plan.reason)) result.marked++;
        }
    }

    if (caps.hideElement) {
        for (const el of plan.hideElements ?? []) {
            if (safelyHideElement(el, plan.reason)) result.hidden++;
        }
    }

    if (caps.removeElement) {
        for (const el of plan.removeElements ?? []) {
            if (safelyRemoveElement(el, plan.reason)) result.removed++;
        }
    }

    if (caps.neutralizeClick) {
        for (const el of plan.neutralizeClickElements ?? []) {
            if (safelyNeutralizeClickElement(el, plan.reason)) result.neutralizedClicks++;
        }
    }

    if (caps.skipClick) {
        for (const el of plan.skipClickElements ?? []) {
            if (safelyClickVisibleSkipControl(el, plan.reason)) result.clickedSkips++;
        }
    }

    if (caps.domMarking) {
        for (const selector of plan.markSelectors ?? []) {
            try {
                const elements = doc.querySelectorAll(selector);
                for (const el of elements) {
                    if (safelyMarkElement(el, plan.reason)) result.marked++;
                }
            } catch {
                // Invalid selector - skip
            }
        }
    }

    if (caps.hideElement) {
        for (const selector of plan.hideSelectors ?? []) {
            try {
                const elements = doc.querySelectorAll(selector);
                for (const el of elements) {
                    if (safelyHideElement(el, plan.reason)) result.hidden++;
                }
            } catch {
                // Invalid selector - skip
            }
        }
    }

    if (caps.removeElement) {
        for (const selector of plan.removeSelectors ?? []) {
            try {
                const elements = doc.querySelectorAll(selector);
                for (const el of elements) {
                    if (safelyRemoveElement(el, plan.reason)) result.removed++;
                }
            } catch {
                // Invalid selector - skip
            }
        }
    }

    return result;
}
