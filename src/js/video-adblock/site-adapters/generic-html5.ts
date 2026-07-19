import type { VideoSiteAdapter, VideoAdDetection, SafeActionPlan, AdapterConfidence } from "./adapter-types";
import { isKnownVideoAdapterHost, isKnownSensitiveHost } from "../breakage-guard";
import { findVideoElements, isLikelyPrimaryVideo, getLikelyVideoContainer } from "../video-detector";
import { looksLikeVideoAdRequest } from "../vast-detector";

const AD_CONTAINER_CLASSES = [
    "advert", "sponsor",
    "preroll", "midroll", "postroll",
    "vast", "vmap", "ima",
];

function hasAdToken(combined: string, token: string): boolean {
    return new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, "i").test(combined);
}

function hostMatches(hostname: string): boolean {
    const host = hostname.toLowerCase();
    if (isKnownVideoAdapterHost(host)) return false;
    if (isKnownSensitiveHost(host)) return false;
    return true;
}

function containerLooksLikeAd(container: Element | null): { isAd: boolean; confidence: AdapterConfidence; reason: string } {
    if (!container) return { isAd: false, confidence: "none", reason: "no-container" };

    const cls = (container.className || "").toLowerCase();
    const id = (container.id || "").toLowerCase();
    const combined = `${cls} ${id}`;

    const nearIframes = Array.from(container.querySelectorAll("iframe"));
    for (const iframe of nearIframes) {
        const src = (iframe.src || "").toLowerCase();
        if (looksLikeVideoAdRequest(src)) {
            return { isAd: true, confidence: "high", reason: `iframe-src:${src.slice(0, 100)}` };
        }
    }

    for (const keyword of AD_CONTAINER_CLASSES) {
        if (hasAdToken(combined, keyword)) {
            return { isAd: true, confidence: "medium", reason: `container-class:${keyword}` };
        }
    }

    return { isAd: false, confidence: "none", reason: "no-ad-signals" };
}

export const genericHtml5Adapter: VideoSiteAdapter = {
    id: "generic-html5",
    domains: ["*"],
    mainWorldHooksAllowed: false,

    matches(hostname: string): boolean {
        return hostMatches(hostname);
    },

    detectPlayer(document: Document): HTMLVideoElement[] {
        const videos = findVideoElements(document);
        return videos.filter(v => isLikelyPrimaryVideo(v));
    },

    detectAdState(document: Document, video: HTMLVideoElement): VideoAdDetection {
        const container = getLikelyVideoContainer(video) || video.parentElement;
        const result = containerLooksLikeAd(container);

        if (result.isAd) {
            return {
                isAd: true,
                confidence: result.confidence,
                reason: result.reason,
                video,
                container: container || undefined,
            };
        }

        return {
            isAd: false,
            confidence: "none",
            reason: "no-ad-signals",
        };
    },

    getSafeActions(document: Document, detection: VideoAdDetection): SafeActionPlan {
        if (!detection.isAd || detection.confidence !== "high") {
            return { hideSelectors: [], removeSelectors: [], markSelectors: [], hideElements: [], removeElements: [], blockRequestHints: [], mainWorldHooksAllowed: false, reason: "low-confidence-no-action" };
        }

        const selectors: string[] = [];

        if (detection.container) {
            const container = detection.container;
            const id = container.id ? `#${CSS.escape(container.id)}` : "";
            const cls = container.className
                ? container.className.split(/\s+/).map(c => `.${CSS.escape(c)}`).join("")
                : "";

            if (id || cls) {
                selectors.push(id || cls);
            }
        }

        return {
            hideSelectors: selectors,
            removeSelectors: [],
            markSelectors: [],
            hideElements: detection.container ? [detection.container] : [],
            removeElements: [],
            blockRequestHints: [],
            mainWorldHooksAllowed: false,
            reason: detection.reason,
        };
    },

    shouldDisableForBreakage(document: Document): boolean {
        return false;
    },
};
