/*******************************************************************************

    uBlock Origin - MV3 Popup Panel Message Handlers
    https://github.com/gorhill/uBlock

    This file contains message handlers for the popup panel.

*******************************************************************************/

import { PopupState } from "./sw-storage.js";

export interface PopupRequest {
  what: string;
  tabId?: number | null;
  name?: string;
  value?: any;
  hostname?: string;
  state?: boolean;
  srcHostname?: string;
  desHostname?: string;
  desHostnames?: Record<string, unknown>;
  requestType?: string;
  action?: number;
  persist?: boolean;
  url?: string;
  scope?: string;
  frameId?: number;
  frameURL?: string;
  userFilters?: string;
  enabled?: boolean;
  data?: any;
  deviceName?: string;
  syncEnabled?: boolean;
  assetKeys?: string[];
  preferOrigin?: boolean;
  toSelect?: string[];
  toImport?: string;
  toRemove?: string[];
  userData?: unknown;
  file?: string;
  [key: string]: any;
}

export type MessageHandlersDeps = {
  popupState: PopupState;
  getPopupData: (_request: PopupRequest) => Promise<any>;
  getTabSwitchMetrics: (_tabId: number) => Promise<any>;
  getHiddenElementCountForTab: (_tabId: number) => Promise<number>;
  pageStoreFromTabId: (_tabId: number) => Promise<any>;
  setUserSetting: (_request: PopupRequest) => Promise<any>;
  toggleNetFiltering: (_request: PopupRequest) => Promise<any>;
  toggleFirewallRule: (_request: PopupRequest) => Promise<any>;
  saveFirewallRules: (_request: PopupRequest) => Promise<any>;
  revertFirewallRules: (_request: PopupRequest) => Promise<any>;
  toggleHostnameSwitch: (_request: PopupRequest) => Promise<any>;
  updateToolbarIcon: (
    _tabId: number,
    _options: { filtering?: boolean },
  ) => Promise<void>;
};

export const createMessageHandlers = (deps: MessageHandlersDeps) => {
    const {
        popupState,
        getPopupData,
        getTabSwitchMetrics,
        getHiddenElementCountForTab,
        pageStoreFromTabId,
        setUserSetting,
        toggleNetFiltering,
        toggleFirewallRule,
        saveFirewallRules,
        revertFirewallRules,
        toggleHostnameSwitch,
        updateToolbarIcon,
    } = deps;

    const handlePopupPanelMessage = async (request: PopupRequest) => {
        const handlers = new Map<string, () => any>();

        handlers.set('getPopupData', async () => {
            const result = await getPopupData(request);
            if (request.tabId) {
                const storedFiltering =
                    await chrome.storage.local.get("perSiteFiltering");
                const perSiteFiltering = storedFiltering?.perSiteFiltering || {};
                try {
                    const tab = await chrome.tabs.get(request.tabId);
                    if (tab?.url) {
                        const hostname = new URL(tab.url).hostname;
                        const pageKey = `${hostname}:${tab.url}`;
                        const isFiltering =
                            perSiteFiltering[pageKey] !== false &&
                            perSiteFiltering[hostname] !== false;
                        await updateToolbarIcon(request.tabId, { filtering: isFiltering });
                    }
                } catch (e) {
                    console.warn('[uBR] handlePopupPanelMessage: failed to update toolbar icon for tab', request.tabId, e);
                }
            }
            return result;
        });

        handlers.set('toggleNetFiltering', () => toggleNetFiltering(request));
        handlers.set('toggleFirewallRule', () => toggleFirewallRule(request));
        handlers.set('saveFirewallRules', () => saveFirewallRules(request));
        handlers.set('revertFirewallRules', () => revertFirewallRules(request));

        handlers.set('getScriptCount', async () =>
            request.tabId
                ? (await getTabSwitchMetrics(request.tabId)).scriptCount
                : 0,
        );

        handlers.set('getHiddenElementCount', async () =>
            request.tabId
                ? await getHiddenElementCountForTab(request.tabId)
                : 0,
        );

        handlers.set('toggleHostnameSwitch', () => toggleHostnameSwitch(request));

        handlers.set('userSettings', () => setUserSetting(request));

        handlers.set('readyToFilter', () => popupState.initialized);

        handlers.set('clickToLoad', async () => {
            const tabId = request.tabId as number;
            const frameId = request.frameId as number;
            const frameURL = request.frameURL as string;
            if (tabId && frameId && frameURL) {
                const pageStore = await pageStoreFromTabId(tabId);
                if (pageStore) {
                    await pageStore.clickToLoad(frameId, frameURL);
                }
            }
            return { success: true };
        });

        handlers.set('reloadTab', async () => {
            const { tabId: rtTabId, bypassCache, url } = request;
            if (rtTabId) {
                if (typeof url === "string" && url !== "") {
                    chrome.tabs.get(rtTabId, (tab) => {
                        if (chrome.runtime.lastError) return;
                        if (tab?.url && tab.url !== url) {
                            chrome.tabs.update(rtTabId, { url }).catch(() => {});
                        } else {
                            chrome.tabs.reload(rtTabId, { bypassCache: !!bypassCache }).catch(() => {});
                        }
                    });
                } else {
                    chrome.tabs.reload(rtTabId, { bypassCache: !!bypassCache }).catch(() => {});
                }
            }
            return {};
        });

        handlers.set('hasPopupContentChanged', async () => {
            const changedTabId = request.tabId as number;
            const contentLastModified = request.contentLastModified as number;
            if (typeof changedTabId !== "number") return { changed: false };
            const stored = await chrome.storage.local.get("popupContentVersions");
            const versions = stored?.popupContentVersions || {};
            const storedVersion = versions[changedTabId] || 0;
            const changed = storedVersion !== 0 && storedVersion !== contentLastModified;
            if (changed || storedVersion === 0) {
                versions[changedTabId] = Date.now();
                await chrome.storage.local.set({ popupContentVersions: versions });
            }
            return { changed };
        });

        handlers.set('dismissUnprocessedRequest', async () => {
            const duTabId = request.tabId as number;
            if (typeof duTabId === "number") {
                const vAPINet = (globalThis as any).vAPI?.net;
                if (vAPINet?.removeUnprocessedRequest) {
                    vAPINet.removeUnprocessedRequest(duTabId);
                }
                const stored = await chrome.storage.local.get("unprocessedRequests");
                const unprocessed = stored?.unprocessedRequests || {};
                delete unprocessed[duTabId];
                await chrome.storage.local.set({ unprocessedRequests: unprocessed });
                await updateToolbarIcon(duTabId, { filtering: true });
            }
            return { success: true };
        });

        const handler = handlers.get(request.what);
        if (handler) return handler();
        return undefined;
    };

    return {
        handlePopupPanelMessage,
    };
};
