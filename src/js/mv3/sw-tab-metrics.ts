/*******************************************************************************

    uBlock Origin - MV3 Tab Metrics
    https://github.com/gorhill/uBlock

    This file contains tab metrics and badge update functions.

*******************************************************************************/

import { popupState } from './sw-storage.js';

export interface TabSwitchMetrics {
    popupBlockedCount: number;
    largeMediaCount: number;
    remoteFontCount: number;
    scriptCount: number;
}

export const getTabSwitchMetrics = async (tabId: number): Promise<TabSwitchMetrics> => {
    if (chrome.scripting?.executeScript === undefined) {
        return {
            popupBlockedCount: 0,
            largeMediaCount: 0,
            remoteFontCount: 0,
            scriptCount: 0,
        };
    }

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                const win = window as Window & Record<string, any>;
                return {
                    popupBlockedCount: win.__ubrPopupBlockedCount || 0,
                    largeMediaCount: win.__ubrLargeMediaCount || 0,
                    remoteFontCount: win.__ubrRemoteFontCount || 0,
                    scriptCount: win.__ubrScriptCount || 0,
                };
            },
        });

        if (results && results[0]?.result) {
            return results[0].result as TabSwitchMetrics;
        }
    } catch (e) {
        console.warn('[uBR] getTabSwitchMetrics: executeScript failed for tab', tabId, e);
    }

    return {
        popupBlockedCount: 0,
        largeMediaCount: 0,
        remoteFontCount: 0,
        scriptCount: 0,
    };
};

export const getHiddenElementCountForTab = async (tabId: number): Promise<number> => {
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId, allFrames: true },
            world: 'MAIN',
            func: () => {
                const page = globalThis as typeof globalThis & {
                    vAPI?: {
                        domFilterer?: {
                            getAllSelectors?: (_bits: number) => { declarative?: unknown[] };
                        };
                    };
                };
                const filterer = page.vAPI?.domFilterer;
                if (typeof filterer?.getAllSelectors !== 'function') {
                    return 0;
                }
                const details = filterer.getAllSelectors(0b11);
                const selectors = Array.isArray(details?.declarative)
                    ? details.declarative
                    : [];
                if (selectors.length === 0) return 0;
                const matched = new Set<Element>();
                for (const selector of selectors) {
                    if (typeof selector !== 'string' || selector === '') continue;
                    try {
                        for (const element of document.querySelectorAll(selector)) {
                            matched.add(element);
                        }
                    } catch {
                        // Ignore selectors unsupported by querySelectorAll().
                    }
                }
                return matched.size;
            },
        });

        if (Array.isArray(results)) {
            return results.reduce((sum, result) => sum + (Number(result.result) || 0), 0);
        }
    } catch (e) {
        console.warn('[uBR] getHiddenElementCountForTab: executeScript failed for tab', tabId, e);
    }
    return 0;
};

export const updateBadge = async (): Promise<void> => {
    const { globalAllowedRequestCount, globalBlockedRequestCount } = popupState;
    const total = globalAllowedRequestCount + globalBlockedRequestCount;
    
    if (total === 0) {
        void chrome.action.setBadgeText({ text: '' });
        return;
    }

    const badgeText = total >= 10000 
        ? `${(total / 1000).toFixed(1)}k`
        : total.toString();
    
    void chrome.action.setBadgeText({ text: badgeText });
    
    const color = globalBlockedRequestCount > 0 ? '#5c5' : '#cc5';
    void chrome.action.setBadgeBackgroundColor({ color });
};

export const updateToolbarIcon = async (
    tabId: number,
    options: { filtering?: boolean; clickToLoad?: string }
): Promise<void> => {
    try {
        const tab = await chrome.tabs.get(tabId);
        if (!tab?.url) return;

        const url = new URL(tab.url);
        const isHttp = url.protocol === 'http:' || url.protocol === 'https:';

        const iconPath = isHttp && options.filtering !== false
            ? {
                '16': 'img/ublock16.png',
                '32': 'img/ublock32.png',
                '64': 'img/ublock64.png',
            }
            : {
                '16': 'img/ublock16-off.png',
                '32': 'img/ublock32-off.png',
                '64': 'img/ublock64-off.png',
            };

        void chrome.action.setIcon({
            tabId,
            path: iconPath,
        });
    } catch (e) {
        console.warn('[uBR] updateToolbarIcon: failed for tab', tabId, e);
    }
};

export const persistGlobalRequestCounts = async (): Promise<void> => {
    await chrome.storage.local.set({
        globalAllowedRequestCount: popupState.globalAllowedRequestCount,
        globalBlockedRequestCount: popupState.globalBlockedRequestCount,
    });
};
