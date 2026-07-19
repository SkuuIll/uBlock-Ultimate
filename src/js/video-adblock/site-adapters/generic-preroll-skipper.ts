import type { VideoSiteAdapter, VideoAdDetection, SafeActionPlan } from "./adapter-types";
import { isKnownVideoAdapterHost } from "../breakage-guard";
import { findVideoElements, isLikelyPrimaryVideo } from "../video-detector";
import { findVisibleSkipControlsForVideo } from "../preroll-skip-detector";

type PrerollDetection = VideoAdDetection & {
    skipControl?: HTMLElement;
};

export const genericPrerollSkipperAdapter: VideoSiteAdapter = {
    id: "generic-preroll-skipper",
    domains: ["*"],
    mainWorldHooksAllowed: false,

    matches(hostname: string): boolean {
        const host = hostname.toLowerCase();
        return !isKnownVideoAdapterHost(host);
    },

    detectPlayer(document: Document): HTMLVideoElement[] {
        return findVideoElements(document).filter(v => isLikelyPrimaryVideo(v));
    },

    detectAdState(document: Document, video: HTMLVideoElement): PrerollDetection {
        const skipControls = findVisibleSkipControlsForVideo(video, document);
        const high = skipControls.find(c => c.confidence === "high");
        const medium = skipControls.find(c => c.confidence === "medium");

        const candidate = high || medium;
        if (!candidate) {
            return {
                isAd: false,
                confidence: "none",
                reason: "no-visible-preroll-skip-control",
            };
        }

        return {
            isAd: true,
            confidence: candidate.confidence,
            reason: candidate.reason,
            video,
            container: candidate.element,
            skipControl: candidate.element,
        };
    },

    getSafeActions(_document: Document, detection: PrerollDetection): SafeActionPlan {
        if (!detection.isAd || !detection.skipControl || detection.confidence !== "high") {
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
                reason: "low-confidence-no-action",
            };
        }

        return {
            hideSelectors: [],
            removeSelectors: [],
            markSelectors: [],
            hideElements: [],
            removeElements: [],
            neutralizeClickElements: [],
            skipClickElements: [detection.skipControl],
            blockRequestHints: [],
            mainWorldHooksAllowed: false,
            reason: detection.reason,
        };
    },

    shouldDisableForBreakage(_document: Document): boolean {
        return false;
    },
};
