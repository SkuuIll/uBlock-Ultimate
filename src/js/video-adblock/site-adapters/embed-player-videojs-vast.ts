import type { VideoSiteAdapter, VideoAdDetection, SafeActionPlan } from "./adapter-types";
import { detectKnownVideoAdSignature } from "../video-ad-signatures";

const VIDEOJS_VAST_EMBED_HOSTS = [
    "embed-player.space",
    "semyana.top",
];

const VIDEOJS_VAST_CONTENT_HOST_HINTS = [
    "embed-player.space",
    "cf-cdn.embed-player.space",
    "semyana.website",
    "cf-cdn.semyana.website",
];

const VIDEOJS_VAST_AD_REQUEST_HINTS = [
    "vast.yomeno.xyz",
    "roomgome.com",
    "syndication.realsrv.com",
    "v.scurra.space",
    "markreptiloid.com",
    "serve.7kprtners.com",
    "cenoobi.run",
    "deductgreedyheadroom.com",
    "s.magsrv.com",
    "rtb.tsyndicate.com",
];

const VIDEOJS_VAST_AD_MEDIA_PATTERNS = [
    /^https:\/\/cs\d+\.roomgome\.com\/content\/\d+\/\d+_\d+\.mp4/i,
    /^https:\/\/vacdn\.rtb\.tsyndicate\.com\/videos\/.+\.mp4/i,
];

function hostMatches(hostname: string, knownHost: string): boolean {
    const host = hostname.toLowerCase();
    return host === knownHost || host.endsWith(`.${knownHost}`);
}

function isVideojsVastEmbedHost(hostname: string): boolean {
    return VIDEOJS_VAST_EMBED_HOSTS.some(knownHost => hostMatches(hostname, knownHost));
}

function hasVastSignals(document: Document): {
    hasVastOverlay: boolean;
    hasVideoJsAdState: boolean;
    hasVastControl: boolean;
} {
    return {
        hasVastOverlay: document.querySelector("#vast_wrapper") !== null,
        hasVideoJsAdState: document.querySelector(".video-js.vjs-ad-playing") !== null,
        hasVastControl: document.querySelector(".vast-btns, .vdd-skip, .vdd-countdown") !== null,
    };
}

function sourceHasContentHostHint(source: HTMLSourceElement): boolean {
    const src = source.src || "";
    return VIDEOJS_VAST_CONTENT_HOST_HINTS.some(hint => src.includes(hint));
}

function isKnownVideojsVastAdMediaUrl(src: string): boolean {
    return VIDEOJS_VAST_AD_MEDIA_PATTERNS.some(pattern => pattern.test(src));
}

function isLikelyVideojsVastMediaAd(video: HTMLVideoElement): boolean {
    const src = video.currentSrc || video.src || "";
    if (!src) return false;

    const player = video.closest(".video-js");
    if (!player?.classList.contains("vjs-ad-playing")) return false;

    const hasContentSource = Array.from(video.querySelectorAll("source")).some(sourceHasContentHostHint);
    if (!hasContentSource) return false;

    return isKnownVideojsVastAdMediaUrl(src);
}

export const embedPlayerVideojsVastAdapter: VideoSiteAdapter = {
    id: "videojs-vast-embed",
    domains: VIDEOJS_VAST_EMBED_HOSTS,
    mainWorldHooksAllowed: false,

    matches(hostname: string): boolean {
        return isVideojsVastEmbedHost(hostname);
    },

    detectPlayer(document: Document): HTMLVideoElement[] {
        return Array.from(
            document.querySelectorAll<HTMLVideoElement>("video.vjs-tech, .video-js video"),
        );
    },

    detectAdState(document: Document, video: HTMLVideoElement): VideoAdDetection {
        const match = detectKnownVideoAdSignature(document, video, ["videojs-vast"]);
        const signals = hasVastSignals(document);
        const isMediaAd = isLikelyVideojsVastMediaAd(video);

        if (
            match ||
            signals.hasVastOverlay ||
            (signals.hasVideoJsAdState && signals.hasVastControl) ||
            isMediaAd
        ) {
            const container = document.querySelector("#vast_wrapper") ?? undefined;

            return {
                isAd: true,
                confidence: "high",
                reason: match?.reason || (
                    isMediaAd
                        ? "videojs-vast-media-ad-state"
                        : signals.hasVastOverlay
                            ? "vast-overlay-found"
                            : "videojs-ad-state-with-vast-control"
                ),
                video,
                container: container as Element | undefined,
            };
        }

        return {
            isAd: false,
            confidence: "none",
            reason: "no-videojs-vast-signal",
        };
    },

    getSafeActions(document: Document, detection: VideoAdDetection): SafeActionPlan {
        if (!detection.isAd || detection.confidence === "none") {
            return {
                hideSelectors: [],
                removeSelectors: [],
                markSelectors: [],
                hideElements: [],
                removeElements: [],
                neutralizeClickElements: [],
                skipClickElements: [],
                blockRequestHints: [],
                mainWorldHooksAllowed: false,
                reason: "no-ad",
            };
        }

        return {
            hideSelectors: [
                ".vast-btns.vdd-addtext",
                ".vast-btns.vdd-countdown",
            ],
            removeSelectors: [],
            markSelectors: [],
            hideElements: [],
            removeElements: [],
            neutralizeClickElements: [],
            skipClickElements: Array.from(
                document.querySelectorAll<HTMLElement>(".vast-btns.vdd-skip"),
            ),
            blockRequestHints: VIDEOJS_VAST_AD_REQUEST_HINTS,
            mainWorldHooksAllowed: false,
            reason: detection.reason,
        };
    },

    shouldDisableForBreakage(document: Document): boolean {
        return false;
    },
};
