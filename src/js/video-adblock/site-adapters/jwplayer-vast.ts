import type { VideoSiteAdapter, VideoAdDetection, SafeActionPlan } from "./adapter-types";
import { detectKnownVideoAdSignature } from "../video-ad-signatures";

const JWPLAYER_VAST_HOSTS = [
    "noodlemagazine.net",
    "nmcorp.video",
];

const JWPLAYER_VAST_AD_REQUEST_HINTS = [
    "s.magsrv.com",
    "tsyndicate.com",
    "kintg.site",
    "clammyendearedkeg.com",
];

function hostMatches(hostname: string, knownHost: string): boolean {
    const host = hostname.toLowerCase();
    return host === knownHost || host.endsWith(`.${knownHost}`);
}

const JWPLAYER_CONTENT_HOST_HINTS = [
    "pvvstream.pro",
    "cdn.pvvstream.pro",
    "cdn2.pvvstream.pro",
];

const JWPLAYER_AD_MEDIA_HINTS = [
    "video.sacdnssedge.com/video/ol_",
];

function isJwplayerVastHost(hostname: string): boolean {
    return JWPLAYER_VAST_HOSTS.some(knownHost => hostMatches(hostname, knownHost));
}

function hasJwplayerVastSignals(document: Document): {
    hasJwPlayerAdState: boolean;
    hasVastPlugin: boolean;
    hasSkipControl: boolean;
    hasAdPlacementProbe: boolean;
} {
    return {
        hasJwPlayerAdState: document.querySelector(".jwplayer.jw-flag-ads") !== null,
        hasVastPlugin: document.querySelector("#player_box_vast, .jw-plugin-vast") !== null,
        hasSkipControl: document.querySelector(".jw-skip, .jw-skiptext") !== null,
        hasAdPlacementProbe: document.querySelector(".afs_ads.ad-placement") !== null,
    };
}

function isLikelyJwplayerVastMediaAd(video: HTMLVideoElement): boolean {
    const src = video.currentSrc || video.src || "";
    if (!src) return false;

    const player = video.closest(".jwplayer");
    if (!player?.classList.contains("jw-flag-ads")) return false;

    const hasContentSource = Array.from(video.querySelectorAll("source")).some(source => {
        const sourceSrc = source.src || "";
        return JWPLAYER_CONTENT_HOST_HINTS.some(hint => sourceSrc.includes(hint));
    });

    const looksLikeAdMedia = JWPLAYER_AD_MEDIA_HINTS.some(hint => src.includes(hint));

    return hasContentSource && looksLikeAdMedia;
}

export const jwplayerVastAdapter: VideoSiteAdapter = {
    id: "jwplayer-vast",
    domains: JWPLAYER_VAST_HOSTS,
    mainWorldHooksAllowed: false,

    matches(hostname: string): boolean {
        return isJwplayerVastHost(hostname);
    },

    detectPlayer(document: Document): HTMLVideoElement[] {
        return Array.from(
            document.querySelectorAll<HTMLVideoElement>("video.jw-video, .jwplayer video"),
        );
    },

    detectAdState(document: Document, video: HTMLVideoElement): VideoAdDetection {
        const match = detectKnownVideoAdSignature(document, video, ["jwplayer-vast"]);
        const signals = hasJwplayerVastSignals(document);
        const isMediaAd = isLikelyJwplayerVastMediaAd(video);

        if (
            match ||
            signals.hasVastPlugin ||
            signals.hasAdPlacementProbe ||
            (signals.hasJwPlayerAdState && signals.hasSkipControl) ||
            isMediaAd
        ) {
            const container =
                document.querySelector("#player_box_vast") ||
                document.querySelector(".jw-plugin-vast") ||
                document.querySelector(".jw-skip") ||
                undefined;

            return {
                isAd: true,
                confidence: "high",
                reason: match?.reason || (
                    isMediaAd
                        ? "jwplayer-vast-media-ad-state"
                        : signals.hasVastPlugin
                            ? "jwplayer-vast-plugin-found"
                            : signals.hasAdPlacementProbe
                                ? "jwplayer-ad-placement-probe-found"
                                : "jwplayer-ad-state-with-skip-control"
                ),
                video,
                container: container as Element | undefined,
            };
        }

        return {
            isAd: false,
            confidence: "none",
            reason: "no-jwplayer-vast-signal",
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

        const neutralizeTargets = Array.from(
            document.querySelectorAll<HTMLElement>(
                "#player_box_vast, .jw-plugin-vast, .afs_ads.ad-placement",
            ),
        );

        return {
            hideSelectors: [
                "#player_box_vast",
                ".jw-plugin-vast",
                ".afs_ads.ad-placement",
            ],
            removeSelectors: [],
            markSelectors: [],
            hideElements: [],
            removeElements: [],
            neutralizeClickElements: neutralizeTargets,
            skipClickElements: Array.from(
                document.querySelectorAll<HTMLElement>(".jw-skip, .jw-skiptext"),
            ),
            blockRequestHints: JWPLAYER_VAST_AD_REQUEST_HINTS,
            mainWorldHooksAllowed: false,
            reason: detection.reason,
        };
    },

    shouldDisableForBreakage(document: Document): boolean {
        return false;
    },
};
