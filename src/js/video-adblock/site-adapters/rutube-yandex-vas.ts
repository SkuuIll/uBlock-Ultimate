import type { VideoSiteAdapter, VideoAdDetection, SafeActionPlan } from "./adapter-types";
import { getVideoAdSignature, detectKnownVideoAdSignature } from "../video-ad-signatures";

function isRutubeHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    return host === "rutube.ru" || host.endsWith(".rutube.ru");
}

export const rutubeYandexVasAdapter: VideoSiteAdapter = {
    id: "rutube-yandex-vas",
    domains: ["rutube.ru"],
    mainWorldHooksAllowed: false,

    matches(hostname: string): boolean {
        return isRutubeHost(hostname);
    },

    detectPlayer(document: Document): HTMLVideoElement[] {
        const sig = getVideoAdSignature("yandex-vas");
        if (!sig) return [];

        const results: HTMLVideoElement[] = [];
        for (const sel of sig.videoSelectors) {
            for (const el of document.querySelectorAll<HTMLVideoElement>(sel)) {
                results.push(el);
            }
        }
        return Array.from(new Set(results));
    },

    detectAdState(document: Document, video: HTMLVideoElement): VideoAdDetection {
        const match = detectKnownVideoAdSignature(document, video, ["yandex-vas"]);
        if (match) {
            return {
                isAd: true,
                confidence: match.confidence,
                reason: match.reason,
                video,
                container: match.container,
            };
        }

        return {
            isAd: false,
            confidence: "none",
            reason: "no-rutube-yandex-vas-signal",
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
                '[data-testid="advert"]',
                '#raichu_yasdk_container',
                '[class*="yandex-advert-module__SDKWrapper"]',
            ],
            removeSelectors: [],
            markSelectors: [],
            hideElements: detection.container ? [detection.container] : [],
            removeElements: [],
            neutralizeClickElements: [],
            skipClickElements: [],
            blockRequestHints: [
                "strm.yandex.ru/*xVASx",
                "yastatic.net/partner-code-bundles/*/vas-bundles",
            ],
            mainWorldHooksAllowed: false,
            reason: detection.reason,
        };
    },

    shouldDisableForBreakage(document: Document): boolean {
        return false;
    },
};
