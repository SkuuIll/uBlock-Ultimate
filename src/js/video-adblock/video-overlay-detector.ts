export interface OverlayCandidate {
    element: Element;
    confidence: "low" | "medium" | "high";
    reason: string;
}

const AD_TEXT_SIGNALS = [
    "ad", "ads", "advert", "advertisement", "sponsor", "sponsored",
    "preroll", "midroll", "postroll", "vast", "vmap", "ima",
    "promo", "banner", "popunder", "popup",
];

const SAFE_TAGS = new Set(["video", "source", "track"]);

function rectOverlapRatio(a: DOMRect, b: DOMRect): number {
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);

    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    const overlap = width * height;
    const base = Math.max(1, a.width * a.height);

    return overlap / base;
}

function hasAdLikeText(element: Element): boolean {
    const cls = typeof element.className === "string" ? element.className : "";
    const id = element.id || "";
    const aria = element.getAttribute("aria-label") || "";
    const title = element.getAttribute("title") || "";
    const src = element instanceof HTMLIFrameElement ? element.src : "";
    const href = element instanceof HTMLAnchorElement ? element.href : "";

    const combined = `${cls} ${id} ${aria} ${title} ${src} ${href}`.toLowerCase();
    return AD_TEXT_SIGNALS.some(signal => combined.includes(signal));
}

function isClickableOverlay(element: Element): boolean {
    if (element instanceof HTMLAnchorElement) return true;
    if (element instanceof HTMLButtonElement) return true;
    if (element.getAttribute("role") === "button") return true;
    if (element.querySelector("a,button,[role='button'],iframe")) return true;
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

function isProtectedSiteUi(element: Element): boolean {
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

export function findVideoOverlayCandidates(video: HTMLVideoElement, root: Element): OverlayCandidate[] {
    const videoRect = video.getBoundingClientRect();
    const candidates: OverlayCandidate[] = [];

    if (videoRect.width < 200 || videoRect.height < 100) return candidates;

    const elements = Array.from(root.querySelectorAll("*"));

    for (const element of elements) {
        const tag = element.tagName.toLowerCase();
        if (SAFE_TAGS.has(tag)) continue;
        if (element === video) continue;
        if (element.contains(video)) continue;
        if (isExtensionOwnedElement(element)) continue;
        if (isProtectedSiteUi(element)) continue;

        const rect = element.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 20) continue;

        const overlap = rectOverlapRatio(videoRect, rect);
        if (overlap < 0.35) continue;

        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") continue;

        const z = Number.parseInt(style.zIndex || "0", 10);
        const positioned = ["absolute", "fixed", "sticky"].includes(style.position);
        const adLike = hasAdLikeText(element);
        const clickable = isClickableOverlay(element);

        if (overlap >= 0.70 && adLike && clickable) {
            candidates.push({
                element,
                confidence: "high",
                reason: "ad-like-clickable-overlay-over-video",
            });
            continue;
        }

        if (overlap >= 0.50 && adLike && (positioned || z > 1)) {
            candidates.push({
                element,
                confidence: "medium",
                reason: "ad-like-positioned-overlay-over-video",
            });
            continue;
        }

        if (overlap >= 0.80 && clickable && positioned && z > 10 && adLike) {
            candidates.push({
                element,
                confidence: "medium",
                reason: "clickable-high-z-overlay-over-video",
            });
        }
    }

    return candidates;
}

function isUnsafeRemovalTarget(element: Element, video: HTMLVideoElement): boolean {
    const tag = element.tagName.toLowerCase();
    if (tag === "video" || tag === "source" || tag === "track") return true;
    if (tag === "body" || tag === "html") return true;
    if (element === video) return true;
    if (element.contains(video)) return true;
    return false;
}

function dedupeOverlayCandidates(candidates: OverlayCandidate[]): OverlayCandidate[] {
    const seen = new Set<Element>();
    const out: OverlayCandidate[] = [];

    for (const candidate of candidates) {
        if (seen.has(candidate.element)) continue;
        seen.add(candidate.element);
        out.push(candidate);
    }

    return out;
}

export function findDocumentWideVideoOverlayCandidates(
    video: HTMLVideoElement,
    document: Document,
): OverlayCandidate[] {
    const candidates: OverlayCandidate[] = [];

    const roots = new Set<Element>();
    roots.add(document.body);

    let current: Element | null = video.parentElement;
    let depth = 0;
    while (current && depth < 8) {
        roots.add(current);
        current = current.parentElement;
        depth++;
    }

    for (const root of roots) {
        for (const candidate of findVideoOverlayCandidates(video, root)) {
            if (!isUnsafeRemovalTarget(candidate.element, video)) {
                candidates.push(candidate);
            }
        }
    }

    return dedupeOverlayCandidates(candidates);
}

export function findTopLayerVideoOverlays(
    video: HTMLVideoElement,
    document: Document,
): OverlayCandidate[] {
    const rect = video.getBoundingClientRect();
    const candidates: OverlayCandidate[] = [];

    if (rect.width < 200 || rect.height < 100) return candidates;

    const points = [
        [0.20, 0.20], [0.50, 0.20], [0.80, 0.20],
        [0.20, 0.50], [0.50, 0.50], [0.80, 0.50],
        [0.20, 0.80], [0.50, 0.80], [0.80, 0.80],
    ];

    const hits = new Map<Element, number>();

    for (const [px, py] of points) {
        const x = rect.left + rect.width * px;
        const y = rect.top + rect.height * py;

        const top = document.elementFromPoint(x, y);
        if (!top) continue;
        if (top === video) continue;
        if (top.tagName.toLowerCase() === "video") continue;
        if (isExtensionOwnedElement(top)) continue;
        if (isProtectedSiteUi(top)) continue;

        let candidate: Element | null = top;
        let climb = 0;

        while (candidate && climb < 4) {
            if (candidate === video) break;
            if (candidate.contains(video)) break;

            const style = getComputedStyle(candidate);
            const positioned = ["absolute", "fixed", "sticky"].includes(style.position);
            const z = Number.parseInt(style.zIndex || "0", 10);
            const pointerActive = style.pointerEvents !== "none";

            if (pointerActive && (positioned || z > 1 || isClickableOverlay(candidate))) {
                if (!hasAdLikeText(candidate)) {
                    const hasVisibleContent =
                        (candidate.textContent ?? "").trim().length > 0 ||
                        candidate.querySelector("svg, img, canvas") !== null ||
                        candidate.getAttribute("aria-label") !== null;
                    if (hasVisibleContent) {
                        break;
                    }
                }
                hits.set(candidate, (hits.get(candidate) ?? 0) + 1);
                break;
            }

            candidate = candidate.parentElement;
            climb++;
        }
    }

    for (const [element, count] of hits) {
        if (count >= 3) {
            candidates.push({
                element,
                confidence: count >= 5 ? "high" : "medium",
                reason: `top-layer-clickable-overlay:${count}/9`,
            });
        }
    }

    return candidates;
}
