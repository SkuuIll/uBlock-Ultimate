import { findVideoElements, isLikelyPrimaryVideo, getLikelyVideoContainer } from "./video-detector";

export interface PlayerGestureArmOptions {
    getVideos: () => HTMLVideoElement[];
    onArmed: (video: HTMLVideoElement, reason: string) => void;
}

let installed = false;
let lastArmedAt = 0;
let armHandler: ((event: Event) => void) | null = null;

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;

    const tag = target.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if ((target as HTMLElement).isContentEditable) return true;

    return false;
}

function rectContainsPoint(rect: DOMRect, x: number, y: number): boolean {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function expandedRectContainsPoint(rect: DOMRect, x: number, y: number): boolean {
    const padX = rect.width * 0.35;
    const padY = rect.height * 0.35;

    return (
        x >= rect.left - padX &&
        x <= rect.right + padX &&
        y >= rect.top - padY &&
        y <= rect.bottom + padY
    );
}

function videoContainsGesture(video: HTMLVideoElement, x: number, y: number): boolean {
    const rect = video.getBoundingClientRect();
    if (rect.width < 200 || rect.height < 100) return false;

    if (rectContainsPoint(rect, x, y)) return true;

    const container = getLikelyVideoContainer(video) || video.parentElement;
    if (container) {
        const cr = container.getBoundingClientRect();
        if (expandedRectContainsPoint(cr, x, y)) return true;
    }

    return false;
}

function findVideoForGesture(event: MouseEvent | PointerEvent, knownVideos: HTMLVideoElement[]): HTMLVideoElement | null {
    const x = event.clientX;
    const y = event.clientY;

    for (const video of knownVideos) {
        if (!video.isConnected) continue;
        if (videoContainsGesture(video, x, y)) return video;
    }

    const currentVideos = findVideoElements(document).filter(v => isLikelyPrimaryVideo(v));
    for (const video of currentVideos) {
        if (videoContainsGesture(video, x, y)) return video;
    }

    return null;
}

function shouldIgnoreGesture(event: MouseEvent | PointerEvent): boolean {
    if (event.defaultPrevented) return true;
    if (isEditableTarget(event.target)) return true;

    if (event instanceof MouseEvent && event.button !== 0) return true;

    const target = event.target;
    if (target instanceof Element) {
        if (target.closest("[data-ubr-extension-ui]")) return true;
        if (target.closest("[data-ubol-overlay]")) return true;
        if (target.closest("[data-ubol-overlay-dialog]")) return true;
    }

    return false;
}

export function installPlayerGestureArm(options: PlayerGestureArmOptions): void {
    if (installed) return;
    installed = true;

    armHandler = (event: Event) => {
        if (!(event instanceof MouseEvent) && !(event instanceof PointerEvent)) return;
        if (shouldIgnoreGesture(event)) return;

        const now = Date.now();
        if (now - lastArmedAt < 500) return;

        const video = findVideoForGesture(event, options.getVideos());
        if (!video) return;

        lastArmedAt = now;
        options.onArmed(video, "trusted-player-region-gesture");
    };

    document.addEventListener("pointerdown", armHandler, true);
}

export function resetPlayerGestureArm(): void {
    if (armHandler) {
        document.removeEventListener("pointerdown", armHandler, true);
        armHandler = null;
    }
    installed = false;
    lastArmedAt = 0;
}
