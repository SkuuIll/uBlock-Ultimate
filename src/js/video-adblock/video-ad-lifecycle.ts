export type VideoAdLifecycleState =
    | "idle"
    | "content-candidate"
    | "ad-candidate"
    | "skip-waiting"
    | "skip-clicked"
    | "post-skip-verifying"
    | "content-playing"
    | "ad-reinjected";

export interface VideoAdLifecycleSnapshot {
    state: VideoAdLifecycleState;
    lastPlayAt: number;
    lastAdSignalAt: number;
    lastSkipClickAt: number;
    lastContentSignalAt: number;
    lastSrc: string;
    lastCurrentTime: number;
    stableContentTicks: number;
    adBreakIndex: number;
    lastUserGestureAt: number;
    armedUntil: number;
}

const lifecycles = new WeakMap<HTMLVideoElement, VideoAdLifecycleSnapshot>();

export function getVideoAdLifecycle(video: HTMLVideoElement): VideoAdLifecycleSnapshot {
    let state = lifecycles.get(video);
    if (!state) {
        state = {
            state: "idle",
            lastPlayAt: 0,
            lastAdSignalAt: 0,
            lastSkipClickAt: 0,
            lastContentSignalAt: 0,
            lastSrc: video.currentSrc || video.src || "",
            lastCurrentTime: 0,
            stableContentTicks: 0,
            adBreakIndex: 0,
            lastUserGestureAt: 0,
            armedUntil: 0,
        };
        lifecycles.set(video, state);
    }
    return state;
}

export function markVideoPlay(video: HTMLVideoElement): void {
    const s = getVideoAdLifecycle(video);
    s.lastPlayAt = Date.now();
    if (s.state === "idle") {
        s.state = "content-candidate";
    }
}

export function markAdSignal(video: HTMLVideoElement, _reason: string): void {
    const s = getVideoAdLifecycle(video);
    const now = Date.now();
    s.lastAdSignalAt = now;

    if (s.state === "content-playing") {
        s.state = "ad-reinjected";
        s.adBreakIndex++;
        return;
    }

    if (s.state !== "skip-clicked" && s.state !== "post-skip-verifying") {
        s.state = "ad-candidate";
    }
}

export function markSkipClicked(video: HTMLVideoElement): void {
    const s = getVideoAdLifecycle(video);
    s.lastSkipClickAt = Date.now();
    s.state = "skip-clicked";
}

export function markContentTick(video: HTMLVideoElement): void {
    const s = getVideoAdLifecycle(video);
    const now = Date.now();
    const currentSrc = video.currentSrc || video.src || "";
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;

    if (currentSrc !== s.lastSrc) {
        s.lastSrc = currentSrc;
        s.stableContentTicks = 0;
        if (s.state === "content-playing") {
            s.state = "ad-reinjected";
            s.adBreakIndex++;
        }
        return;
    }

    if (currentTime > s.lastCurrentTime + 0.25 && !video.paused) {
        s.stableContentTicks++;
        s.lastContentSignalAt = now;
    }

    s.lastCurrentTime = currentTime;

    if (
        (s.state === "skip-clicked" || s.state === "post-skip-verifying" || s.state === "content-candidate") &&
        s.stableContentTicks >= 3
    ) {
        s.state = "content-playing";
    }
}

export const USER_GESTURE_ARM_WINDOW_MS = 20000;

export function markUserPlayGesture(video: HTMLVideoElement): void {
    const s = getVideoAdLifecycle(video);
    const now = Date.now();

    s.lastUserGestureAt = now;
    s.armedUntil = now + USER_GESTURE_ARM_WINDOW_MS;

    if (s.state === "idle" || s.state === "content-playing") {
        s.state = "content-candidate";
    }
}

export function shouldKeepScanningAggressively(video: HTMLVideoElement): boolean {
    const s = getVideoAdLifecycle(video);
    const now = Date.now();

    return (
        now < s.armedUntil ||
        s.state === "ad-candidate" ||
        s.state === "skip-waiting" ||
        s.state === "skip-clicked" ||
        s.state === "post-skip-verifying" ||
        s.state === "ad-reinjected" ||
        now - s.lastPlayAt < 15000 ||
        now - s.lastAdSignalAt < 15000
    );
}
