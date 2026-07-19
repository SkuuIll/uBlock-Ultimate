import { debugLog } from "./diagnostics";

// Positive list: sites with a known, specific video adapter.
// Generic video adapters will not run on these sites — the dedicated
// adapter handles them.
const KNOWN_VIDEO_ADAPTER_HOSTS = new Set([
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "yandex.com",
    "yandex.ru",
    "rutube.ru",
    "vkvideo.ru",
    // Site-specific adapters (embed-player-videojs-vast)
    "embed-player.space",
    "semyana.top",
    // Site-specific adapters (jwplayer-vast)
    "noodlemagazine.net",
    "nmcorp.video",
    // Site-specific adapters (kt-player-ad)
    "ppembed.com",
    "p0sembed.com",
]);

// Sensitive hosts where generic ad-blocking should not run (Item 207)
const SENSITIVE_HOSTS = new Set([
    "suno.com",
    "chatgpt.com",
]);

let engineDisabled = false;

export function isKnownVideoAdapterHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    if (KNOWN_VIDEO_ADAPTER_HOSTS.has(host)) return true;

    for (const known of KNOWN_VIDEO_ADAPTER_HOSTS) {
        if (host.endsWith(`.${known}`)) return true;
    }

    return false;
}

// Sensitive host check — generic video ad-blocking should not run on these (Items 207)
const SENSITIVE_SUFFIXES = [
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "suno.com",
    "chatgpt.com",
];

export function isKnownSensitiveHost(hostname: string): boolean {
    const host = hostname.toLowerCase();
    if (SENSITIVE_HOSTS.has(host)) return true;
    if (KNOWN_VIDEO_ADAPTER_HOSTS.has(host)) return true;
    for (const suffix of SENSITIVE_SUFFIXES) {
        if (host === suffix || host.endsWith(`.${suffix}`)) return true;
    }
    for (const known of KNOWN_VIDEO_ADAPTER_HOSTS) {
        if (host.endsWith(`.${known}`)) return true;
    }
    return false;
}

export function shouldEnableGenericVideoEngine(document: Document, hostname: string): boolean {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return false;

    return videos.some(video => {
        const rect = video.getBoundingClientRect();
        return rect.width >= 320 && rect.height >= 180;
    });
}

export function markEngineDisabled(reason: string): void {
    engineDisabled = true;
    debugLog("Video ad engine disabled:", reason);
}

export function isEngineDisabled(): boolean {
    return engineDisabled;
}

export function resetEngineState(): void {
    engineDisabled = false;
}
