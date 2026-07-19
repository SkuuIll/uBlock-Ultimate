/*******************************************************************************

    uBlock Origin - MV3 Helpers
    https://github.com/gorhill/uBlock

    This file contains utility and helper functions.

*******************************************************************************/

import type { FirewallCounts } from "./sw-types.js";

export const createCounts = (): FirewallCounts => ({
  allowed: { any: 0, frame: 0, script: 0 },
  blocked: { any: 0, frame: 0, script: 0 },
});

export const isIPAddress = (hostname: string): boolean => {
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
};

export const domainFromHostname = (hostname: string): string => {
    if (hostname === "" || hostname === "*") {
        return hostname;
    }
    if (hostname === "localhost" || isIPAddress(hostname)) {
        return hostname;
    }
    const parts = hostname.split(".").filter(Boolean);
    if (parts.length <= 2) {
        return hostname;
    }
    return parts.slice(-2).join(".");
};

export const domainFromURI = (uri: string): string => {
    try {
        const url = new URL(uri);
        return domainFromHostname(url.hostname);
    } catch (e) {
        console.warn("[uBR] domainFromURI: invalid URI", uri, e);
        return "";
    }
};

export const hostnameFromURI = (uri: string): string => {
    try {
        const url = new URL(uri);
        return url.hostname;
    } catch (e) {
        console.warn("[uBR] hostnameFromURI: invalid URI", uri, e);
        return "";
    }
};

export const isNetworkURI = (url: string): boolean => {
    try {
        const parsed = new URL(url);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (e) {
        console.warn("[uBR] isNetworkURI: invalid URL", url, e);
        return false;
    }
};

export const formatCount = (count: number): string => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)  }M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)  }K`;
    return String(count);
};

export const dateNowToSensibleString = (): string => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hour = String(now.getHours()).padStart(2, "0");
    const minute = String(now.getMinutes()).padStart(2, "0");
    return `${year}${month}${day}-${hour}${minute}`;
};

export const generateAccentStylesheet = (
    accent: string,
    _dark: boolean,
): string => {
    const baseColor = accent.replace("#", "");
    const r = parseInt(baseColor.substring(0, 2), 16);
    const g = parseInt(baseColor.substring(2, 4), 16);
    const b = parseInt(baseColor.substring(4, 6), 16);

    const lighter = `rgba(${Math.min(255, r + 30)}, ${Math.min(255, g + 30)}, ${Math.min(255, b + 30)}, 0.5)`;
    const darker = `rgba(${Math.max(0, r - 30)}, ${Math.max(0, g - 30)}, ${Math.max(0, b - 30)}, 0.5)`;

    return `
