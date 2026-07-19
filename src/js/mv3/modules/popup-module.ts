/*******************************************************************************

    uBlock Origin - MV3 Popup Panel Handler Module
    https://github.com/gorhill/uBlock

    Generalized handler module for the popup panel messaging channel.
    Exports typed Handler<SWContext> descriptors instead of a factory function
    with a custom deps interface.

*******************************************************************************/

import type { HandlerModule, Handler } from "../handler-registry.js";
import type { SWContext } from "../sw-context.js";

const handlers: Handler<SWContext>[] = [

    {
        channel: "popupPanel",
        what: "gotoURL",
        handler: async (request) => {
            const details = request.details || request;
            const url = details?.url;
            if (!url) return { success: false };
            const normalized = /^[a-z][a-z\d+\-.]*:/i.test(url)
                ? url
                : chrome.runtime.getURL(url.replace(/^\/+/, ""));
            chrome.tabs.create({
                url: normalized,
                active: details.shiftKey ? false : details.select !== false,
                index: typeof details.index === "number" && details.index >= 0 ? details.index : undefined,
            }).catch(() => {});
            return { success: true };
        },
    },

    {
        channel: "popupPanel",
        what: "getPopupData",
        handler: async (request, ctx) => {
            const result = await ctx.getPopupData(request);
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
                        await ctx.updateToolbarIcon(request.tabId, { filtering: isFiltering });
                    }
                } catch (e) {
                    console.warn('[popup-module] getPopupData: failed to update toolbar icon for tab', request.tabId, e);
                }
            }
            return result;
        },
    },

    {
        channel: "popupPanel",
        what: "toggleNetFiltering",
        handler: (request, ctx) => ctx.toggleNetFiltering(request),
    },

    {
        channel: "popupPanel",
        what: "toggleFirewallRule",
        handler: (request, ctx) => ctx.toggleFirewallRule(request),
    },

    {
        channel: "popupPanel",
        what: "saveFirewallRules",
        handler: (request, ctx) => ctx.saveFirewallRules(request),
    },

    {
        channel: "popupPanel",
        what: "revertFirewallRules",
        handler: (request, ctx) => ctx.revertFirewallRules(request),
    },

    {
        channel: "popupPanel",
        what: "getScriptCount",
        handler: async (request, ctx) => {
            if (!request.tabId) return 0;
            const metrics = await ctx.getTabSwitchMetrics(request.tabId);
            return metrics.scriptCount;
        },
    },

    {
        channel: "popupPanel",
        what: "getHiddenElementCount",
        handler: async (request, ctx) => {
            if (!request.tabId) return 0;
            return ctx.getHiddenElementCountForTab(request.tabId);
        },
    },

    {
        channel: "popupPanel",
        what: "toggleHostnameSwitch",
        handler: (request, ctx) => ctx.toggleHostnameSwitch(request),
    },

    {
        channel: "popupPanel",
        what: "userSettings",
        handler: (request, ctx) => ctx.setUserSetting(request),
    },

    {
        channel: "popupPanel",
        what: "readyToFilter",
        handler: (_request, ctx) => ctx.popupState.initialized,
    },

    {
        channel: "popupPanel",
        what: "clickToLoad",
        handler: async (request, ctx) => {
            const tabId = request.tabId as number;
            const frameId = request.frameId as number;
            const frameURL = request.frameURL as string;
            if (tabId && frameId && frameURL) {
                const pageStore = await ctx.pageStoreFromTabId(tabId);
                if (pageStore) {
                    await pageStore.clickToLoad(frameId, frameURL);
                }
            }
            return { success: true };
        },
    },

    {
        channel: "popupPanel",
        what: "reloadTab",
        handler: async (request, _ctx) => {
            const tabId = request.tabId;
            const bypassCache = request.bypassCache;
            const url = request.url;
            if (tabId) {
                if (typeof url === "string" && url !== "") {
                    const tab = await chrome.tabs.get(tabId).catch(() => null);
                    if (tab?.url && tab.url !== url) {
                        chrome.tabs.update(tabId, { url }).catch(() => {});
                    } else {
                        chrome.tabs.reload(tabId, { bypassCache: !!bypassCache }).catch(() => {});
                    }
                } else {
                    chrome.tabs.reload(tabId, { bypassCache: !!bypassCache }).catch(() => {});
                }
            }
            return {};
        },
    },

    {
        channel: "popupPanel",
        what: "hasPopupContentChanged",
        handler: async (request, _ctx) => {
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
        },
    },

    {
        channel: "popupPanel",
        what: "dismissUnprocessedRequest",
        handler: async (request, ctx) => {
            const tabId = request.tabId as number;
            if (typeof tabId === "number") {
                const vAPINet = (globalThis as any).vAPI?.net;
                if (vAPINet?.removeUnprocessedRequest) {
                    vAPINet.removeUnprocessedRequest(tabId);
                }
                const stored = await chrome.storage.local.get("unprocessedRequests");
                const unprocessed = stored?.unprocessedRequests || {};
                delete unprocessed[tabId];
                await chrome.storage.local.set({ unprocessedRequests: unprocessed });
                await ctx.updateToolbarIcon(tabId, { filtering: true });
            }
            return { success: true };
        },
    },
];

export const popupModule: HandlerModule<SWContext> = {
    domain: "popup-panel",
    handlers,
};
