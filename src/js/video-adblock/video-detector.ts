const PLAYER_CONTAINER_CLASSES = [
    "player", "video", "media", "jwplayer", "plyr", "vjs",
    "ima", "vast", "stream",
];

const MIN_VIDEO_WIDTH = 200;
const MIN_VIDEO_HEIGHT = 100;

export function findVideoElements(root: Document | Element = document): HTMLVideoElement[] {
    return Array.from(root.querySelectorAll("video"));
}

export function isLikelyPrimaryVideo(video: HTMLVideoElement): boolean {
    if (!video.isConnected) return false;

    const rect = video.getBoundingClientRect();
    if (rect.width < MIN_VIDEO_WIDTH || rect.height < MIN_VIDEO_HEIGHT) return false;

    const style = getComputedStyle(video);
    if (style.display === "none" || style.visibility === "hidden") return false;

    return true;
}

export function getLikelyVideoContainer(video: HTMLVideoElement): Element | null {
    let current: Element | null = video.parentElement;
    let depth = 0;

    while (current && depth < 8) {
        const cls = (current.className || "").toLowerCase();
        const id = (current.id || "").toLowerCase();
        const combined = `${cls} ${id}`;

        for (const keyword of PLAYER_CONTAINER_CLASSES) {
            if (combined.includes(keyword)) {
                return current;
            }
        }

        current = current.parentElement;
        depth++;
    }

    return null;
}
