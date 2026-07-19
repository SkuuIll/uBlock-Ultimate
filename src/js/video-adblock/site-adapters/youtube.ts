import type { VideoSiteAdapter } from "./adapter-types";

function hostMatches(hostname: string, domain: string): boolean {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

export const youtubeAdapter: VideoSiteAdapter = {
    id: "youtube",
    domains: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
    mainWorldHooksAllowed: true,

    matches(hostname: string) {
        const host = hostname.toLowerCase();
        return this.domains.some((domain) => hostMatches(host, domain));
    },

    detectPlayer() {
        return [];
    },

    detectAdState() {
        return {
            isAd: false,
            confidence: "none",
            reason: "handled-by-existing-youtube-subsystem",
        };
    },

    getSafeActions() {
        return {
            hideSelectors: [],
            removeSelectors: [],
            markSelectors: [],
            blockRequestHints: [],
            mainWorldHooksAllowed: true,
            reason: "handled-by-existing-youtube-subsystem",
        };
    },

    shouldDisableForBreakage() {
        return false;
    },
};
