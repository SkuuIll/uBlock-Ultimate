/*******************************************************************************

    uBlock Origin - MV3 Page Store
    https://github.com/gorhill/uBlock

    This file contains MV3PageStore, FrameStore, and pageStores management.

******************************************************************************/

import type { FirewallCounts, FirewallCount } from "./sw-types.js";
import { domainFromHostname } from "./sw-helpers.js";

export class FrameStore {
    frameURL: string;
    parentId: number;
    clickToLoad: boolean;
    type: number;
    timestamp: number;

    constructor(frameURL: string, parentId: number) {
        this.frameURL = frameURL;
        this.parentId = parentId;
        this.clickToLoad = false;
        this.type = 0;
        this.timestamp = Date.now();
    }

    init(frameURL: string, parentId: number): void {
        this.frameURL = frameURL;
        this.parentId = parentId;
        this.clickToLoad = false;
        this.type = 0;
        this.timestamp = Date.now();
    }

    dispose(): void {
        this.frameURL = "";
        this.parentId = 0;
        this.clickToLoad = false;
    }

    updateURL(url: string): void {
        this.frameURL = url;
        this.timestamp = Date.now();
    }

    getCosmeticFilteringBits(_tabId: number): number {
        return 0;
    }

    shouldApplySpecificCosmeticFilters(_tabId: number): boolean {
        return true;
    }

    shouldApplyGenericCosmeticFilters(_tabId: number): boolean {
        return true;
    }
}

export class MV3PageStore {
    tabId: number;
    rawURL: string;
    hostname: string;
    rootHostname: string;
    rootDomain: string;
    title: string;
    netFilteringSwitch: boolean;
    contentLastModified: number;
    largeMediaCount: number;
    remoteFontCount: number;
    popupBlockedCount: number;
    counts: { blocked: FirewallCount; allowed: FirewallCount };
    hostnameDetailsMap: Map<
    string,
    { domain: string; counts: FirewallCounts; cname?: string }
  >;
    frameStores: Map<number, FrameStore>;
    extraData: Map<string, any>;
    allowLargeMediaElementsUntil: number;

    constructor(tabId: number) {
        this.tabId = tabId;
        this.rawURL = "";
        this.hostname = "";
        this.rootHostname = "";
        this.rootDomain = "";
        this.title = "";
        this.netFilteringSwitch = true;
        this.contentLastModified = 0;
        this.largeMediaCount = 0;
        this.remoteFontCount = 0;
        this.popupBlockedCount = 0;
        this.counts = {
      blocked: { any: 0, frame: 0, script: 0 },
      allowed: { any: 0, frame: 0, script: 0 },
        };
        this.hostnameDetailsMap = new Map();
        this.frameStores = new Map();
        this.extraData = new Map();
        this.allowLargeMediaElementsUntil = 0;
    }

    async initialize(tab: chrome.tabs.Tab): Promise<void> {
        if (!tab?.url || tab.id === undefined) return;

        try {
            const url = new URL(tab.url);
            this.rawURL = tab.url;
            this.hostname = url.hostname;
            this.tabId = tab.id;

            const parts = this.hostname.split(".");
            if (parts.length >= 2) {
                this.rootDomain = domainFromHostname(this.hostname);
                this.rootHostname = this.rootDomain
                    ? this.rootDomain.split(".")[0]
                    : parts.slice(-2)[0];
            } else {
                this.rootHostname = this.hostname;
                this.rootDomain = this.hostname;
            }

            // Read perSiteFiltering from storage and use it
            const pageKey = `${this.hostname}:${this.rawURL}`;
            const hostnameKey = this.hostname;

            // Force re-read from storage on every initialization to get latest state
            // In case pageStore was cached from a previous load
            const latestFiltering =
        await chrome.storage.local.get("perSiteFiltering");
            const latestPerSite = latestFiltering?.perSiteFiltering || {};
            this.netFilteringSwitch =
        latestPerSite[pageKey] !== false &&
        latestPerSite[hostnameKey] !== false;
      console.log(
          "[MV3] MV3PageStore.initialize: hostname =",
        this.hostname,
        "netFilteringSwitch =",
        this.netFilteringSwitch,
        "perSiteFiltering =",
        latestPerSite,
      );

      const storedVersions = await chrome.storage.local.get(
          "popupContentVersions",
      );
      const versions = storedVersions?.popupContentVersions || {};
      this.contentLastModified = versions[tab.id] || 0;

      const storedMetrics = await chrome.storage.local.get("tabMetrics");
      const metrics = storedMetrics?.tabMetrics || {};
      const tabMetric = metrics[tab.id] || {};
      this.largeMediaCount = tabMetric.largeMediaCount || 0;
      this.remoteFontCount = tabMetric.remoteFontCount || 0;
      this.popupBlockedCount = tabMetric.popupBlockedCount || 0;
      this.counts.blocked = tabMetric.blocked || {
        any: 0,
        frame: 0,
        script: 0,
      };
      this.counts.allowed = tabMetric.allowed || {
        any: 0,
        frame: 0,
        script: 0,
      };
        } catch (e) {
      console.log("[MV3] MV3PageStore.initialize error:", e);
        }
    }

    getNetFilteringSwitch(): boolean {
        return this.netFilteringSwitch;
    }

    async setNetFilteringSwitch(url: string, scope: string, state: boolean): Promise<void> {
        const hostnameKey = this.hostname;
        const urlKey = `${this.hostname}:${url}`;
        if (state === false) {
            const stored = await chrome.storage.local.get("perSiteFiltering");
            const perSiteFiltering = stored?.perSiteFiltering || {};
            perSiteFiltering[hostnameKey] = false;
            perSiteFiltering[urlKey] = false;
            await chrome.storage.local.set({ perSiteFiltering });
        } else {
            const stored = await chrome.storage.local.get("perSiteFiltering");
            const perSiteFiltering = stored?.perSiteFiltering || {};
            delete perSiteFiltering[hostnameKey];
            delete perSiteFiltering[urlKey];
            await chrome.storage.local.set({ perSiteFiltering });
        }
        this.netFilteringSwitch = state;
    }

    toggleNetFilteringSwitch(url: string, scope: string, state: boolean): void {
        void this.setNetFilteringSwitch(url, scope, state);
    }

    getAllHostnameDetails(): Map<string, any> {
        return this.hostnameDetailsMap;
    }

    disposeFrameStores(): void {
    this.frameStores.clear();
    }
}

export const pageStores = new Map<number, MV3PageStore>();
export let pageStoresToken = 0;

export const pageStoreFromTabId = async (
    tabId: number,
): Promise<MV3PageStore | null> => {
    let pageStore = pageStores.get(tabId);
    if (pageStore) {
    // Re-initialize to get the latest state from storage
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab) {
                await pageStore.initialize(tab);
            }
        } catch (e) {
            console.warn('[uBR] pageStoreFromTabId: tabs.get failed for existing store', tabId, e);
        }
        pageStoresToken += 1;
        return pageStore;
    }

    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab) return null;

        pageStore = new MV3PageStore(tabId);
        await pageStore.initialize(tab);
    pageStores.set(tabId, pageStore);
    pageStoresToken += 1;
    return pageStore;
    } catch (e) {
        console.warn('[uBR] pageStoreFromTabId: failed to create page store for tab', tabId, e);
        return null;
    }
};

export const mustLookup = async (
    tabId: number,
): Promise<MV3PageStore | null> => {
    return pageStoreFromTabId(tabId);
};
