/*******************************************************************************

    uBlock Origin - MV3 YouTube Chrome Event Module
    https://github.com/gorhill/uBlock

    Manages tab lifecycle events for YouTube-specific ad-blocking behavior.
    Extracted from sw-entry.ts inline chrome.tabs listeners.

*******************************************************************************/

import type { ChromeEventModule, Unregister } from "../chrome-event-registry.js";
import type { YouTubeEngine } from "../youtube-engine.js";

export interface YouTubeEventsDeps {
    getYouTubeEngine: () => YouTubeEngine;
}

export function createYouTubeEventsModule(deps: YouTubeEventsDeps): ChromeEventModule {
    return {
        domain: "youtube-events",
        register: () => {
            const cleanups: Unregister[] = [];

            const onUpdatedHandler = (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
                const engine = deps.getYouTubeEngine();
                if (changeInfo.status === "loading" && tab.url && tab.url.includes("youtube.com")) {
                    engine.onTabNavigate(tabId, tab.url);
                }
                if (changeInfo.status === "complete" && tab.url && tab.url.includes("youtube.com")) {
                    void engine.applyRulePlan([tabId]).catch((e) => {
                        console.warn('[uBR] onUpdated: youtubeEngine.applyRulePlan failed for tab', tabId, e);
                    });
                }
            };
            chrome.tabs.onUpdated.addListener(onUpdatedHandler);
            cleanups.push(() => chrome.tabs.onUpdated.removeListener(onUpdatedHandler));

            const onRemovedHandler = (tabId: number) => {
                deps.getYouTubeEngine().onTabRemove(tabId);
            };
            chrome.tabs.onRemoved.addListener(onRemovedHandler);
            cleanups.push(() => chrome.tabs.onRemoved.removeListener(onRemovedHandler));

            const onActivatedHandler = (activeInfo: chrome.tabs.OnActivatedInfo) => {
                deps.getYouTubeEngine().onTabActivate(activeInfo.tabId);
            };
            chrome.tabs.onActivated.addListener(onActivatedHandler);
            cleanups.push(() => chrome.tabs.onActivated.removeListener(onActivatedHandler));

            return cleanups;
        },
    };
}
