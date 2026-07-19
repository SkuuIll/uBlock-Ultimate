import type { AdapterConfidence } from "./site-adapters/adapter-types";

export interface PlayerState {
    src: string;
    currentTime: number;
    duration: number;
    paused: boolean;
    muted: boolean;
    width: number;
    height: number;
    visible: boolean;
    likelyAd: boolean;
    reason: string;
}

export function readPlayerState(video: HTMLVideoElement): PlayerState {
    const rect = video.getBoundingClientRect();
    return {
        src: video.src || "",
        currentTime: video.currentTime || 0,
        duration: video.duration || 0,
        paused: video.paused,
        muted: video.muted,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0,
        likelyAd: false,
        reason: "",
    };
}

export function adConfidenceFromDuration(duration: number): AdapterConfidence {
    if (duration <= 0 || !isFinite(duration)) return "none";

    if (duration <= 30) return "medium";
    if (duration <= 60) return "low";

    return "none";
}

export function adConfidenceFromDimensions(width: number, height: number): AdapterConfidence {
    if (width <= 0 || height <= 0) return "none";

    if (width < 200 || height < 100) return "none";
    if (width > 1200 && height > 800) return "none";

    return "low";
}
