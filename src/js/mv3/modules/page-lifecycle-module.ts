/*******************************************************************************

    uBlock Origin - MV3 Page Lifecycle Chrome Event Module
    https://github.com/gorhill/uBlock

    Tracks page lifecycle: webRequest monitoring, page store cleanup on tab
    close, and runtime install/update logging.

*******************************************************************************/

import type { ChromeEventModule, Unregister } from "../chrome-event-registry.js";

export interface PageLifecycleDeps {
    trackPendingRequest: (_details: any) => void;
    finalizeTrackedRequest: (_details: any, _isError: boolean) => Promise<void>;
    clearTabRequestState: (_tabId: number) => void;
    pageStores: Map<number, any>;
}

export function createPageLifecycleModule(deps: PageLifecycleDeps): ChromeEventModule {
    const { trackPendingRequest, finalizeTrackedRequest, clearTabRequestState, pageStores } = deps;

    return {
        domain: "page-lifecycle",
        register: () => {
            const cleanups: Unregister[] = [];

            const beforeRequestHandler = (details: any) => {
                trackPendingRequest(details);
                return undefined;
            };
            chrome.webRequest?.onBeforeRequest?.addListener(
                beforeRequestHandler,
                { urls: ["<all_urls>"] },
                [],
            );
            cleanups.push(() => chrome.webRequest?.onBeforeRequest?.removeListener(beforeRequestHandler));

            const completedHandler = (details: any) => { void finalizeTrackedRequest(details, false); };
            chrome.webRequest?.onCompleted?.addListener(
                completedHandler,
                { urls: ["<all_urls>"] },
                [],
            );
            cleanups.push(() => chrome.webRequest?.onCompleted?.removeListener(completedHandler));

            const errorHandler = (details: any) => { void finalizeTrackedRequest(details, true); };
            chrome.webRequest?.onErrorOccurred?.addListener(
                errorHandler,
                { urls: ["<all_urls>"] },
                [],
            );
            cleanups.push(() => chrome.webRequest?.onErrorOccurred?.removeListener(errorHandler));

            const tabRemovedHandler = (tabId: number) => {
                void clearTabRequestState(tabId);
                const pageStore = pageStores.get(tabId);
                if (pageStore) {
                    pageStore.disposeFrameStores();
                    pageStores.delete(tabId);
                }
            };
            chrome.tabs.onRemoved.addListener(tabRemovedHandler);
            cleanups.push(() => chrome.tabs.onRemoved.removeListener(tabRemovedHandler));

            const installedHandler = (details: any) => {
                if (details.reason === "install") {
                    console.log("uBlock Origin installed");
                } else if (details.reason === "update") {
                    console.log("uBlock Origin updated");
                }
            };
            chrome.runtime.onInstalled.addListener(installedHandler);
            cleanups.push(() => chrome.runtime.onInstalled.removeListener(installedHandler));

            return cleanups;
        },
    };
}
