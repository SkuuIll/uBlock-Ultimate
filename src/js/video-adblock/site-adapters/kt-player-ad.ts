import type { VideoSiteAdapter, VideoAdDetection, SafeActionPlan } from "./adapter-types";
import { detectKnownVideoAdSignature } from "../video-ad-signatures";

const KT_PLAYER_HOSTS = [
    "ppembed.com",
    "p0sembed.com",
];

const KT_PLAYER_AD_REQUEST_HINTS = [
    "s.magsrv.com",
    "foxiceberg.com",
    "btsar.space",
];

function hostMatches(hostname: string, knownHost: string): boolean {
    const host = hostname.toLowerCase();
    return host === knownHost || host.endsWith(`.${knownHost}`);
}

function isKtPlayerHost(hostname: string): boolean {
    return KT_PLAYER_HOSTS.some(knownHost => hostMatches(hostname, knownHost));
}

function hasKtPlayerAdSignals(document: Document): {
    hasKtPlayerAdState: boolean;
    hasSpotOverlay: boolean;
    hasFlowplayerAdBlock: boolean;
    hasSkipControl: boolean;
    hasAdClickLayer: boolean;
    hasExternalAdVideo: boolean;
} {
    return {
        hasKtPlayerAdState: document.querySelector("#kt_player.kt-player.is-ad-visible, #kt_player.kt-player.is-ad-paused") !== null,
        hasSpotOverlay: document.querySelector(".spot-box") !== null,
        hasFlowplayerAdBlock: document.querySelector(".fp-ui-block") !== null,
        hasSkipControl: document.querySelector(".fp-ui-skip-ad, .fp-play-ad") !== null,
        hasAdClickLayer: document.querySelector(
            'a[href*="s.magsrv.com"], a[href*="foxiceberg.com"], a[href*="btsar.space"]',
        ) !== null,
        hasExternalAdVideo: document.querySelector(
            '.fp-ui-block video[src*="bxcdn.net"], #kt_player video[src*="bxcdn.net"], .spot-box video',
        ) !== null,
    };
}

export const ktPlayerAdAdapter: VideoSiteAdapter = {
    id: "kt-player-ad",
    domains: KT_PLAYER_HOSTS,
    mainWorldHooksAllowed: false,

    matches(hostname: string): boolean {
        return isKtPlayerHost(hostname);
    },

    detectPlayer(document: Document): HTMLVideoElement[] {
        return Array.from(
            document.querySelectorAll<HTMLVideoElement>("#kt_player video.fp-engine, .kt-player video.fp-engine"),
        );
    },

    detectAdState(document: Document, video: HTMLVideoElement): VideoAdDetection {
        const match = detectKnownVideoAdSignature(document, video, ["kt-player-ad"]);
        const signals = hasKtPlayerAdSignals(document);

        if (
            match ||
            signals.hasSpotOverlay ||
            signals.hasExternalAdVideo ||
            signals.hasAdClickLayer ||
            (
                signals.hasKtPlayerAdState &&
                (
                    signals.hasFlowplayerAdBlock ||
                    signals.hasSkipControl
                )
            )
        ) {
            const container =
                document.querySelector(".spot-box") ||
                document.querySelector(".fp-ui-block") ||
                document.querySelector('a[href*="s.magsrv.com"], a[href*="foxiceberg.com"], a[href*="btsar.space"]') ||
                undefined;

            return {
                isAd: true,
                confidence: "high",
                reason: match?.reason || (
                    signals.hasExternalAdVideo
                        ? "kt-player-external-ad-video"
                        : signals.hasSpotOverlay
                            ? "kt-player-spot-overlay"
                            : signals.hasAdClickLayer
                                ? "kt-player-ad-click-layer"
                                : "kt-player-ad-state"
                ),
                video,
                container: container as Element | undefined,
            };
        }

        return {
            isAd: false,
            confidence: "none",
            reason: "no-kt-player-ad-signal",
        };
    },

    getSafeActions(document: Document, detection: VideoAdDetection): SafeActionPlan {
        if (!detection.isAd || detection.confidence === "none") {
            return {
                hideSelectors: [],
                removeSelectors: [],
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
                ".spot-box .spot-label",
                ".spot-box .wrap > div[id]",
                '.spot-box a[href*="foxiceberg.com"]',
                '.spot-box a[href*="s.magsrv.com"]',
                '.spot-box a[href*="btsar.space"]',
                '.fp-ui-block > a[href*="s.magsrv.com"]',
                '.fp-ui-block > a[href*="foxiceberg.com"]',
                '.fp-ui-block > a[href*="btsar.space"]',
                ".fp-ui-block",
            ],
            removeSelectors: [],
            hideElements: [],
            removeElements: [],
            neutralizeClickElements: Array.from(
                document.querySelectorAll<HTMLElement>(
                    '.spot-box a[href*="foxiceberg.com"], .spot-box a[href*="s.magsrv.com"], .spot-box a[href*="btsar.space"], .fp-ui-block > a[href*="s.magsrv.com"], .fp-ui-block > a[href*="foxiceberg.com"], .fp-ui-block > a[href*="btsar.space"]',
                ),
            ),
            skipClickElements: Array.from(
                document.querySelectorAll<HTMLElement>(
                    ".fp-ui-skip-ad, .fp-play-ad, .spot-box .close-box",
                ),
            ),
            blockRequestHints: KT_PLAYER_AD_REQUEST_HINTS,
            mainWorldHooksAllowed: false,
            reason: detection.reason,
        };
    },

    shouldDisableForBreakage(document: Document): boolean {
        return false;
    },
};
