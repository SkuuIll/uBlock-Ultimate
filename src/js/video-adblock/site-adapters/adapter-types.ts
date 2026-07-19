export type AdapterConfidence = "none" | "low" | "medium" | "high";

export interface VideoAdDetection {
    isAd: boolean;
    confidence: AdapterConfidence;
    reason: string;
    video?: HTMLVideoElement;
    container?: Element;
}

export interface SafeActionPlan {
    hideSelectors: string[];
    removeSelectors: string[];
    markSelectors: string[];

    hideElements?: Element[];
    removeElements?: Element[];
    markElements?: Element[];
    neutralizeClickElements?: Element[];
    skipClickElements?: HTMLElement[];

    blockRequestHints: string[];
    mainWorldHooksAllowed: boolean;
    reason: string;
}

export interface VideoSiteAdapter {
    id: string;
    domains: string[];
    mainWorldHooksAllowed: boolean;
    matches(hostname: string): boolean;
    detectPlayer(document: Document): HTMLVideoElement[];
    detectAdState(document: Document, video: HTMLVideoElement): VideoAdDetection;
    getSafeActions(document: Document, detection: VideoAdDetection): SafeActionPlan;
    shouldDisableForBreakage(document: Document): boolean;
}
