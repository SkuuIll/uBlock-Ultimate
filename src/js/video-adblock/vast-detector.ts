const VAST_SIGNALS = [
    "vast", "vmap", "adtag", "ad_tag", "adTagUrl",
    "adserver", "pubads", "ima3", "imasdk",
    "googleads", "doubleclick",
    "preroll", "midroll", "postroll",
];

const MEDIA_EXTENSIONS = [
    ".m3u8", ".mpd", ".ts", ".m4s", ".mp4", ".webm", ".mov",
];

export function looksLikeVastUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return VAST_SIGNALS.some(signal => lower.includes(signal));
}

export function looksLikeImaScript(url: string): boolean {
    const lower = url.toLowerCase();
    return lower.includes("imasdk.googleapis.com") || lower.includes("ima3");
}

export function looksLikeVideoAdRequest(url: string): boolean {
    const lower = url.toLowerCase();

    if (MEDIA_EXTENSIONS.some(ext => lower.includes(ext))) return false;

    return VAST_SIGNALS.some(signal => lower.includes(signal));
}

export function extractAdRequestReason(url: string): string | null {
    const lower = url.toLowerCase();

    for (const signal of VAST_SIGNALS) {
        if (lower.includes(signal)) return signal;
    }

    return null;
}
