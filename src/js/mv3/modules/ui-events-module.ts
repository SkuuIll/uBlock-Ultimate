/*******************************************************************************

    uBlock Origin - MV3 UI Chrome Event Module
    https://github.com/gorhill/uBlock

    UI-related chrome event handlers: per-site filtering badge updates on tab
    navigation, and keyboard shortcut dispatch to zapper/picker/dashboard/logger.

*******************************************************************************/

import type { ChromeEventModule, Unregister } from "../chrome-event-registry.js";

export interface UIEventsDeps {
    Zapper: { activate: (_tabId: number) => void };
    Picker: { activate: (_tabId: number) => void };
}

export function createUIEventsModule(deps: UIEventsDeps): ChromeEventModule {
    const { Zapper, Picker } = deps;

    return {
        domain: "ui-events",
        register: () => {
            const cleanups: Unregister[] = [];

            const tabUpdatedHandler = async (tabId: number, changeInfo: any, tab: any) => {
                if (
                    changeInfo.status === "complete" &&
                    tab?.url &&
                    tab.url.startsWith("http")
                ) {
                    try {
                        const hostname = new URL(tab.url).hostname;
                        const pageKey = `${hostname}:${tab.url}`;
                        const storedFiltering = await chrome.storage.local.get("perSiteFiltering");
                        const perSiteFiltering = storedFiltering?.perSiteFiltering || {};
                        const isFilteringEnabled =
                            perSiteFiltering[pageKey] !== false &&
                            perSiteFiltering[hostname] !== false;
                        if (!isFilteringEnabled) {
                            await chrome.action.setBadgeText({ text: "off", tabId });
                            await chrome.action.setBadgeBackgroundColor({ color: "#888888", tabId });
                        } else {
                            await chrome.action.setBadgeText({ text: "", tabId });
                        }
                    } catch (e) {
                        console.warn('[uBR] onUpdated badge update failed for tab', tabId, e);
                    }
                }
            };
            chrome.tabs.onUpdated.addListener(tabUpdatedHandler);
            cleanups.push(() => chrome.tabs.onUpdated.removeListener(tabUpdatedHandler));

            const commandHandler = (command: string) => {
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    const tabId = tabs[0]?.id;
                    if (!tabId) return;
                    switch (command) {
                        case "launch-element-zapper":
                            Zapper.activate(tabId);
                            break;
                        case "launch-element-picker":
                            Picker.activate(tabId);
                            break;
                        case "open-dashboard":
                            void chrome.runtime.openOptionsPage();
                            break;
                        case "launch-logger":
                            chrome.tabs.create({ url: "logger-ui.html" }).catch(() => {});
                            break;
                    }
                });
            };
            chrome.commands.onCommand.addListener(commandHandler);
            cleanups.push(() => chrome.commands.onCommand.removeListener(commandHandler));

            return cleanups;
        },
    };
}
