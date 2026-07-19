export interface VideoAdSignature {
    id: string;
    containerSelectors: string[];
    videoSelectors: string[];
    urlHints: string[];
    confidence: "low" | "medium" | "high";
}

export interface VideoAdSignatureMatch {
    signature: VideoAdSignature;
    confidence: "low" | "medium" | "high";
    reason: string;
    video?: HTMLVideoElement;
    container?: Element;
}

export const VIDEO_AD_SIGNATURES: VideoAdSignature[] = [
    {
        id: "yandex-vas",
        containerSelectors: [
            '[data-testid="advert"]',
            '#raichu_yasdk_container',
            '[class*="yandex-advert-module"]',
        ],
        videoSelectors: [
            'video[data-testid="advert-video"]',
            'video.raichu-adver-tag',
            'video[class*="yandex-advert-module__SDKVideo"]',
        ],
        urlHints: [
            "strm.yandex.ru",
            "xVASx",
            "vas-bundles",
        ],
        confidence: "high",
    },
    {
        id: "videojs-vast",
        containerSelectors: [
            "#vast_wrapper",
            ".vast-btns.vdd-addtext",
            ".vast-btns.vdd-countdown",
            ".vast-btns.vdd-skip",
        ],
        videoSelectors: [],
        urlHints: [
            "vast.yomeno.xyz",
            "roomgome.com",
            "syndication.realsrv.com",
            "v.scurra.space",
            "markreptiloid.com/alpha",
            "markreptiloid.com/beta",
            "markreptiloid.com",
            "serve.7kprtners.com",
            "cenoobi.run",
            "deductgreedyheadroom.com",
            "s.magsrv.com",
            "s.magsrv.com/v1/vast.php",
            "rtb.tsyndicate.com",
            "vacdn.rtb.tsyndicate.com",
            "mode=vast",
        ],
        confidence: "high",
    },
    {
        id: "jwplayer-vast",
        containerSelectors: [
            "#player_box_vast",
            ".jw-plugin-vast",
            ".jwplayer.jw-flag-ads",
            ".jw-skip",
            ".jw-skiptext",
            ".afs_ads.ad-placement",
        ],
        videoSelectors: [],
        urlHints: [
            "s.magsrv.com",
            "tsyndicate.com",
            "kintg.site",
            "clammyendearedkeg.com",
            "vast",
        ],
        confidence: "high",
    },
    {
        id: "kt-player-ad",
        containerSelectors: [
            ".spot-box",
            ".fp-ui-block",
            ".fp-ui-skip-ad",
            ".fp-play-ad",
            ".kt-player.is-ad-visible",
            ".kt-player.is-ad-paused",
            'a[href*="s.magsrv.com"]',
            'a[href*="foxiceberg.com"]',
            'a[href*="btsar.space"]',
        ],
        videoSelectors: [],
        urlHints: [
            "s.magsrv.com",
            "foxiceberg.com",
            "btsar.space",
            "bxcdn.net",
        ],
        confidence: "high",
    },
];

export function getVideoAdSignature(id: string): VideoAdSignature | undefined {
    return VIDEO_AD_SIGNATURES.find(s => s.id === id);
}

function matchesAnySelector(
    element: Element,
    selectors: string[],
): boolean {
    for (const sel of selectors) {
        if (element.matches(sel)) return true;
    }
    return false;
}

function findClosestContainer(
    video: HTMLVideoElement,
    signature: VideoAdSignature,
): Element | undefined {
    for (const sel of signature.containerSelectors) {
        const el = video.closest(sel);
        if (el) return el;
    }
    return video.parentElement ?? undefined;
}

function hasUrlHint(src: string, hints: string[]): boolean {
    const lower = src.toLowerCase();
    for (const hint of hints) {
        if (lower.includes(hint.toLowerCase())) return true;
    }
    return false;
}

export function detectKnownVideoAdSignature(
    document: Document,
    video: HTMLVideoElement,
    allowedSignatureIds?: string[],
): VideoAdSignatureMatch | null {
    const signatures = allowedSignatureIds
        ? VIDEO_AD_SIGNATURES.filter(s => allowedSignatureIds.includes(s.id))
        : VIDEO_AD_SIGNATURES;

    for (const sig of signatures) {
        const src = (video.currentSrc || video.src || "").toLowerCase();

        const videoMatches = matchesAnySelector(video, sig.videoSelectors);
        const urlMatches = hasUrlHint(src, sig.urlHints);
        const container = findClosestContainer(video, sig);
        const containerMatches = container
            ? matchesAnySelector(container, sig.containerSelectors)
            : false;

        if (videoMatches || urlMatches || containerMatches) {
            return {
                signature: sig,
                confidence: sig.confidence,
                reason: `${sig.id}-${videoMatches ? "video-selector" : urlMatches ? "url-hint" : "container-selector"}`,
                video,
                container,
            };
        }
    }

    return null;
}
