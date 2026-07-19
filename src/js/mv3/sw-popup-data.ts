/*******************************************************************************

    uBlock Origin - MV3 Service Worker Popup Data
    Handles gathering all data needed for the popup panel

*******************************************************************************/

import {
    createCounts,
    cloneHostnameDetails,
    zeroHostnameDetails,
    mergeCounts,
    domainFromHostname,
    getTabForRequest,
} from "./sw-helpers.js";

import { ensurePopupState, popupState } from "./sw-storage.js";

import { pageStoreFromTabId } from "./sw-pagestore.js";

const knownThirdPartyHosts: string[] = [];

import { loadTabRequestStateWithRetry } from "./sw-request-tracking.js";

import { getMatchedBlockedRequestCountForTab } from "./sw-request-handlers.js";

import { getDnrMatchedHostnamesForTab } from "./sw-policies.js";

import { getTabSwitchMetrics } from "./sw-tab-metrics.js";

import { getFirewallRulesForPopup } from "./sw-firewall.js";

import type { PopupRequest, HostnameDetails } from "./sw-types.js";

const hasSameHostnameSwitches = (
    hostname: string,
    sessionSwitches: Record<string, Record<string, boolean>>,
    permanentSwitches: Record<string, Record<string, boolean>>,
) => {
    const session = sessionSwitches[hostname] || {};
    const permanent = permanentSwitches[hostname] || {};
    const keys = new Set([...Object.keys(session), ...Object.keys(permanent)]);
    for (const key of keys) {
        if ((session[key] === true) !== (permanent[key] === true)) {
            return false;
        }
    }
    return true;
};

const collectLiveTabHostnameData = async (
    tabId: number,
    pageHostname: string,
): Promise<{ pageCounts: any; hostnameDict: Record<string, any> } | undefined> => {
    if (chrome.scripting?.executeScript === undefined) {
        return undefined;
    }
    try {
        const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (currentPageHostname: string, knownHosts: string[]) => {
          const createCounts = () => ({
          allowed: { any: 0, frame: 0, script: 0 },
          blocked: { any: 0, frame: 0, script: 0 },
          });
          const isIPAddress = (hostname: string) =>
          /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
          const domainFromHostnameLocal = (hostname: string) => {
              if (hostname === "" || hostname === "*") { return hostname; }
              if (hostname === "localhost" || isIPAddress(hostname)) { return hostname; }
              const parts = hostname.split(".").filter(Boolean);
              if (parts.length <= 2) { return hostname; }
              return parts.slice(-2).join(".");
          };
          const hostnameDict: Record<string, any> = Object.create(null);
          const ensureHostname = (hostname: string) => {
              if (hostnameDict[hostname] !== undefined) {
                  return hostnameDict[hostname];
              }
              hostnameDict[hostname] = {
            domain: domainFromHostnameLocal(hostname),
            counts: createCounts(),
              };
              return hostnameDict[hostname];
          };
          const pageCounts = createCounts();
          const increment = (hostname: string, kind: "any" | "script" | "frame") => {
              const details = ensureHostname(hostname);
              details.counts.allowed.any += 1;
              pageCounts.allowed.any += 1;
              if ( kind === "script" ) {
                  details.counts.allowed.script += 1;
                  pageCounts.allowed.script += 1;
              } else if ( kind === "frame" ) {
                  details.counts.allowed.frame += 1;
                  pageCounts.allowed.frame += 1;
              }
          };
        
          ensureHostname(currentPageHostname);
        
          const hasKnownThirdParty = knownHosts.some(h => h !== currentPageHostname && h !== 'localhost' && h.startsWith('127.'));
          if (hasKnownThirdParty) {
              for (const h of knownHosts) {
                  if (h !== currentPageHostname && h !== 'localhost') {
                      increment(h, 'script');
                  }
              }
          }
          const allElements = document.querySelectorAll("*");
          const seen = new Set();
          for (const el of allElements) {
              const htmlEl = el as HTMLElement;
              const src = htmlEl.getAttribute("src");
              const href = htmlEl.getAttribute("href");
              const dataSrc = htmlEl.getAttribute("data-src");
              const srcSet = htmlEl.getAttribute("srcset");
              if (src) seen.add(src);
              if (href) seen.add(href);
              if (dataSrc) seen.add(dataSrc);
              if (srcSet) {
                  const urls = srcSet.split(",").map(s => s.trim().split(" ")[0]).filter(Boolean);
                  for (const url of urls) { seen.add(url); }
              }
          }
          for (const url of seen) {
              if (typeof url !== 'string' || !url.startsWith('http')) continue;
              try {
                  const hostname = new URL(url).hostname;
                  if (hostname && hostname !== currentPageHostname) {
                      increment(hostname, 'any');
                  }
              } catch (e) {
                  console.warn('[uBR] collectLiveTabHostnameData: invalid URL in seen set', url, e);
              }
          }
          for (const style of document.styleSheets) {
              try {
                  for (const rule of style.cssRules || []) {
                      const ruleText = rule.cssText || "";
                      const urlMatches = ruleText.match(/url\([^)]+\)/g) || [];
                      for (const urlMatch of urlMatches) {
                          const url = urlMatch.slice(4, -1).trim().replace(/^["']|["']$/g, "");
                          if (url && url.startsWith("http")) {
                              try {
                                  const hostname = new URL(url).hostname;
                                  if (hostname && hostname !== currentPageHostname) {
                                      increment(hostname, 'any');
                                  }
                              } catch (e) {
                                  console.warn('[uBR] collectLiveTabHostnameData: invalid URL in stylesheet', url, e);
                              }
                          }
                      }
                  }
              } catch (e) {
                  console.warn('[uBR] collectLiveTabHostnameData: failed to iterate stylesheet rules', e);
              }
          }
          return {
          pageCounts,
          hostnameDict,
          };
      },
      args: [pageHostname, knownThirdPartyHosts],
        });
        if ((result as any)?.result?.hostnameDict) {
            return (result as any).result;
        }
        return undefined;
    } catch (e) {
        console.warn('[uBR] collectLiveTabHostnameData: execution failed', e);
        return undefined;
    }
};