:root {
    --accent: ${accent};
    --accent-light: ${lighter};
    --accent-dark: ${darker};
}
::-webkit-scrollbar-thumb { background: var(--accent); }
::-webkit-scrollbar-thumb:hover { background: var(--accent-dark); }
::-webkit-scrollbar-corner { background: var(--accent-light); }
`;
};

export const adjustColor = (color: string, percent: number): string => {
    if (color.startsWith("#")) {
        const hex = color.slice(1);
        const num = parseInt(hex, 16);
        const r = Math.min(255, Math.max(0, (num >> 16) + percent));
        const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + percent));
        const b = Math.min(255, Math.max(0, (num & 0x0000ff) + percent));
        return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
    }
    return color;
};

export const decomposeHostname = (hostname: string): string[] => {
    if (hostname === "" || hostname === "*") {
        return ["*"];
    }
    const parts = hostname.split(".");
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
    out.push(parts.slice(i).join("."));
    }
  out.push("*");
  return out;
};

export const isThirdParty = (
    srcHostname: string,
    desHostname: string,
): boolean => {
    if (desHostname === "*" || srcHostname === "*" || srcHostname === "") {
        return false;
    }
    const srcDomain = domainFromHostname(srcHostname) || srcHostname;
    if (desHostname.endsWith(srcDomain) === false) {
        return true;
    }
    return (
        desHostname.length !== srcDomain.length &&
    desHostname.charAt(desHostname.length - srcDomain.length - 1) !== "."
    );
};

export const delay = (ms: number) =>
    new Promise((resolve) => {
    self.setTimeout(resolve, ms);
    });

export const mergeCounts = (into: FirewallCounts, from: FirewallCounts) => {
    into.allowed.any += from.allowed.any;
    into.allowed.frame += from.allowed.frame;
    into.allowed.script += from.allowed.script;
    into.blocked.any += from.blocked.any;
    into.blocked.frame += from.blocked.frame;
    into.blocked.script += from.blocked.script;
};

export const cloneHostnameDetails = (details: any): any => ({
  domain: details.domain,
  counts: details.counts
      ? {
        allowed: { ...details.counts.allowed },
        blocked: { ...details.counts.blocked },
      }
      : createCounts(),
  hasSubdomains: details.hasSubdomains,
  hasScript: details.hasScript,
  hasFrame: details.hasFrame,
});

export const zeroHostnameDetails = (hostname: string): any => ({
  domain: hostname,
  counts: createCounts(),
});

export const getActiveTab = async (): Promise<chrome.tabs.Tab | undefined> => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
};

export const getTabForRequest = async (
    tabId?: number | null,
): Promise<chrome.tabs.Tab | undefined> => {
    if (typeof tabId === "number") {
        return chrome.tabs.get(tabId).catch(() => undefined);
    }
    return getActiveTab();
};

export const isOwnExtensionTab = (tab?: chrome.tabs.Tab): boolean => {
    const url = tab?.url || "";
    return url !== "" && url.startsWith(chrome.runtime.getURL(""));
};

export const pickMostRelevantBrowsingTab = async (): Promise<
  chrome.tabs.Tab | undefined
> => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && !isOwnExtensionTab(tab)) {
        return tab;
    }
    const [lastTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
    });
    if (lastTab && !isOwnExtensionTab(lastTab)) {
        return lastTab;
    }
    const tabs = await chrome.tabs.query({ currentWindow: true });
    for (const tab of tabs) {
        if (!isOwnExtensionTab(tab) && tab.id) {
            return tab;
        }
    }
    return undefined;
};

export const getHiddenElementCountForTab = async (
    tabId: number,
): Promise<number> => {
    if (!tabId) return 0;
    try {
        const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => document.querySelectorAll("[ub-hid]").length,
        });
        return (result as any)?.result ?? 0;
    } catch (e) {
        console.warn("[uBR] getHiddenElementCountForTab: failed for tab", tabId, e);
        return 0;
    }
};

export const updateToolbarIcon = async (
    tabId: number,
    options: { filtering?: boolean; clickToLoad?: string },
) => {
    try {
        const stored = await chrome.storage.local.get("tabIdToDetails");
        let currentParts = stored?.tabIdToDetails?.[tabId] || 0b0111;

        if (options.filtering === false) {
            currentParts = 0b0100;
        } else if (options.filtering === true) {
            currentParts = 0b0111;
        }

        const tabDetails = stored?.tabIdToDetails || {};
        tabDetails[tabId] = currentParts;
        await chrome.storage.local.set({ tabIdToDetails: tabDetails });

        let tab: chrome.tabs.Tab | undefined;
        try { tab = await chrome.tabs.get(tabId); } catch {}
    console.log("[MV3] updateToolbarIcon: got tab =", !!tab, "url =", tab?.url);
    if (!tab?.url) {
      console.log("[MV3] updateToolbarIcon: no tab or url, returning early");
      return;
    }

    // If filtering option is explicitly provided, use it directly
    // Otherwise read from storage to determine current state
    let isFilteringEnabled: boolean;

    if (options.filtering !== undefined) {
        isFilteringEnabled = options.filtering;
      console.log(
          "[MV3] updateToolbarIcon: using explicit filtering =",
          isFilteringEnabled,
      );
    } else {
        const hostname = new URL(tab.url).hostname;
        const pageKey = `${hostname}:${tab.url}`;
        const storedFiltering =
        await chrome.storage.local.get("perSiteFiltering");
        const perSiteFiltering = storedFiltering?.perSiteFiltering || {};
        isFilteringEnabled =
        perSiteFiltering[pageKey] !== false &&
        perSiteFiltering[hostname] !== false;
      console.log(
          "[MV3] updateToolbarIcon: reading from storage, filtering =",
          isFilteringEnabled,
      );
    }

    console.log(
        "[MV3] updateToolbarIcon: isFilteringEnabled =",
        isFilteringEnabled,
        "currentParts =",
        currentParts,
        "will set badge to:",
        isFilteringEnabled && currentParts & 0b001
            ? "blocked count or empty"
            : !isFilteringEnabled
                ? "off"
                : "empty",
    );

    // When turning ON, just clear badge immediately without checking DNR
    if (options.filtering === true) {
      console.log("[MV3] updateToolbarIcon: turning ON, about to clear badge");
      try {
          await chrome.action.setBadgeText({ text: "", tabId });
        console.log("[MV3] updateToolbarIcon: badge cleared successfully");
      } catch (e) {
        console.log("[MV3] updateToolbarIcon: ERROR clearing badge:", e);
      }
    } else if (!isFilteringEnabled) {
      // When turning OFF
      console.log("[MV3] updateToolbarIcon: turning OFF, setting badge");
      await chrome.action.setBadgeText({ text: "off", tabId });
      await chrome.action.setBadgeBackgroundColor({ color: "#888888", tabId });
    } else if (currentParts & 0b001) {
      // Normal case - filtering is on, show block count
      console.log(
          "[MV3] updateToolbarIcon: filtering on, checking block count",
      );
      const getMatchedBlockedRequestCount = async (
          tabId: number,
          minTimeStamp = 0,
      ) => {
          if (chrome.declarativeNetRequest?.getMatchedRules === undefined) return;
          try {
              const result = await chrome.declarativeNetRequest.getMatchedRules({
            tabId,
            minTimeStamp,
              });
              return result?.rulesMatchedInfo?.length || 0;
          } catch (e) {
              console.warn('[uBR] getMatchedBlockedRequestCount: failed for tab', tabId, e);
          }
      };

      const blockedCount = (await getMatchedBlockedRequestCount(tabId)) || 0;
      if (blockedCount > 0) {
          await chrome.action.setBadgeText({
          text: blockedCount > 999 ? "999+" : String(blockedCount),
          tabId,
          });
          await chrome.action.setBadgeBackgroundColor({ color: "#cc0000", tabId });
      } else {
          await chrome.action.setBadgeText({ text: "", tabId });
      }
    }

    if (options.clickToLoad) {
        const stored = await chrome.storage.local.get("clickToLoadAllowances");
        const allowances = stored?.clickToLoadAllowances || {};
        if (!allowances[tabId]) allowances[tabId] = [];
        if (!allowances[tabId].includes(options.clickToLoad)) {
        allowances[tabId].push(options.clickToLoad);
        await chrome.storage.local.set({ clickToLoadAllowances: allowances });
        }
    }
    } catch (e) {
    console.log("[MV3] updateToolbarIcon error:", e);
    }
};

export const normalizeListEntries = (value: unknown): string[] => {
    if (Array.isArray(value) === false) {
        return [];
    }
    return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry !== "");
};

export const normalizeImportedLists = normalizeListEntries;
export const normalizeSelectedFilterLists = normalizeListEntries;

export const isValidExternalList = (value: string) =>
  /^[a-z-]+:\/\/(?:\S+\/\S*|\/\S+)/i.test(value);

export const extractListURLs = (text: string): string[] =>
  text
    .split(/\s+/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && isValidExternalList(line));

export const listSupportNameFromURL = (value: string): string => {
    try {
        return new URL(value).hostname;
    } catch (e) {
        console.warn("[uBR] listSupportNameFromURL: invalid URL", value, e);
        return "";
    }
};

export const cloneObject = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value));

export const deriveDefaultSelectedFilterLists = (
    available: Record<string, any>,
    userPath: string,
): string[] => {
    const selected = [userPath];
    for (const [key, details] of Object.entries(available)) {
        if (key === userPath) {
            continue;
        }
        if (details.content !== "filters") {
            continue;
        }
        if (details.off === true) {
            continue;
        }
    selected.push(key);
    }
    return selected;
};

export const resolveBundledFilterListPath = (
    asset: any,
): string | undefined => {
    const contentURLs = Array.isArray(asset.contentURL)
        ? asset.contentURL
        : typeof asset.contentURL === "string"
            ? [asset.contentURL]
            : [];
    return contentURLs.find(
        (url) => typeof url === "string" && url.startsWith("assets/"),
    );
};

export const resolveStockAssetKeyFromURL = (
    catalog: Record<string, any>,
    urlKey: string,
): string => {
    const needle = urlKey.replace(/^https?:/, "");
    for (const [assetKey, asset] of Object.entries(catalog)) {
        if (asset.content !== "filters") {
            continue;
        }
        const contentURLs = Array.isArray(asset.contentURL)
            ? asset.contentURL
            : typeof asset.contentURL === "string"
                ? [asset.contentURL]
                : [];
        for (const contentURL of contentURLs) {
            if (contentURL.replace(/^https?:/, "") === needle) {
                return assetKey;
            }
        }
    }
    return urlKey;
};

export const buildAvailableFilterLists = (
    catalog: Record<string, any>,
    importedLists: string[],
    selectedListSet: Set<string>,
    userPath: string,
): Record<string, any> => {
    const available: Record<string, any> = {
    [userPath]: {
      content: "filters",
      group: "user",
      title: "My filters",
      off: selectedListSet.has(userPath) === false,
    },
    };

    for (const [assetKey, asset] of Object.entries(catalog)) {
        if (asset.content !== "filters") {
            continue;
        }
        available[assetKey] = {
      ...cloneObject(asset),
      off: selectedListSet.has(assetKey) === false,
        };
    }

    for (const importedList of importedLists) {
        if (available[importedList] !== undefined) {
            available[importedList].off = selectedListSet.has(importedList) === false;
            continue;
        }
        available[importedList] = {
      content: "filters",
      contentURL: importedList,
      external: true,
      group: "custom",
      submitter: "user",
      supportURL: importedList,
      supportName: listSupportNameFromURL(importedList),
      title: importedList,
      off: selectedListSet.has(importedList) === false,
        };
    }

    return available;
};

export const estimateFilterCounts = (available: Record<string, any>) => {
    let netFilterCount = 0;
    let cosmeticFilterCount = 0;
    for (const details of Object.values(available)) {
        if (details.off === true) {
            continue;
        }
        netFilterCount += details.entryCount || 0;
        cosmeticFilterCount += details.entryUsedCount || 0;
    }
    return {
    netFilterCount,
    cosmeticFilterCount,
    };
};

export const serializeCosmeticFilterData = (dnrData: any): any => ({
  genericCosmeticFilters: Array.isArray(dnrData?.genericCosmeticFilters)
      ? dnrData.genericCosmeticFilters
      : [],
  genericCosmeticExceptions: Array.isArray(dnrData?.genericCosmeticExceptions)
      ? dnrData.genericCosmeticExceptions
      : [],
  specificCosmeticFilters:
    dnrData?.specificCosmetic instanceof Map
        ? Array.from(dnrData.specificCosmetic.entries())
        : Array.isArray(dnrData?.specificCosmetic)
            ? dnrData.specificCosmetic
            : [],
  scriptletFilters:
    dnrData?.scriptlet instanceof Map
        ? Array.from(dnrData.scriptlet.entries())
        : Array.isArray(dnrData?.scriptlet)
            ? dnrData.scriptlet
            : [],
});

export const parseStoredCosmeticFilterData = (raw: unknown): any => {
    let parsed = raw;
    if (typeof parsed === "string" && parsed !== "") {
        try {
            parsed = JSON.parse(parsed);
        } catch (e) {
            console.warn("[uBR] parseStoredCosmeticFilterData: invalid JSON", e);
            parsed = {};
        }
    }
    const data =
    parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    return {
    genericCosmeticFilters: Array.isArray(data.genericCosmeticFilters)
        ? data.genericCosmeticFilters
        : [],
    genericCosmeticExceptions: Array.isArray(data.genericCosmeticExceptions)
        ? data.genericCosmeticExceptions
        : [],
    specificCosmeticFilters: Array.isArray(data.specificCosmeticFilters)
        ? data.specificCosmeticFilters
        : [],
    scriptletFilters: Array.isArray(data.scriptletFilters)
        ? data.scriptletFilters
        : [],
    };
};

export const hostnameMatchesFilterScope = (
    pageHostname: string,
    scope: string,
): boolean => {
    if (scope === "*") {
        return true;
    }
    if (scope === pageHostname) {
        return true;
    }
    return pageHostname.endsWith(`.${scope}`);
};

const proceduralPrehideOperatorNames = [
    "has-text",
    "matches-path",
    "matches-css-after",
    "matches-css-before",
    "matches-css",
    "matches-attr",
    "matches-prop",
    "matches-media",
    "min-text-length",
    "watch-attr",
    "remove-class",
    "remove-attr",
    "upward",
    "xpath",
    "spath",
    "shadow",
    "others",
    "if-not",
    "has",
    "if",
    "not",
    "remove",
];

export const topLevelProceduralOperatorIndex = (selector: string): number => {
    let quote = "";
    let escaped = false;
    let squareDepth = 0;
    let parenDepth = 0;
    for (let i = 0; i < selector.length; i += 1) {
        const ch = selector[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            escaped = true;
            continue;
        }
        if (quote !== "") {
            if (ch === quote) {
                quote = "";
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === "[") {
            squareDepth += 1;
            continue;
        }
        if (ch === "]" && squareDepth !== 0) {
            squareDepth -= 1;
            continue;
        }
        if (squareDepth !== 0) {
            continue;
        }
        if (ch === "(") {
            parenDepth += 1;
            continue;
        }
        if (ch === ")" && parenDepth !== 0) {
            parenDepth -= 1;
            continue;
        }
        if (ch !== ":" || parenDepth !== 0) {
            continue;
        }
        for (const operator of proceduralPrehideOperatorNames) {
            if (selector.startsWith(`${operator}(`, i + 1)) {
                return i;
            }
        }
    }
    return -1;
};

export const isProceduralCosmeticSelector = (selector: string): boolean => {
    const normalized = selector.trim();
    return normalized.startsWith("{") ||
        topLevelProceduralOperatorIndex(normalized) !== -1;
};

const hasSpecificPrehideAnchor = (selector: string): boolean =>
    selector !== "" &&
    selector !== "*" &&
    (selector.includes("#") || selector.includes(".") || selector.includes("[")) &&
    /[>+~]$/.test(selector) === false;

export const topLevelProceduralOperatorArgument = (
    selector: string,
    wantedOperator: string,
): string => {
    let quote = "";
    let escaped = false;
    let squareDepth = 0;
    let parenDepth = 0;
    for (let i = 0; i < selector.length; i += 1) {
        const ch = selector[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === "\\") {
            escaped = true;
            continue;
        }
        if (quote !== "") {
            if (ch === quote) {
                quote = "";
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === "[") {
            squareDepth += 1;
            continue;
        }
        if (ch === "]" && squareDepth !== 0) {
            squareDepth -= 1;
            continue;
        }
        if (squareDepth !== 0) {
            continue;
        }
        if (ch === "(") {
            parenDepth += 1;
            continue;
        }
        if (ch === ")" && parenDepth !== 0) {
            parenDepth -= 1;
            continue;
        }
        if (ch !== ":" || parenDepth !== 0) {
            continue;
        }
        if (selector.startsWith(`${wantedOperator}(`, i + 1) === false) {
            continue;
        }
        const argStart = i + wantedOperator.length + 2;
        const argEnd = selector.indexOf(")", argStart);
        return argEnd === -1 ? "" : selector.slice(argStart, argEnd).trim();
    }
    return "";
};

export const ancestorPrehideSelectorFromUpward = (
    selector: string,
    anchorSelector: string,
): string => {
    const upwardArg = topLevelProceduralOperatorArgument(selector, "upward");
    if (/^\d+$/.test(upwardArg) === false) {
        return "";
    }
    const distance = parseInt(upwardArg, 10);
    if (distance < 1 || distance > 8) {
        return "";
    }
    const chain = [
        ...Array.from({ length: distance - 1 }, () => "*"),
        anchorSelector,
    ].join(" > ");
    return `:is(article,aside,div,li,main,nav,section):has(> ${chain})`;
};

export const prehideSelectorFromProceduralSelector = (raw: string): string => {
    const selector = raw.trim();
    if (selector === "" || selector.startsWith("{")) {
        return "";
    }
    const operatorIndex = topLevelProceduralOperatorIndex(selector);
    if (operatorIndex === -1) {
        return "";
    }
    const prehide = selector.slice(0, operatorIndex).trim();
    if (hasSpecificPrehideAnchor(prehide) === false) {
        return "";
    }
    const ancestorPrehide = ancestorPrehideSelectorFromUpward(selector, prehide);
    return ancestorPrehide === ""
        ? prehide
        : `${ancestorPrehide},\n${prehide}`;
};

export const buildSpecificCosmeticPayload = (
    pageHostname: string,
    storedData: any,
) => {
    const injectedSelectors: string[] = [];
    const proceduralFilters: Array<{ selector: string }> = [];
    for (const entry of storedData.specificCosmeticFilters) {
        if (Array.isArray(entry) === false || entry.length < 2) {
            continue;
        }
        const [selector, details] = entry;
        if (typeof selector !== "string" || selector === "") {
            continue;
        }
        if (selector.startsWith("{")) {
            continue;
        }
        if (details?.rejected === true) {
            continue;
        }
        const matches = Array.isArray(details?.matches) ? details.matches : [];
        const excludeMatches = Array.isArray(details?.excludeMatches)
            ? details.excludeMatches
            : [];
        const included =
      matches.length === 0
          ? true
          : matches.some((scope: string) =>
              hostnameMatchesFilterScope(pageHostname, scope),
          );
        if (included === false) {
            continue;
        }
        const excluded = excludeMatches.some((scope: string) =>
            hostnameMatchesFilterScope(pageHostname, scope),
        );
        if (excluded) {
            continue;
        }
        if (isProceduralCosmeticSelector(selector)) {
            proceduralFilters.push({ selector });
            const prehide = prehideSelectorFromProceduralSelector(selector);
            if (prehide !== "") {
                injectedSelectors.push(prehide);
            }
        } else {
            injectedSelectors.push(selector);
        }
    }

    const injectedCSS =
    injectedSelectors.length === 0
        ? ""
        : `${injectedSelectors.join(",\n")}\n{display:none!important;}`;

    return {
        ready: true,
        injectedSelectors,
        injectedCSS,
        proceduralFilters,
        exceptionFilters: [],
        exceptedFilters: [],
        convertedProceduralFilters: [],
        genericCosmeticHashes: [],
        disableSurveyor: false,
    };
};

export const getDeviceName = async (): Promise<string> => {
    const stored = await chrome.storage.local.get("cloudOptions") as Record<string, any>;
    const name = stored?.cloudOptions?.deviceName;
    if (name) return name;
    const info = await chrome.runtime.getPlatformInfo();
    const os = info.os || "unknown";
    const deviceName = `${os}-device-${Date.now().toString(36).slice(-6)}`;
    await chrome.storage.local.set({ cloudOptions: { deviceName } });
    return deviceName;
};

export const encodeCloudData = async (data: any): Promise<string> => {
    const json = JSON.stringify(data);
    const stored = await chrome.storage.local.get("hiddenSettings") as Record<string, any>;
    const hiddenSettings = stored?.hiddenSettings || {};
    const useCompression = hiddenSettings.cloudStorageCompression === true;
    if (useCompression) {
        const compressed = await compressString(json);
        return `2:${  compressed}`;
    }
    const encoded = btoa(unescape(encodeURIComponent(json)));
    return `1:${  encoded}`;
};

const compressString = async (str: string): Promise<string> => {
    if (typeof CompressionStream === 'undefined') {
        return btoa(unescape(encodeURIComponent(str)));
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    void writer.write(data);
    void writer.close();
    const reader = cs.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return btoa(String.fromCharCode(...result));
};

const decompressString = async (encoded: string): Promise<string> => {
    if (typeof DecompressionStream === 'undefined') {
        return decodeURIComponent(escape(atob(encoded)));
    }
    const binaryStr = atob(encoded);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    void writer.write(bytes);
    void writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    const decoder = new TextDecoder();
    return decoder.decode(result);
};

export const decodeCloudData = async (encoded: string): Promise<any> => {
    try {
        let dataStr = encoded;
        if (encoded.startsWith("2:")) {
            dataStr = encoded.substring(2);
            const json = await decompressString(dataStr);
            return JSON.parse(json);
        } else if (encoded.startsWith("1:")) {
            dataStr = encoded.substring(2);
        }
        const json = decodeURIComponent(escape(atob(dataStr)));
        return JSON.parse(json);
    } catch (e) {
        console.warn("[uBR] decodeCloudData: failed to decode", e);
        return null;
    }
};

export const cloudPush = async (data: any): Promise<void> => {
    const encoded = await encodeCloudData(data);
    try {
        if (chrome.storage.sync) {
            await chrome.storage.sync.set({ cloudData: encoded });
        } else {
            await chrome.storage.local.set({ cloudData: encoded });
        }
    } catch (e) {
    console.log("[MV3] cloudPush error:", e);
    }
};

export const cloudPull = async (): Promise<any> => {
    try {
        const stored = chrome.storage.sync
            ? await chrome.storage.sync.get("cloudData")
            : await chrome.storage.local.get("cloudData");
        if (stored?.cloudData) {
            return await decodeCloudData(stored.cloudData as string);
        }
    } catch (e) {
    console.log("[MV3] cloudPull error:", e);
    }
    return null;
};

export const pickerContextPoints = new Map<
  string,
  {
    x: number;
    y: number;
    timestamp: number;
  }
>();

export const pickerContextPointKey = (tabId: number, frameId: number) =>
    `${tabId}:${frameId}`;

export const getPickerContextPoint = (tabId: number, frameId = 0) => {
    const now = Date.now();
    const exact = pickerContextPoints.get(pickerContextPointKey(tabId, frameId));
    if (exact && now - exact.timestamp < 10_000) {
        return exact;
    }
    const topFrame = pickerContextPoints.get(pickerContextPointKey(tabId, 0));
    if (topFrame && now - topFrame.timestamp < 10_000) {
        return topFrame;
    }
    return undefined;
};
