/*******************************************************************************

    uBlock Origin - MV3 YouTube Site Protector
    https://github.com/gorhill/uBlock

    YouTube-specific cosmetic filter protection. Registers hooks into the
    generic site-protector registry to prevent cosmetic filters from hiding
    YouTube UI elements (masthead, search bar, etc.).

    YouTube is treated as a special case due to its complex dynamic DOM and
    the risk of cosmetic rules breaking core navigation. This module isolates
    all YouTube-specific logic so generic code paths do not need to know
    about any particular site.

******************************************************************************/

import { registerPreHook, registerSelectorExclusion } from "./site-protector.js";
import { parseStoredCosmeticFilterData } from "./sw-helpers.js";
import { reloadAllFilterLists } from "./sw-policies.js";
import { popupState, ensurePopupState } from "./sw-storage.js";

const YOUTUBE_UI_PROTECTED_IDS = [
  "container",
  "center",
  "start",
  "end",
  "guide-button",
  "logo",
  "search-button-narrow",
  "voice-search-button",
];

const youtubeScopeApplies = (scope: string): boolean => {
    if (scope === "") return true;

    const includes: string[] = [];
    const excludes: string[] = [];
    for (const rawToken of scope.split(",")) {
        const token = rawToken.trim().toLowerCase();
        if (token === "") continue;
        if (token.startsWith("~")) {
            excludes.push(token.slice(1));
        } else {
            includes.push(token);
        }
    }

    const isYoutubeScope = (token: string): boolean =>
        token === "*" ||
        token === "youtube.com" ||
        token === "www.youtube.com" ||
        token === "m.youtube.com" ||
        token === "youtu.be" ||
        token === "*.youtube.com" ||
        token.endsWith(".youtube.com");

    if (excludes.some(isYoutubeScope)) return false;
    return includes.length === 0 || includes.some(isYoutubeScope);
};

const selectorTargetsYouTubeMasthead = (selector: string): boolean => {
    const normalized = selector.toLowerCase();
    const compact = normalized.replace(/\s+/g, "");
    if (
        normalized.includes("ytd-masthead") ||
        normalized.includes("ytd-topbar") ||
        normalized.includes("yt-searchbox")
    ) {
        return true;
    }
    if (
        compact === ".style-scope" ||
        compact === "*.style-scope" ||
        compact === "div.style-scope" ||
        /\[class[*~|^$]?=(["'])?style-scope\1?\]/.test(compact)
    ) {
        return true;
    }
    const idGroup = YOUTUBE_UI_PROTECTED_IDS.join("|");
    return (
        new RegExp(`(^|[^\\w-])#(?:${idGroup})(?:$|[^\\w-])`).test(normalized) ||
        new RegExp(`\\[id\\s*=\\s*["']?(?:${idGroup})["']?\\]`).test(normalized)
    );
};

const cosmeticCacheEntrySelector = (entry: any): string => {
    if (typeof entry === "string") return entry;
    if (Array.isArray(entry)) return typeof entry[0] === "string" ? entry[0] : "";
    if (entry && typeof entry === "object" && typeof entry.selector === "string") return entry.selector;
    return "";
};

const cosmeticCacheEntryScopes = (entry: any, key: string): string[] => {
    const details = Array.isArray(entry)
        ? entry[1]
        : entry && typeof entry === "object"
            ? entry
            : {};
    const value = details?.[key];
    if (Array.isArray(value)) return value.filter((scope) => typeof scope === "string");
    if (key === "matches" && Array.isArray(details?.domains)) {
        return details.domains.filter((scope: unknown) => typeof scope === "string");
    }
    return [];
};

const cosmeticCacheEntryAppliesToYoutube = (entry: any): boolean => {
    const excludes = cosmeticCacheEntryScopes(entry, "excludeMatches");
    if (excludes.some((scope) => youtubeScopeApplies(scope))) return false;
    const includes = cosmeticCacheEntryScopes(entry, "matches");
    return includes.length === 0 || includes.some((scope) => youtubeScopeApplies(scope));
};

const scrubStaleYouTubeCosmeticCache = (raw: unknown) => {
    if (raw === undefined || raw === null || raw === "") {
        return { changed: false, removed: [] as string[], content: undefined };
    }
    const data = parseStoredCosmeticFilterData(raw);
    const removed: string[] = [];
    const keepGeneric = data.genericCosmeticFilters.filter((entry: any) => {
        const selector = cosmeticCacheEntrySelector(entry);
        if (selector === "" || selectorTargetsYouTubeMasthead(selector) === false) {
            return true;
        }
        removed.push(selector);
        return false;
    });
    const keepSpecific = data.specificCosmeticFilters.filter((entry: any) => {
        const selector = cosmeticCacheEntrySelector(entry);
        if (
            selector === "" ||
            selectorTargetsYouTubeMasthead(selector) === false ||
            cosmeticCacheEntryAppliesToYoutube(entry) === false
        ) {
            return true;
        }
        removed.push(selector);
        return false;
    });
    if (removed.length === 0) {
        return { changed: false, removed, content: undefined };
    }
    return {
        changed: true,
        removed,
        content: JSON.stringify({
            ...data,
            genericCosmeticFilters: keepGeneric,
            specificCosmeticFilters: keepSpecific,
        }),
    };
};

const cleanupStaleYouTubeMastheadFilters = async (): Promise<string[]> => {
    const stored = await chrome.storage.local.get(["cosmeticFiltersData"]);
    const cleaned = scrubStaleYouTubeCosmeticCache(stored.cosmeticFiltersData);
    if (cleaned.changed === false) return [];
    if (cleaned.content !== undefined) {
        await chrome.storage.local.set({ cosmeticFiltersData: cleaned.content });
    }
    try {
        await reloadAllFilterLists(popupState, ensurePopupState);
    } catch (e) {
        console.warn("[uBR] cleanupStaleYouTubeMastheadFilters: reloadAllFilterLists failed", e);
    }
    if (cleaned.removed.length !== 0) {
        console.warn("[MV3] Removed stale YouTube masthead cosmetic entries:", cleaned.removed);
    }
    return cleaned.removed;
};

export function initYouTubeProtection(): void {
    registerPreHook(async (hostname) => {
        if (hostname !== "" && youtubeScopeApplies(hostname)) {
            await cleanupStaleYouTubeMastheadFilters();
        }
    });

    registerSelectorExclusion((pageHostname, selector) => {
        return pageHostname !== "" && youtubeScopeApplies(pageHostname) && selectorTargetsYouTubeMasthead(selector);
    });
}

export { cleanupStaleYouTubeMastheadFilters };