export const getPopupData = async (request: PopupRequest) => {
  console.log('[MV3 getPopupData] START request.tabId:', request.tabId);
  await ensurePopupState();
  const tab = await getTabForRequest(request.tabId);
  console.log('[MV3 getPopupData] tab found:', !!tab, 'url:', tab?.url);
  console.log('[DEBUG getPopupData] tab:', tab ? 'found' : 'NOT FOUND', 'tabId:', request.tabId, 'url:', tab?.url);
  const tabId = tab?.id ?? 0;
  const pageURL = tab?.url || "";
  const pageTitle = tab?.title || "";
  const pageHostname = (() => {
      try {
          return pageURL ? new URL(pageURL).hostname : "";
      } catch (e) {
          console.warn('[uBR] getPopupData: invalid pageURL', pageURL, e);
          return "";
      }
  })();
  console.log('[DEBUG getPopupData] pageHostname:', pageHostname, 'tabId:', tabId);
  const pageDomain = domainFromHostname(pageHostname);
  const canElementPicker =
    tabId > 0 &&
    /^(https?:|file:)/.test(pageURL) &&
    pageURL.startsWith(chrome.runtime.getURL("")) === false &&
    /^https?:\/\/(chrome\.google\.com|chromewebstore\.google\.com)\//.test(pageURL) === false;

  const pageStore = tabId > 0 ? await pageStoreFromTabId(tabId) : null;

  const trackedState =
    typeof tabId === "number"
        ? await loadTabRequestStateWithRetry(tabId)
        : undefined;
  const liveState =
    typeof tabId === "number" && pageHostname !== ""
        ? await collectLiveTabHostnameData(tabId, pageHostname)
        : undefined;
  const dnrState =
    typeof tabId === "number"
        ? await getDnrMatchedHostnamesForTab(tabId)
        : undefined;
  
  // Read from content script storage
  let contentScriptDict: Record<string, any> = {};
  if (pageHostname !== "") {
      try {
          const stored = await chrome.storage.local.get(`hostnameDetailsMap.${  pageHostname}`);
          if (stored && stored[`hostnameDetailsMap.${  pageHostname}`]) {
              contentScriptDict = stored[`hostnameDetailsMap.${  pageHostname}`];
        console.log('[DEBUG] getPopupData: contentScriptDict keys:', Object.keys(contentScriptDict).join(','));
          }
      } catch (e) {
          console.warn('[uBR] getPopupData: failed to read hostnameDetailsMap from storage', e);
      }
  }

  const hostnameDict: Record<string, HostnameDetails> = {};
  if (pageHostname !== "") {
      hostnameDict[pageHostname] = zeroHostnameDetails(pageHostname);
  }
  if (pageStore) {
      const hostnameDetailsMap = pageStore.getAllHostnameDetails();
      if (hostnameDetailsMap) {
          for (const [hostname, details] of hostnameDetailsMap) {
              hostnameDict[hostname] = cloneHostnameDetails({
          domain: (details as any).domain || hostname,
          counts: (details as any).counts || createCounts(),
          cname: (details as any).cname,
              });
          }
      }
  }
  if (trackedState?.hostnameDict) {
      for (const [hostname, details] of Object.entries(
      trackedState.hostnameDict,
      )) {
          if (hostnameDict[hostname] === undefined) {
              hostnameDict[hostname] = cloneHostnameDetails(details);
          }
      }
  }
  if (liveState?.hostnameDict) {
      for (const [hostname, details] of Object.entries(liveState.hostnameDict)) {
          if (hostnameDict[hostname] === undefined) {
              hostnameDict[hostname] = cloneHostnameDetails(details);
              continue;
          }
          if (trackedState === undefined) {
              mergeCounts(hostnameDict[hostname].counts, details.counts);
          }
      }
  }
  
  if (Object.keys(contentScriptDict).length > 0) {
      for (const [hostname, details] of Object.entries(contentScriptDict)) {
          if (hostname !== pageHostname && hostnameDict[hostname] === undefined) {
              hostnameDict[hostname] = cloneHostnameDetails({
          domain: details.domain || hostname,
          counts: details.counts || createCounts(),
              });
          }
      }
  }
  if (dnrState?.hostnameDict) {
      for (const [hostname, details] of Object.entries(dnrState.hostnameDict)) {
          if (hostnameDict[hostname] === undefined) {
              hostnameDict[hostname] = cloneHostnameDetails({
          domain: details.domain,
          counts: details.counts,
              });
          }
      }
  }

  const pageCounts: any = pageStore?.counts
      ? {
        blocked: { ...pageStore.counts.blocked },
        allowed: { ...pageStore.counts.allowed },
      }
      : createCounts();
  if (trackedState?.pageCounts) {
      mergeCounts(pageCounts, trackedState.pageCounts);
  }
  if (trackedState === undefined && liveState?.pageCounts) {
      mergeCounts(pageCounts, liveState.pageCounts);
  }
  if (tabId > 0) {
      const matchedBlockedCount = await getMatchedBlockedRequestCountForTab(
          tabId,
          trackedState?.startedAt || 0,
      );
      if (
          typeof matchedBlockedCount === "number" &&
      matchedBlockedCount > pageCounts.blocked.any
      ) {
          pageCounts.blocked.any = matchedBlockedCount;
      }
  }

  // Get netFilteringSwitch - ALWAYS read from storage to get current state
  // This ensures we get the latest state even if pageStore was cached before toggle
  let netFilteringSwitch = true;
  if (pageHostname !== "") {
      const storedFiltering = await chrome.storage.local.get("perSiteFiltering");
      const perSiteFiltering = storedFiltering?.perSiteFiltering || {};
      const pageKey = `${pageHostname}:${pageURL}`;
    console.log(
        "[MV3] getPopupData: perSiteFiltering =",
        perSiteFiltering,
        "pageKey =",
        pageKey,
        "hostname =",
        pageHostname,
    );
    netFilteringSwitch = !(
        perSiteFiltering[pageKey] === false ||
      perSiteFiltering[pageHostname] === false
    );
    console.log("[MV3] getPopupData: from storage =", netFilteringSwitch);
  }
  console.log(
      "[MV3] getPopupData: final netFilteringSwitch =",
      netFilteringSwitch,
  );

  const hostnameSwitches = popupState.sessionHostnameSwitches;
  const noPopups =
    pageHostname !== "" &&
    hostnameSwitches[pageHostname]?.["no-popups"] === true;
  const noCosmeticFiltering =
    pageHostname !== "" &&
    hostnameSwitches[pageHostname]?.["no-cosmetic-filtering"] === true;
  const noLargeMedia =
    pageHostname !== "" &&
    hostnameSwitches[pageHostname]?.["no-large-media"] === true;
  const noRemoteFonts =
    pageHostname !== "" &&
    hostnameSwitches[pageHostname]?.["no-remote-fonts"] === true;
  const noScripting =
    pageHostname !== "" &&
    hostnameSwitches[pageHostname]?.["no-scripting"] === true;
  const switchMetrics =
    tabId > 0
        ? await getTabSwitchMetrics(tabId)
        : {
          popupBlockedCount: 0,
          largeMediaCount: 0,
          remoteFontCount: 0,
          scriptCount: 0,
        };

  const storedVersions = await chrome.storage.local.get("popupContentVersions");
  const contentLastModified =
    pageStore?.contentLastModified ||
    storedVersions?.popupContentVersions?.[tabId] ||
    trackedState?.startedAt ||
    0;
  const largeMediaCount =
    pageStore?.largeMediaCount ?? switchMetrics.largeMediaCount;
  const remoteFontCount =
    pageStore?.remoteFontCount ?? switchMetrics.remoteFontCount;
  const popupBlockedCount =
    pageStore?.popupBlockedCount ?? switchMetrics.popupBlockedCount;
  const hiddenSettings =
    ((await chrome.storage.local.get("hiddenSettings") as Record<string, any>)).hiddenSettings || {};
  const matrixIsDirty =
    popupState.sessionFirewall.hasSameRules(
      popupState.permanentFirewall,
      pageHostname,
      hostnameDict,
    ) === false ||
    hasSameHostnameSwitches(
        pageHostname,
      popupState.sessionHostnameSwitches,
      popupState.permanentHostnameSwitches,
    ) === false;

  return {
    advancedUserEnabled: popupState.userSettings.advancedUserEnabled,
    appName: chrome.runtime.getManifest().name,
    appVersion: chrome.runtime.getManifest().version,
    canElementPicker,
    cnameMap: [],
    colorBlindFriendly: popupState.userSettings.colorBlindFriendly,
    contentLastModified,
    cosmeticFilteringSwitch: noCosmeticFiltering !== true,
    firewallPaneMinimized: popupState.userSettings.firewallPaneMinimized,
    uiPopupConfig: undefined,
    fontSize: "unset",
    firewallRules: getFirewallRulesForPopup(pageHostname, hostnameDict),
    godMode: hiddenSettings.filterAuthorMode === true,
    globalAllowedRequestCount: popupState.globalAllowedRequestCount,
    globalBlockedRequestCount: popupState.globalBlockedRequestCount,
    hasUnprocessedRequest: (() => {
        const vAPINet = (globalThis as any).vAPI?.net;
        if (vAPINet?.hasUnprocessedRequest) {
            return vAPINet.hasUnprocessedRequest(tabId) === true;
        }
        return popupState.tabMetrics?.[tabId]?.hasUnprocessedRequest === true;
    })(),
    hostnameDict,
    pageCounts,
    pageDomain,
    pageHostname,
    pageURL,
    popupBlockedCount,
    popupPanelDisabledSections: 0,
    popupPanelHeightMode: 0,
    popupPanelLockedSections: 0,
    popupPanelOrientation: "auto",
    popupPanelSections: popupState.userSettings.popupPanelSections,
    rawURL: pageURL,
    tabId,
    tabTitle: pageTitle,
    tooltipsDisabled: popupState.userSettings.tooltipsDisabled,
    netFilteringSwitch,
    largeMediaCount,
    matrixIsDirty,
    remoteFontCount,
    noPopups,
    noLargeMedia,
    noCosmeticFiltering,
    noRemoteFonts,
    noScripting,
    userFiltersAreEnabled: true,
    userSettings: popupState.userSettings,
    whitelist: popupState.whitelist,
    whitelistDefault: popupState.userSettings.netWhitelistDefault || [],
  };
};


