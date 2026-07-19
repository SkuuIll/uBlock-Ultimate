import type { VideoSiteAdapter, VideoAdDetection, SafeActionPlan } from "./adapter-types";
import { isKnownVideoAdapterHost, isKnownSensitiveHost } from "../breakage-guard";
import { findVideoElements, isLikelyPrimaryVideo } from "../video-detector";
import { detectKnownVideoAdSignature } from "../video-ad-signatures";
import {
    findDocumentWideVideoOverlayCandidates,
    findTopLayerVideoOverlays,
} from "../video-overlay-detector";

export const aggressiveVideoGenericAdapter: VideoSiteAdapter = {
    id: "aggressive-video-generic",
    domains: ["*"],
    mainWorldHooksAllowed: false,

    matches(hostname: string): boolean {
        const host = hostname.toLowerCase();
        // Skip sites that have their own dedicated adapter or are sensitive hosts.
        return !isKnownVideoAdapterHost(host) && !isKnownSensitiveHost(host);
    },

    detectPlayer(document: Document): HTMLVideoElement[] {
        return findVideoElements(document).filter(v => isLikelyPrimaryVideo(v));
    },

    detectAdState(document: Document, video: HTMLVideoElement): VideoAdDetection {
        const sigMatch = detectKnownVideoAdSignature(document, video);
        if (sigMatch) {
            return {
                isAd: true,
                confidence: sigMatch.confidence,
                reason: sigMatch.reason,
                video,
                container: sigMatch.container,
            };
        }

        const overlays = [
            ...findDocumentWideVideoOverlayCandidates(video, document),
            ...findTopLayerVideoOverlays(video, document),
        ];

        const high = overlays.find(o => o.confidence === "high");
        if (high) {
            return {
                isAd: true,
                confidence: "high",
                reason: high.reason,
                video,
                container: high.element,
            };
        }

        const medium = overlays.find(o => o.confidence === "medium");
        if (medium) {
            return {
                isAd: true,
                confidence: "medium",
                reason: medium.reason,
                video,
                container: medium.element,
            };
        }

        return {
            isAd: false,
            confidence: "none",
            reason: "no-aggressive-video-ad-overlay",
        };
    },

    getSafeActions(document: Document, detection: VideoAdDetection): SafeActionPlan {
        if (!detection.isAd || !detection.container || detection.confidence !== "high") {
            return {
                hideSelectors: [],
                removeSelectors: [],
                markSelectors: [],
                hideElements: [],
                removeElements: [],
                neutralizeClickElements: [],
                blockRequestHints: [],
                mainWorldHooksAllowed: false,
                reason: detection.confidence !== "high" ? "low-confidence-no-action" : "no-ad",
            };
        }

        return {
            hideSelectors: [],
            removeSelectors: [],
            markSelectors: [],
            hideElements: [detection.container],
            removeElements: [],
            neutralizeClickElements: [detection.container],
            blockRequestHints: [],
            mainWorldHooksAllowed: false,
            reason: detection.reason,
        };
    },

    shouldDisableForBreakage(document: Document): boolean {
        return false;
    },
};
